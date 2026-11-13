import type { IncomingMessage, ServerResponse } from "node:http";
import type { ZoneId } from "@terranova/shared";
import {
  canControl,
  type HistoryAction,
  type HistoryPage,
  isHistoryAction,
  isSensorRange,
  isZoneId,
  SENSOR_RANGES,
  type SensorSeries,
} from "@terranova/shared";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { count } from "drizzle-orm";
import type { AppOptions } from "./app";
import { MIN_PASSWORD_LENGTH } from "./auth";
import { user } from "./db/schema";
import { type ControlHistory, MAX_HISTORY_LIMIT } from "./history";
import { isPushEndpoint, type PushNotifier, parseSubscription } from "./push";
import type { SensorHistory } from "./sensors";

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_SETUP_BODY_BYTES = 16 * 1024;

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_SETUP_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString());
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface RequestHandlerDeps {
  options: AppOptions;
  history: ControlHistory;
  sensors: SensorHistory;
  push: PushNotifier | null;
  isAllowedOrigin: (origin: string | undefined) => boolean;
  triggerAlarm: (zoneId: ZoneId) => Promise<unknown>;
}

/** Everything the backend answers over plain HTTP: login, first-run setup, history and push. */
export function createRequestHandler({
  options,
  history,
  sensors,
  push,
  isAllowedOrigin,
  triggerAlarm,
}: RequestHandlerDeps) {
  const { auth, db } = options;
  const authHandler = toNodeHandler(auth);
  const userCount = async () => (await db.select({ n: count() }).from(user))[0]?.n ?? 0;

  // Public sign-up stays closed. The only way in on a new install is this one-time setup,
  // and running requests in sequence stops two of them both becoming the first admin.
  let setupQueue: Promise<unknown> = Promise.resolve();
  const createFirstAdmin = (name: string, email: string, password: string): Promise<number> => {
    const run = setupQueue.then(async () => {
      if ((await userCount()) > 0) return 409;
      await auth.api.createUser({ body: { name, email, password, role: "admin" } });
      return 201;
    });
    setupQueue = run.catch(() => undefined);
    return run;
  };

  const handleSetup = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ needsSetup: (await userCount()) === 0 }));
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    // Browsers always send Origin here. Requiring it stops any other device or program from
    // becoming the first admin of a new install.
    const { origin } = req.headers;
    if (!origin || !isAllowedOrigin(origin)) {
      res.writeHead(403).end();
      return;
    }
    const body = await readJson(req);
    const { name, email, password } = body ?? {};
    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof email !== "string" ||
      typeof password !== "string" ||
      password.length < MIN_PASSWORD_LENGTH
    ) {
      res.writeHead(400).end();
      return;
    }
    try {
      res.writeHead(await createFirstAdmin(name.trim(), email, password)).end();
    } catch {
      res.writeHead(400).end();
    }
  };

  /** The signed-in person's session, or null after answering 401. Reads only, so the session isn't refreshed. */
  const requireSession = async (req: IncomingMessage, res: ServerResponse) => {
    const current = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
      query: { disableRefresh: true },
    });
    if (!current) res.writeHead(401).end();
    return current;
  };

  const handleHistory = async (req: IncomingMessage, res: ServerResponse, query: URLSearchParams) => {
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    const current = await requireSession(req, res);
    if (!current) return;
    if (!canControl(current.user.role)) {
      res.writeHead(403).end();
      return;
    }

    const zoneId = query.get("zone") ?? undefined;
    const action = query.get("action") ?? undefined;
    const before = query.has("before") ? Number(query.get("before")) : undefined;
    const limit = query.has("limit") ? Number(query.get("limit")) : DEFAULT_HISTORY_LIMIT;
    const valid =
      (zoneId === undefined || isZoneId(zoneId)) &&
      (action === undefined || isHistoryAction(action)) &&
      (before === undefined || (Number.isSafeInteger(before) && before > 0)) &&
      Number.isInteger(limit) &&
      limit > 0 &&
      limit <= MAX_HISTORY_LIMIT;
    if (!valid) {
      res.writeHead(400).end();
      return;
    }

    const page = await history.list({ before, zoneId, action: action as HistoryAction | undefined, limit });
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ ...page, timeZone: options.watering.timeZone } satisfies HistoryPage));
  };

  const handleSensors = async (req: IncomingMessage, res: ServerResponse, query: URLSearchParams) => {
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    const current = await requireSession(req, res);
    if (!current) return;
    const zoneId = query.get("zone");
    const range = query.get("range");
    if (!isZoneId(zoneId ?? undefined) || !isSensorRange(range)) {
      res.writeHead(400).end();
      return;
    }
    const nowMs = Date.now();
    const { spanMs, bucketMs } = SENSOR_RANGES[range];
    const body: SensorSeries = {
      points: await sensors.series(zoneId!, range, nowMs),
      fromMs: nowMs - spanMs,
      toMs: nowMs,
      bucketMs,
      timeZone: options.watering.timeZone,
    };
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };

  const handlePush = async (req: IncomingMessage, res: ServerResponse, path: string) => {
    if (!push) {
      res.writeHead(404).end();
      return;
    }
    const current = await requireSession(req, res);
    if (!current) return;
    if (path === "/api/push/key" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ publicKey: push.publicKey }));
      return;
    }
    if (req.method !== "POST" || (path !== "/api/push/subscribe" && path !== "/api/push/unsubscribe")) {
      res.writeHead(404).end();
      return;
    }
    // A signed-in person's browser always sends Origin, so another site can't subscribe for them.
    const { origin } = req.headers;
    if (!origin || !isAllowedOrigin(origin)) {
      res.writeHead(403).end();
      return;
    }
    const body = await readJson(req);
    if (path === "/api/push/subscribe") {
      const subscription = parseSubscription(body);
      if (!subscription) {
        res.writeHead(400).end();
        return;
      }
      await push.subscribe(current.user.id, subscription, String(body?.locale));
    } else {
      if (!isPushEndpoint(body?.endpoint)) {
        res.writeHead(400).end();
        return;
      }
      await push.unsubscribe(body.endpoint);
    }
    res.writeHead(204).end();
  };

  const handleRequest = async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";
    if (url.startsWith("/api/auth")) return authHandler(req, res);
    if (url === "/api/setup") return handleSetup(req, res);
    const parsed = new URL(url, "http://localhost");
    if (parsed.pathname === "/api/history") return handleHistory(req, res, parsed.searchParams);
    if (parsed.pathname === "/api/sensors") return handleSensors(req, res, parsed.searchParams);
    if (parsed.pathname.startsWith("/api/push/")) return handlePush(req, res, parsed.pathname);

    const zoneId = /^\/dev\/alarms\/([\w-]+)$/.exec(url)?.[1];
    if (!options.enableDevRoutes || req.method !== "POST" || !zoneId) {
      res.writeHead(404).end();
    } else if (!isAllowedOrigin(req.headers.origin)) {
      res.writeHead(403).end();
    } else if (!isZoneId(zoneId)) {
      res.writeHead(400).end("unknown zone\n");
    } else {
      const cycle = await triggerAlarm(zoneId);
      res.writeHead(cycle ? 201 : 409).end(cycle ? "alarm sent\n" : "zone already has an active cycle\n");
    }
  };
  return handleRequest;
}

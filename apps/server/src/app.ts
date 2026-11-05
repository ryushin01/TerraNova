import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  ZONE_IDS,
  canControl,
  isHistoryAction,
  isManualActuator,
  isZoneId,
  parseAck,
  parseTelemetry,
  parseZoneStatus,
  topics,
  normalizeAlarmTimes,
  type AddCropResult,
  type ClientToServerEvents,
  type ConfirmResult,
  type ControlResult,
  type HistoryAction,
  type HistoryPage,
  type RemoveCropResult,
  type ServerToClientEvents,
} from "@terranova/shared";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { count } from "drizzle-orm";
import mqtt from "mqtt";
import { Server, type Socket } from "socket.io";
import { MIN_PASSWORD_LENGTH, type Auth } from "./auth";
import type { Database } from "./db";
import { user } from "./db/schema";
import { DeviceControls } from "./controls";
import { ControlHistory, MAX_HISTORY_LIMIT, outcomeOf, type Actor, type HistoryEvent } from "./history";
import { ZoneSections } from "./sections";
import { WateringService, type WateringConfig } from "./watering";
import { ZoneRegistry } from "./zones";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AppOptions {
  db: Database;
  auth: Auth;
  mqttUrl: string;
  httpPort: number;
  allowedOrigins: string[];
  watering: WateringConfig;
  defaultAlarmTimes: readonly string[];
  staleAfterMs: number;
  tickMs: number;
  enableDevRoutes: boolean;
  sessionSweepMs: number;
}

const HISTORY_PRUNE_MS = 60 * 60 * 1000;
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

export async function startApp(options: AppOptions) {
  const { allowedOrigins } = options;
  const isAllowedOrigin = (origin: string | undefined) => !origin || allowedOrigins.includes(origin);
  const zones = new ZoneRegistry(options.staleAfterMs);
  const sections = new ZoneSections(options.db, options.defaultAlarmTimes);
  await sections.init();
  const history = new ControlHistory(options.db);

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

  const handleHistory = async (req: IncomingMessage, res: ServerResponse, query: URLSearchParams) => {
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    const current = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
      query: { disableRefresh: true },
    });
    if (!current) {
      res.writeHead(401).end();
      return;
    }
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

  const handleRequest = async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";
    if (url.startsWith("/api/auth")) return authHandler(req, res);
    if (url === "/api/setup") return handleSetup(req, res);
    const parsed = new URL(url, "http://localhost");
    if (parsed.pathname === "/api/history") return handleHistory(req, res, parsed.searchParams);

    const zoneId = /^\/dev\/alarms\/([\w-]+)$/.exec(url)?.[1];
    if (!options.enableDevRoutes || req.method !== "POST" || !zoneId) {
      res.writeHead(404).end();
    } else if (!isAllowedOrigin(req.headers.origin)) {
      res.writeHead(403).end();
    } else if (!isZoneId(zoneId)) {
      res.writeHead(400).end("unknown zone\n");
    } else {
      const cycle = await watering.triggerAlarm(zoneId);
      res.writeHead(cycle ? 201 : 409).end(cycle ? "alarm sent\n" : "zone already has an active cycle\n");
    }
  };
  const http = createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      console.error("[server] request failed:", error);
      res.writeHead(500).end();
    });
  });

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, {
    cors: { origin: allowedOrigins, credentials: true },
    // CORS does not cover WebSockets, and this socket can start pumps, so any other
    // website open in the user's browser must be refused here.
    allowRequest: (req, callback) => callback(null, isAllowedOrigin(req.headers.origin)),
  });

  // Sessions are read again for every action, so sign-out, removal or a role change applies at once.
  const sessionOf = (socket: Socket) =>
    auth.api.getSession({
      headers: fromNodeHeaders(socket.request.headers),
      query: { disableRefresh: true },
    });

  /**
   * Runs an action only for a signed-in person whose role allows it, and records the attempt,
   * refused ones included. Recording happens on the side so it can never delay or block the action.
   */
  const whenAllowed = async <T extends { ok: boolean }>(
    socket: Socket,
    forbidden: T,
    describe: (result: T) => HistoryEvent[] | Promise<HistoryEvent[]>,
    action: (actor: Actor) => Promise<T>,
  ): Promise<T> => {
    const current = await sessionOf(socket);
    if (!current) {
      socket.disconnect(true);
      return forbidden;
    }
    const actor: Actor = { id: current.user.id, name: current.user.name, role: current.user.role };
    const log = (result: T) => {
      Promise.resolve(result)
        .then(describe)
        .then((events) => history.record(actor, events))
        .catch((error) => console.error("[history] could not describe:", error));
    };
    try {
      const result = canControl(current.user.role) ? await action(actor) : forbidden;
      log(result);
      return result;
    } catch (error) {
      log({ ok: false, error: "internal" } as unknown as T);
      throw error;
    }
  };

  const cropRef = async (cropId: string) => {
    const crop = (await sections.crops()).find(({ id }) => id === cropId);
    return crop ? { id: crop.id, name: crop.name } : { id: cropId, name: cropId };
  };

  io.use((socket, next) => {
    sessionOf(socket).then(
      (current) => next(current ? undefined : new Error("unauthorized")),
      () => next(new Error("unauthorized")),
    );
  });

  const client = await mqtt.connectAsync(options.mqttUrl, { clientId: "terranova-server" });

  const publish = async (topic: string, payload: string) => {
    if (!client.connected) throw new Error("MQTT broker is not connected");
    await client.publishAsync(topic, payload, { qos: 1 });
  };

  const watering = new WateringService({
    db: options.db,
    zones,
    config: options.watering,
    schedule: () => sections.schedule(),
    publish,
    onCycleChange: (cycle) => io.emit("cycle:update", cycle),
  });

  const controls = new DeviceControls({
    zones,
    ackTimeoutMs: options.watering.ackTimeoutMs,
    publish,
  });

  client.on("message", (topic, payload, packet) => {
    const zoneId = topic.split("/")[2];
    if (!isZoneId(zoneId)) return;
    const text = payload.toString();
    const now = Date.now();

    if (topic === topics.telemetry(zoneId)) {
      const telemetry = parseTelemetry(text);
      if (telemetry) io.emit("zone:update", zones.recordTelemetry(zoneId, telemetry, now, packet.retain));
    } else if (topic === topics.status(zoneId)) {
      const status = parseZoneStatus(text);
      if (status) io.emit("zone:update", zones.recordStatus(zoneId, status.online, now));
    } else if (topic.endsWith("/ack")) {
      const ack = parseAck(text);
      if (ack) {
        controls.handleAck(ack);
        watering.handleAck(ack).catch((error) => console.error("[server] ack failed:", error));
      }
    }
  });
  client.on("error", (error) => console.error(`[server] MQTT: ${error.message}`));
  await client.subscribeAsync([topics.allTelemetry, topics.allStatuses, topics.allAcks], { qos: 1 });

  io.on("connection", (socket) => {
    Promise.all([watering.latestCycles(), sections.crops(), sections.assignments()])
      .then(([cycles, crops, assigned]) =>
        socket.emit("snapshot", {
          crops,
          timeZone: options.watering.timeZone,
          sections: assigned,
          zones: zones.all(Date.now()),
          cycles,
        }),
      )
      .catch((error) => console.error("[server] snapshot failed:", error));

    socket.on("alarm:confirm", (cycleId, callback) => {
      if (typeof callback !== "function") return;
      if (typeof cycleId !== "string" || !UUID_PATTERN.test(cycleId)) {
        callback({ ok: false, error: "not_found" });
        return;
      }
      whenAllowed<ConfirmResult>(
        socket,
        { ok: false, error: "forbidden" },
        (result) => [
          { action: "alarm_confirm", zoneId: result.ok ? result.cycle.zoneId : undefined, ...outcomeOf(result) },
        ],
        (actor) => watering.confirm(cycleId, actor.id),
      ).then(callback, (error) => {
        console.error("[server] confirm failed:", error);
        callback({ ok: false, error: "internal" });
      });
    });

    socket.on("watering:start", (zoneId, callback) => {
      if (typeof callback !== "function") return;
      if (!isZoneId(zoneId)) {
        callback({ ok: false, error: "not_found" });
        return;
      }
      whenAllowed<ConfirmResult>(
        socket,
        { ok: false, error: "forbidden" },
        (result) => [{ action: "watering_start", zoneId, ...outcomeOf(result) }],
        (actor) => watering.startWatering(zoneId, actor.id),
      ).then(callback, (error) => {
        console.error("[server] start failed:", error);
        callback({ ok: false, error: "internal" });
      });
    });

    socket.on("zones:move", (zoneIds, cropId, callback) => {
      if (typeof callback !== "function") return;
      const valid =
        Array.isArray(zoneIds) && zoneIds.length > 0 && zoneIds.every(isZoneId) && typeof cropId === "string";
      if (!valid) {
        callback({ ok: false, error: "invalid" });
        return;
      }
      whenAllowed<ControlResult>(
        socket,
        { ok: false, error: "forbidden" },
        async (result) => {
          const crop = await cropRef(cropId);
          return zoneIds.map((zoneId) => ({ action: "zones_move", zoneId, detail: { crop }, ...outcomeOf(result) }));
        },
        async () => {
          if (!(await sections.move(zoneIds, cropId))) return { ok: false, error: "invalid" };
          io.emit("sections:update", await sections.assignments());
          return { ok: true };
        },
      ).then(callback, () => callback({ ok: false, error: "internal" }));
    });

    socket.on("crop:add", (name, icon, callback) => {
      if (typeof callback !== "function") return;
      whenAllowed<AddCropResult>(
        socket,
        { ok: false, error: "forbidden" },
        (result) => [
          {
            action: "crop_add",
            detail: { crop: result.ok ? { id: result.crop.id, name: result.crop.name } : { id: "", name: String(name).slice(0, 60) } },
            ...outcomeOf(result),
          },
        ],
        async () => {
          const outcome = await sections.addCrop(name, icon);
          if ("error" in outcome) return { ok: false, error: outcome.error };
          io.emit("crops:update", await sections.crops());
          return { ok: true, crop: outcome.crop };
        },
      ).then(callback, () => callback({ ok: false, error: "internal" }));
    });

    socket.on("crop:schedule", (cropId, times, callback) => {
      if (typeof callback !== "function") return;
      if (typeof cropId !== "string") {
        callback({ ok: false, error: "invalid" });
        return;
      }
      whenAllowed<ControlResult>(
        socket,
        { ok: false, error: "forbidden" },
        async (result) => [
          {
            action: "alarm_times",
            detail: { crop: await cropRef(cropId), times: normalizeAlarmTimes(times) ?? undefined },
            ...outcomeOf(result),
          },
        ],
        async () => {
          if (!(await sections.setAlarmTimes(cropId, times))) return { ok: false, error: "invalid" };
          io.emit("crops:update", await sections.crops());
          return { ok: true };
        },
      ).then(callback, () => callback({ ok: false, error: "internal" }));
    });

    socket.on("crop:remove", (cropId, callback) => {
      if (typeof callback !== "function") return;
      if (typeof cropId !== "string") {
        callback({ ok: false, error: "not_found" });
        return;
      }
      // Looked up first: after removal the name is gone.
      const crop = cropRef(cropId);
      whenAllowed<RemoveCropResult>(
        socket,
        { ok: false, error: "forbidden" },
        async (result) => [{ action: "crop_remove", detail: { crop: await crop }, ...outcomeOf(result) }],
        async () => {
          await crop;
          const outcome = await sections.removeCrop(cropId);
          if (outcome !== "ok") return { ok: false, error: outcome };
          io.emit("crops:update", await sections.crops());
          return { ok: true };
        },
      ).then(callback, () => callback({ ok: false, error: "internal" }));
    });

    socket.on("pump:stop", (zoneId, callback) => {
      if (typeof callback !== "function") return;
      if (!isZoneId(zoneId)) {
        callback({ ok: false, error: "invalid" });
        return;
      }
      whenAllowed<ControlResult>(
        socket,
        { ok: false, error: "forbidden" },
        (result) => [{ action: "pump_stop", zoneId, ...outcomeOf(result) }],
        () => controls.stopPump(zoneId),
      ).then(callback, () => callback({ ok: false, error: "internal" }));
    });

    socket.on("actuator:set", (zoneId, actuator, on, callback) => {
      if (typeof callback !== "function") return;
      if (!isZoneId(zoneId) || !isManualActuator(actuator) || typeof on !== "boolean") {
        callback({ ok: false, error: "invalid" });
        return;
      }
      whenAllowed<ControlResult>(
        socket,
        { ok: false, error: "forbidden" },
        (result) => [{ action: "actuator_set", zoneId, detail: { actuator, on }, ...outcomeOf(result) }],
        () => controls.setActuator(zoneId, actuator, on),
      ).then(callback, () => callback({ ok: false, error: "internal" }));
    });
  });

  // Live data must also stop for someone signed out or removed while their page stays open.
  let sweeping = false;
  const sessionSweep = setInterval(async () => {
    if (sweeping) return;
    sweeping = true;
    for (const socket of io.sockets.sockets.values()) {
      const current = await sessionOf(socket).catch(() => undefined);
      if (current === null) socket.disconnect(true);
    }
    sweeping = false;
  }, options.sessionSweepMs);

  const pruneHistory = () => history.prune().catch((error) => console.error("[history] prune failed:", error));
  pruneHistory();
  const historyPrune = setInterval(pruneHistory, HISTORY_PRUNE_MS);

  let ticking = false;
  const timer = setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      for (const zone of zones.sweepStale(Date.now())) io.emit("zone:update", zone);
      await watering.tick();
    } catch (error) {
      console.error("[server] tick failed:", error);
    } finally {
      ticking = false;
    }
  }, options.tickMs);

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.httpPort, "127.0.0.1", resolve);
  });

  return {
    watering,
    async stop() {
      clearInterval(timer);
      clearInterval(sessionSweep);
      clearInterval(historyPrune);
      controls.close();
      await io.close();
      await client.endAsync();
    },
  };
}

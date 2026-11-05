import { createServer } from "node:http";
import {
  type ClientToServerEvents,
  isZoneId,
  parseAck,
  parseTelemetry,
  parseZoneStatus,
  type ServerToClientEvents,
  topics,
} from "@terranova/shared";
import mqtt from "mqtt";
import { Server } from "socket.io";
import type { Auth } from "./auth";
import { Automation } from "./automation";
import { DeviceControls } from "./controls";
import type { Database } from "./db";
import { ControlHistory, outcomeOf } from "./history";
import { createRequestHandler } from "./http-routes";
import { type PushConfig, PushNotifier, type SendPush } from "./push";
import { ZoneSections } from "./sections";
import { SensorHistory } from "./sensors";
import { registerSocketHandlers } from "./socket-handlers";
import { localMinutes, type WateringConfig, WateringService } from "./watering";
import { ZoneRegistry } from "./zones";

const HISTORY_PRUNE_MS = 60 * 60 * 1000;

export interface AppOptions {
  db: Database;
  auth: Auth;
  mqttUrl: string;
  httpPort: number;
  allowedOrigins: string[];
  watering: WateringConfig;
  defaultAlarmTimes: readonly string[];
  /** How often to store a reading per zone. */
  sensorSampleMs?: number;
  /** Web Push for alarms. Off when not set. */
  push?: PushConfig & { send?: SendPush };
  staleAfterMs: number;
  tickMs: number;
  enableDevRoutes: boolean;
  sessionSweepMs: number;
}
export async function startApp(options: AppOptions) {
  const { allowedOrigins } = options;
  const isAllowedOrigin = (origin: string | undefined) => !origin || allowedOrigins.includes(origin);
  const zones = new ZoneRegistry(options.staleAfterMs);
  const sections = new ZoneSections(options.db, options.defaultAlarmTimes);
  await sections.init();
  const history = new ControlHistory(options.db);
  const sensors = new SensorHistory(options.db, options.sensorSampleMs ?? 60_000);
  const push = options.push ? new PushNotifier(options.db, options.push, options.push.send) : null;

  const handleRequest = createRequestHandler({
    options,
    history,
    sensors,
    push,
    isAllowedOrigin,
    triggerAlarm: (zoneId) => watering.triggerAlarm(zoneId),
  });
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
    onCycleChange: (cycle) => {
      io.emit("cycle:update", cycle);
      push?.notify(cycle).catch((error) => console.error("[push] notify failed:", error));
    },
  });

  const controls = new DeviceControls({
    zones,
    ackTimeoutMs: options.watering.ackTimeoutMs,
    publish,
  });

  const automation = new Automation({
    schedule: () => sections.automationRules(),
    liveReading: (zoneId, nowMs) => (zones.isOnline(zoneId, nowMs) ? zones.snapshot(zoneId, nowMs).telemetry : null),
    setActuator: (zoneId, actuator, on) => controls.setActuator(zoneId, actuator, on),
    raiseAlarm: (zoneId, slot) => watering.raiseAlarm(zoneId, slot),
    localMinutes: (nowMs) => localMinutes(nowMs, options.watering.timeZone),
    onSwitched: (zoneId, actuator, on, result) => {
      void history.record({ id: "system", name: "자동 제어", role: "system" }, [
        { action: "actuator_set", zoneId, detail: { actuator, on }, ...outcomeOf(result) },
      ]);
    },
  });

  client.on("message", (topic, payload, packet) => {
    const zoneId = topic.split("/")[2];
    if (!isZoneId(zoneId)) return;
    const text = payload.toString();
    const now = Date.now();

    if (topic === topics.telemetry(zoneId)) {
      const telemetry = parseTelemetry(text);
      if (telemetry) {
        io.emit("zone:update", zones.recordTelemetry(zoneId, telemetry, now, packet.retain));
        // A retained message is an old value being replayed, not a new reading.
        if (!packet.retain) void sensors.record(telemetry, now);
      }
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

  const stopSessionSweep = registerSocketHandlers({
    io,
    options,
    auth: options.auth,
    zones,
    sections,
    history,
    watering,
    controls,
    automation,
  });

  const pruneHistory = () =>
    Promise.all([history.prune(), watering.prune(), sensors.prune()]).catch((error) =>
      console.error("[server] cleanup failed:", error),
    );
  pruneHistory();
  const historyPrune = setInterval(pruneHistory, HISTORY_PRUNE_MS);

  let ticking = false;
  const timer = setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      for (const zone of zones.sweepStale(Date.now())) io.emit("zone:update", zone);
      await watering.tick();
      // After the watering tick, and separately, so a rule problem can't delay alarms or deadlines.
      await automation.tick(Date.now()).catch((error) => console.error("[server] automation failed:", error));
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
      stopSessionSweep();
      clearInterval(historyPrune);
      controls.close();
      await io.close();
      await client.endAsync();
    },
  };
}

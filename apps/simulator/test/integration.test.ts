import { afterAll, beforeAll, expect, test } from "bun:test";
import { type CommandAck, type Telemetry, topics, type ZoneStatus } from "@terranova/shared";
import mqtt, { type MqttClient } from "mqtt";
import { startBroker } from "../../server/src/broker";
import { startSimulator } from "../src/simulator";

const PORT = 18830;
const URL = `mqtt://127.0.0.1:${PORT}`;

let broker: Awaited<ReturnType<typeof startBroker>>;
let simulator: ReturnType<typeof startSimulator>;
let client: MqttClient;
const received: { topic: string; body: any }[] = [];

function waitFor<T>(find: () => T | undefined, timeoutMs = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const value = find();
      if (value !== undefined) {
        clearInterval(timer);
        resolve(value);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error("timed out waiting for MQTT message"));
      }
    }, 20);
  });
}

const findAck = (commandId: string, status: CommandAck["status"]) => () =>
  received.find(
    (m) => m.topic === topics.ack("zone-a", "pump") && m.body.commandId === commandId && m.body.status === status,
  )?.body as CommandAck | undefined;

beforeAll(async () => {
  broker = await startBroker({ port: PORT });
  client = await mqtt.connectAsync(URL);
  client.on("message", (topic, payload) => {
    // The malformed-command test publishes non-JSON on a topic this client also sees.
    try {
      received.push({ topic, body: JSON.parse(payload.toString()) });
    } catch {}
  });
  await client.subscribeAsync("terranova/#", { qos: 1 });
  simulator = startSimulator({ brokerUrl: URL, tickMs: 50, telemetryMs: 100 });
});

afterAll(async () => {
  await client.endAsync();
  await broker.stop();
});

test("publishes online status and telemetry for a zone", async () => {
  const status = await waitFor(
    () => received.find((m) => m.topic === topics.status("zone-a") && m.body.online)?.body as ZoneStatus | undefined,
  );
  expect(status.online).toBe(true);

  const telemetry = await waitFor(
    () => received.find((m) => m.topic === topics.telemetry("zone-a"))?.body as Telemetry | undefined,
  );
  expect(telemetry.zoneId).toBe("zone-a");
  expect(telemetry.actuators.pump).toBe(false);
});

test("runs a pump command over MQTT and reports the real outcome", async () => {
  await client.publishAsync(
    topics.command("zone-a", "pump"),
    JSON.stringify({ commandId: "e2e-1", action: "on", durationSec: 0.3 }),
    { qos: 1 },
  );
  await waitFor(findAck("e2e-1", "accepted"));
  const completed = await waitFor(findAck("e2e-1", "completed"));
  expect(completed.reason).toBe("duration_elapsed");
});

test("ignores malformed commands and keeps serving", async () => {
  await client.publishAsync(topics.command("zone-a", "pump"), "not json", { qos: 1 });
  await client.publishAsync(topics.command("zone-a", "pump"), JSON.stringify({ commandId: "e2e-2", action: "off" }), {
    qos: 1,
  });
  await waitFor(findAck("e2e-2", "completed"));
});

test("stopping marks zones offline", async () => {
  received.length = 0;
  await simulator.stop();
  const status = await waitFor(
    () => received.find((m) => m.topic === topics.status("zone-b") && !m.body.online)?.body as ZoneStatus | undefined,
  );
  expect(status.online).toBe(false);
});

test("stopping does not hang when the broker is already gone", async () => {
  const lonely = startSimulator({ brokerUrl: "mqtt://127.0.0.1:18839" });
  await Bun.sleep(50);
  await lonely.stop();
});

test("readings do not pile up in memory while the broker is down", async () => {
  const lonely = startSimulator({ brokerUrl: "mqtt://127.0.0.1:18839", tickMs: 10, telemetryMs: 5 });
  await Bun.sleep(300);
  expect(lonely.queuedMessages()).toBe(0);
  await lonely.stop();
});

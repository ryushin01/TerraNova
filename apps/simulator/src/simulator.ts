import { type CommandAck, isActuator, parseCommand, topics, ZONE_IDS, type ZoneStatus } from "@terranova/shared";
import mqtt from "mqtt";
import { ZoneDevice } from "./device";

export interface SimulatorOptions {
  brokerUrl: string;
  tickMs?: number;
  telemetryMs?: number;
  pumpFailRate?: number;
  soilDryRate?: number;
  initialSoil?: number;
}

const statusPayload = (zoneId: string, online: boolean) => JSON.stringify({ zoneId, online } satisfies ZoneStatus);

/**
 * One MQTT connection per zone, so a Last Will reports each zone offline independently,
 * the way separate physical controllers would behave.
 */
export function startSimulator({
  brokerUrl,
  tickMs = 1000,
  telemetryMs = 2000,
  pumpFailRate = 0,
  soilDryRate,
  initialSoil,
}: SimulatorOptions) {
  const zones = ZONE_IDS.map((zoneId) => {
    const device = new ZoneDevice({ zoneId, pumpFailRate, soilDryRate, initialSoil });
    const client = mqtt.connect(brokerUrl, {
      clientId: `terranova-sim-${zoneId}`,
      // Old readings are worthless after an outage, and queueing them grows without limit.
      queueQoSZero: false,
      will: { topic: topics.status(zoneId), payload: Buffer.from(statusPayload(zoneId, false)), qos: 1, retain: true },
    });

    const publishAcks = (acks: CommandAck[]) => {
      for (const ack of acks) {
        client.publish(topics.ack(zoneId, ack.actuator), JSON.stringify(ack), { qos: 1 });
      }
    };

    client.on("connect", () => {
      client.subscribe(`terranova/zones/${zoneId}/actuators/+/command`, { qos: 1 });
      client.publish(topics.status(zoneId), statusPayload(zoneId, true), { qos: 1, retain: true });
    });

    client.on("message", (topic, payload) => {
      const actuator = topic.split("/")[4];
      const command = parseCommand(payload.toString());
      if (!isActuator(actuator) || !command) {
        console.warn(`[simulator] ignored invalid command on ${topic}`);
        return;
      }
      publishAcks(device.handleCommand(actuator, command, Date.now()));
      // Report the new state right away so screens don't wait for the next interval.
      client.publish(topics.telemetry(zoneId), JSON.stringify(device.telemetry(Date.now())), { retain: true });
    });

    client.on("error", (error) => console.error(`[simulator] ${zoneId}: ${error.message}`));

    return { zoneId, device, client, publishAcks };
  });

  const tickTimer = setInterval(() => {
    for (const { device, publishAcks } of zones) {
      publishAcks(device.tick(tickMs / 1000, Date.now()));
    }
  }, tickMs);

  const telemetryTimer = setInterval(() => {
    for (const { zoneId, device, client } of zones) {
      client.publish(topics.telemetry(zoneId), JSON.stringify(device.telemetry(Date.now())), {
        qos: 0,
        retain: true,
      });
    }
  }, telemetryMs);

  return {
    /** Messages waiting for the broker. Exposed so tests can check nothing builds up. */
    queuedMessages: () => zones.reduce((total, { client }) => total + client.queue.length, 0),
    async stop() {
      clearInterval(tickTimer);
      clearInterval(telemetryTimer);
      await Promise.all(
        zones.map(async ({ zoneId, client }) => {
          // With the broker gone a publish would wait forever and keep this process alive.
          if (client.connected) {
            await client.publishAsync(topics.status(zoneId), statusPayload(zoneId, false), {
              qos: 1,
              retain: true,
            });
          }
          await client.endAsync(!client.connected);
        }),
      );
    },
  };
}

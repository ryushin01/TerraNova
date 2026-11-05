import { createServer } from "node:net";
import { DEFAULT_MQTT_PORT } from "@terranova/shared";
import { Aedes } from "aedes";

export interface BrokerOptions {
  port?: number;
}

/**
 * Embedded MQTT broker for local use. It has no authentication, so it listens on
 * loopback only: anything that can reach it can operate the pumps.
 */
export async function startBroker({ port = DEFAULT_MQTT_PORT }: BrokerOptions = {}) {
  const aedes = await Aedes.createBroker();
  const server = createServer(aedes.handle);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  return {
    port,
    stop: () =>
      new Promise<void>((resolve) => {
        aedes.close(() => server.close(() => resolve()));
      }),
  };
}

/**
 * Tests run the real app on their own ports, so they can run beside `bun run dev`. To run two
 * copies at once, give the second a different offset: E2E_PORT_OFFSET=100 bun run test:e2e
 */
const offset = Number(process.env.E2E_PORT_OFFSET ?? 0);

export const WEB_PORT = 23000 + offset;
export const BACKEND_PORT = 24000 + offset;
export const MQTT_PORT = 21883 + offset;
export const LAN_PORT = 28443 + offset;

export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
export const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

/** Everything the app needs to know about these ports. */
export const PORT_ENV = {
  PORT: String(WEB_PORT),
  WEB_PORT: String(WEB_PORT),
  BACKEND_PORT: String(BACKEND_PORT),
  MQTT_PORT: String(MQTT_PORT),
  MQTT_URL: `mqtt://127.0.0.1:${MQTT_PORT}`,
  NEXT_PUBLIC_WEB_PORT: String(WEB_PORT),
  NEXT_PUBLIC_BACKEND_PORT: String(BACKEND_PORT),
};

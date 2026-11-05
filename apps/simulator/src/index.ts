import { DEFAULT_MQTT_PORT, ZONE_IDS } from "@terranova/shared";
import { startSimulator } from "./simulator";

const brokerUrl = process.env.MQTT_URL ?? `mqtt://127.0.0.1:${DEFAULT_MQTT_PORT}`;
const pumpFailRate = Number(process.env.SIM_PUMP_FAIL_RATE ?? 0);

const soilDryRate = process.env.SIM_SOIL_DRY_RATE ? Number(process.env.SIM_SOIL_DRY_RATE) : undefined;

const initialSoil = process.env.SIM_INITIAL_SOIL ? Number(process.env.SIM_INITIAL_SOIL) : undefined;

const simulator = startSimulator({ brokerUrl, pumpFailRate, soilDryRate, initialSoil });
console.log(`[simulator] ${ZONE_IDS.length} zones -> ${brokerUrl}`);

const shutdown = async () => {
  // A stuck connection must never leave a background process running after Ctrl+C.
  setTimeout(() => process.exit(1), 3000).unref();
  await simulator.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

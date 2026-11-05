/** Fills a database with a day of plausible readings, so README charts show a real-looking shape. */
import { sensorSamples } from "../apps/server/src/db/schema";
import { openDatabase } from "../apps/server/src/db";

const STEP_MS = 10 * 60_000;
const SAMPLES = 144;
const database = await openDatabase(process.argv[2]!);
const start = Math.floor((Date.now() - STEP_MS * SAMPLES) / STEP_MS) * STEP_MS;

const rows = Array.from({ length: SAMPLES }, (_, index) => {
  const day = (index / SAMPLES) * 2 * Math.PI;
  return {
    zoneId: "zone-a",
    at: new Date(start + index * STEP_MS),
    temperatureC: 24 + 4 * Math.sin(day - 1) + Math.sin(index * 1.7) * 0.3,
    humidityPct: 62 - 8 * Math.sin(day - 1) + Math.sin(index * 2.3) * 0.8,
    // Dries slowly, with one watering partway through.
    soilMoisturePct: index < 80 ? 58 - index * 0.25 : 62 - (index - 80) * 0.25,
  };
});
await database.db.insert(sensorSamples).values(rows);
await database.close();

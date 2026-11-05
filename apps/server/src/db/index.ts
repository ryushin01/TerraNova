import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

/** Opens the embedded database. Without a dataDir it lives in memory, which tests rely on. */
export async function openDatabase(dataDir?: string) {
  const client = new PGlite(dataDir);
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: join(import.meta.dir, "../../drizzle") });
  return { db, close: () => client.close() };
}

export type Database = Awaited<ReturnType<typeof openDatabase>>["db"];

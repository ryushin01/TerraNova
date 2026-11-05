import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

/** Opens the embedded database. Without a dataDir it lives in memory, which tests rely on. */
export async function openDatabase(dataDir?: string) {
  // PGlite creates its own folder but not the ones above it, which a fresh checkout doesn't have.
  if (dataDir) mkdirSync(dirname(dataDir), { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: join(import.meta.dir, "../../drizzle") });
  return { db, close: () => client.close() };
}

export type Database = Awaited<ReturnType<typeof openDatabase>>["db"];

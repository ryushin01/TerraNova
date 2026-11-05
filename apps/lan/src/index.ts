import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { startProxy } from "./proxy";

const PORT = Number(process.env.LAN_PORT ?? 8443);
const WEB_PORT = 3000;
const BACKEND_PORT = 4000;
const root = join(import.meta.dir, "../../..");

function lanAddress(): string {
  const address = Object.values(networkInterfaces())
    .flat()
    .find((item) => item && item.family === "IPv4" && !item.internal)?.address;
  if (!address) throw new Error("No network connection found. Connect to Wi-Fi and try again.");
  return address;
}

/** A self-signed certificate for this address, remade when the address changes. */
function loadCertificate(dir: string, address: string): { key: string; cert: string } {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  const addressPath = join(dir, "address");
  const current = existsSync(addressPath) && readFileSync(addressPath, "utf8") === address;
  if (!current || !existsSync(keyPath) || !existsSync(certPath)) {
    rmSync(keyPath, { force: true });
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "365",
        "-subj",
        "/CN=TerraNova",
        "-addext",
        `subjectAltName=IP:${address},IP:127.0.0.1,DNS:localhost`,
      ],
      { stdio: "ignore" },
    );
    writeFileSync(addressPath, address);
  }
  return { key: readFileSync(keyPath, "utf8"), cert: readFileSync(certPath, "utf8") };
}

async function untilUp(url: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      await fetch(url, { redirect: "manual" });
      return;
    } catch {
      await Bun.sleep(100);
    }
  }
  throw new Error(`${url} did not start`);
}

const address = lanAddress();
const publicOrigin = `https://${address}:${PORT}`;
const dataDir = process.env.DATA_DIR ?? join(root, "apps/server/.data/pglite");
const children: ChildProcess[] = [];

let stopProxy = () => {};
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  stopProxy();
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(), 1500);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function run(dir: string, command: string[], env: Record<string, string> = {}): void {
  const child = spawn(command[0]!, command.slice(1), {
    cwd: join(root, dir),
    env: { ...process.env, NODE_ENV: "production", ...env },
    stdio: ["ignore", "inherit", "inherit"],
  });
  children.push(child);
  // Without this, a crashed part would leave the rest running and looking fine.
  child.once("exit", (code) => {
    if (shuttingDown) return;
    console.error(`\n${dir} stopped unexpectedly (exit code ${code}). Shutting down.`);
    process.exitCode = 1;
    shutdown();
  });
}

run("apps/server", ["bun", "src/index.ts"], {
  DATA_DIR: dataDir,
  PUBLIC_ORIGIN: publicOrigin,
  EXTRA_ORIGINS: `https://localhost:${PORT},https://127.0.0.1:${PORT}`,
});
run("apps/simulator", ["bun", "src/index.ts"]);
run("apps/web", ["bun", "run", "start"]);
await untilUp(`http://127.0.0.1:${BACKEND_PORT}/`);
await untilUp(`http://127.0.0.1:${WEB_PORT}/ko/login`);

const proxy = await startProxy({
  port: PORT,
  host: "0.0.0.0",
  webPort: WEB_PORT,
  backendPort: BACKEND_PORT,
  tls: loadCertificate(join(dirname(dataDir), "lan-certificate"), address),
});
stopProxy = proxy.stop;

console.log(`
TerraNova is open on your network.

  Phone or tablet (same Wi-Fi):  ${publicOrigin}
  This computer:                 https://localhost:${PORT}

New install? Create the admin account on this computer first.
The certificate is self-signed, so browsers show a warning you need to accept once.
Press Ctrl+C to stop.
`);

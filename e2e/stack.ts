import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKEND_URL, PORT_ENV } from "./ports";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND = BACKEND_URL;

type Env = Record<string, string>;

/** Set E2E_LOG_DIR to keep each process's output when a test needs diagnosing. */
function logTarget(dir: string): number | "ignore" {
  const logDir = process.env.E2E_LOG_DIR;
  if (!logDir) return "ignore";
  mkdirSync(logDir, { recursive: true });
  return openSync(join(logDir, `${dir.replaceAll("/", "-")}.log`), "a");
}

/** Processes a test asked to stop, so any other exit can be reported as a crash. */
const stopping = new WeakSet<ChildProcess>();

function run(dir: string, env: Env): ChildProcess {
  const output = logTarget(dir);
  const child = spawn("bun", ["src/index.ts"], {
    cwd: join(root, dir),
    env: { ...process.env, ...PORT_ENV, ...env },
    stdio: ["ignore", output, output],
  });
  child.once("exit", (code, signal) => {
    if (!stopping.has(child)) console.error(`[e2e] ${dir} exited unexpectedly: code ${code}, signal ${signal}`);
  });
  return child;
}

function stop(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null) return Promise.resolve();
  stopping.add(child);
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

async function backendUp(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await fetch(`${BACKEND}/health-check`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("backend did not start");
}

/** A real backend and simulator using a throwaway database, for one spec file. */
export class Stack {
  private readonly dataRoot = mkdtempSync(join(tmpdir(), "terranova-e2e-"));
  private server: ChildProcess | null = null;
  private simulator: ChildProcess | null = null;

  constructor(
    private serverEnv: Env = {},
    private simulatorEnv: Env = {},
  ) {}

  get dataDir(): string {
    return join(this.dataRoot, "db");
  }

  async startServer(env: Env = this.serverEnv): Promise<void> {
    this.serverEnv = env;
    this.server = run("apps/server", { DATA_DIR: this.dataDir, WATERING_TIMES: "", ...env });
    await backendUp();
  }

  stopServer = () => stop(this.server);

  startSimulator(env: Env = this.simulatorEnv): void {
    this.simulator = run("apps/simulator", env);
  }

  stopSimulator = () => stop(this.simulator);

  async restartServer(env?: Env): Promise<void> {
    await this.stopServer();
    await this.startServer(env);
  }

  async start(): Promise<void> {
    await this.startServer();
    this.startSimulator();
  }

  async stop(): Promise<void> {
    await this.stopSimulator();
    await this.stopServer();
    rmSync(this.dataRoot, { recursive: true, force: true });
  }

  triggerAlarm(zone: string): Promise<Response> {
    return fetch(`${BACKEND}/dev/alarms/${zone}`, { method: "POST" });
  }
}

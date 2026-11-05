/**
 * Sends many page requests to a production build of the web server and reports its memory.
 * Only resident memory is available from outside the process, so look for steady growth
 * across the run rather than reading any single value.
 *
 *   bun run memory:web [rounds]    each round is 1,000 requests
 */
import { dirname, join } from "node:path";
import { PORT_ENV, WEB_PORT } from "../ports";

const rounds = Number(process.argv[2] ?? 30);
const root = join(dirname(import.meta.dir), "../apps/web");
const env = { ...process.env, ...PORT_ENV };

const build = Bun.spawnSync(["bun", "run", "build"], { cwd: root, env, stdout: "ignore", stderr: "inherit" });
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);

const server = Bun.spawn(["bun", "run", "start"], { cwd: root, env, stdout: "ignore", stderr: "inherit" });
const base = `http://localhost:${WEB_PORT}`;
for (let attempt = 0; attempt < 80; attempt++) {
  try {
    await fetch(`${base}/ko/login`, { redirect: "manual" });
    break;
  } catch {
    await Bun.sleep(250);
  }
}

const pid = Bun.spawnSync(["sh", "-c", `lsof -nP -iTCP:${WEB_PORT} -sTCP:LISTEN -t | head -1`])
  .stdout.toString()
  .trim();
const rssMB = () => Number(Bun.spawnSync(["ps", "-o", "rss=", "-p", pid]).stdout.toString().trim()) / 1024;

// A forged cookie gets past the first redirect check, so these requests render the full pages.
const headers = { cookie: "better-auth.session_token=fake.value" };
const paths = ["/ko/login", "/en/login", "/ko/setup", "/ko", "/en", "/ko/users", "/ko/sensors", "/ko/history"];
let failures = 0;
const hit = async (path: string) => {
  try {
    const response = await fetch(base + path, { headers, redirect: "manual" });
    await response.arrayBuffer();
    if (response.status >= 500) failures++;
  } catch {
    failures++;
  }
};

const samples: number[] = [];
for (let round = 1; round <= rounds; round++) {
  for (let batch = 0; batch < 40; batch++) {
    await Promise.all(Array.from({ length: 25 }, (_, index) => hit(paths[index % paths.length]!)));
  }
  await Bun.sleep(800);
  samples.push(rssMB());
  if (round % 5 === 0 || round === rounds) {
    console.log(`round ${round}: ${round * 1000} requests, rss ${samples.at(-1)!.toFixed(0)}MB, failures ${failures}`);
  }
}

const average = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;
const half = Math.floor(samples.length / 2);
const skip = Math.floor(half / 2);
console.log(
  `\navg rss, middle ${average(samples.slice(skip, half)).toFixed(0)}MB, last half ${average(samples.slice(half)).toFixed(0)}MB, failures ${failures}`,
);

server.kill("SIGTERM");
await server.exited;
process.exit(failures > 0 ? 1 : 0);

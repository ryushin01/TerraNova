import { afterAll, beforeAll, expect, test } from "bun:test";
import { startProxy } from "../src/proxy";

let web: ReturnType<typeof Bun.serve>;
let backend: ReturnType<typeof Bun.serve>;
let proxy: Awaited<ReturnType<typeof startProxy>>;
const BASE = "http://127.0.0.1:18443";

const json = async (path: string) => (await (await fetch(`${BASE}${path}`)).json()) as { name: string };

const echo = (name: string) => (req: Request) =>
  Response.json({
    name,
    path: new URL(req.url).pathname,
    forwardedFor: req.headers.get("x-forwarded-for"),
    proto: req.headers.get("x-forwarded-proto"),
  });

beforeAll(async () => {
  web = Bun.serve({
    port: 13000,
    hostname: "127.0.0.1",
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/redirect") {
        return new Response(null, { status: 307, headers: { location: "http://127.0.0.1:3000/ko/login?x=1" } });
      }
      if (pathname === "/elsewhere") {
        return new Response(null, { status: 307, headers: { location: "https://example.com/ok" } });
      }
      return echo("web")(req);
    },
  });
  backend = Bun.serve({ port: 14000, hostname: "127.0.0.1", fetch: echo("backend") });
  proxy = await startProxy({ port: 18443, host: "127.0.0.1", webPort: 13000, backendPort: 14000 });
});

afterAll(() => {
  proxy.stop();
  web.stop(true);
  backend.stop(true);
});

test("live data goes to the backend and everything else to the web server", async () => {
  expect((await json("/socket.io/?x=1")).name).toBe("backend");
  expect((await json("/ko")).name).toBe("web");
  expect((await json("/socket.iox")).name).toBe("web");
  expect((await json("/api/auth/session")).name).toBe("web");
});

test("a client cannot claim a different address", async () => {
  const response = await fetch(`${BASE}/ko`, { headers: { "x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "http" } });
  const seen = (await response.json()) as { forwardedFor: string; proto: string };
  expect(seen.forwardedFor).not.toContain("203.0.113.9");
  expect(seen.proto).toBe("https");
});

test("internal redirects become relative, other sites are left alone", async () => {
  const internal = await fetch(`${BASE}/redirect`, { redirect: "manual" });
  expect(internal.headers.get("location")).toBe("/ko/login?x=1");
  const external = await fetch(`${BASE}/elsewhere`, { redirect: "manual" });
  expect(external.headers.get("location")).toBe("https://example.com/ok");
});

test("a local request can reach setup", async () => {
  const response = await fetch(`${BASE}/api/setup`, { method: "POST", body: "{}" });
  expect(response.status).toBe(200);
});

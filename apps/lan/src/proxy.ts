import { connect } from "node:net";
import { createServer, request, type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import { createServer as createHttpsServer } from "node:https";

export interface ProxyOptions {
  port: number;
  host: string;
  webPort: number;
  backendPort: number;
  tls?: { key: string; cert: string };
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

const isSocketPath = (url: string | undefined) => url === "/socket.io" || !!url?.startsWith("/socket.io/");

function isLocal(req: IncomingMessage): boolean {
  return LOOPBACK.has(req.socket.remoteAddress ?? "");
}

/** Replaces anything the client claimed about itself with what this connection really is. */
function forwardedHeaders(req: IncomingMessage): IncomingHttpHeaders {
  return {
    ...req.headers,
    "x-forwarded-for": req.socket.remoteAddress ?? "",
    "x-forwarded-proto": "https",
    "x-forwarded-host": req.headers.host,
  };
}

/** Next.js builds redirects from the address it listens on, which a phone can't reach. */
function publicLocation(location: string | string[] | undefined): string | string[] | undefined {
  if (typeof location !== "string") return location;
  return location.replace(/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?=\/|$)/, "");
}

/**
 * The only thing reachable from the network. Pages go to Next.js and live data to the backend,
 * both of which stay on loopback; the MQTT broker is never reachable through here.
 */
export function startProxy({ port, host, webPort, backendPort, tls }: ProxyOptions) {
  const handler = (req: IncomingMessage, res: import("node:http").ServerResponse) => {
    // A new install's first admin must be created by someone at this computer.
    if (req.url === "/api/setup" && req.method === "POST" && !isLocal(req)) {
      res.writeHead(403).end();
      return;
    }

    const upstream = request(
      {
        host: "127.0.0.1",
        port: isSocketPath(req.url) ? backendPort : webPort,
        method: req.method,
        path: req.url,
        headers: forwardedHeaders(req),
      },
      (response) => {
        const headers = { ...response.headers };
        const location = publicLocation(response.headers.location);
        if (location !== undefined) headers.location = location as string;
        res.writeHead(response.statusCode ?? 502, headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  };

  const server = tls ? createHttpsServer(tls, handler) : createServer(handler);

  server.on("upgrade", (req, client, head) => {
    if (!isSocketPath(req.url)) {
      client.destroy();
      return;
    }
    const upstream = connect(backendPort, "127.0.0.1", () => {
      const headers = Object.entries(forwardedHeaders(req)).flatMap(([name, value]) =>
        (Array.isArray(value) ? value : [value ?? ""]).map((item) => `${name}: ${item}`),
      );
      upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    const closeBoth = () => {
      upstream.destroy();
      client.destroy();
    };
    upstream.on("error", closeBoth);
    client.on("error", closeBoth);
    upstream.on("close", closeBoth);
    client.on("close", closeBoth);
  });

  return new Promise<{ stop: () => void }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      resolve({
        stop: () => {
          server.closeAllConnections?.();
          server.close();
        },
      });
    });
  });
}

import { createServer, request } from "node:http";

// The standalone local Auth container serves paths at /; Supabase clients use /auth/v1.
// Bind only to loopback. No database, token, or credential is sent through a hosted proxy.
createServer((incoming, outgoing) => {
  if (!incoming.url?.startsWith("/auth/v1/")) {
    outgoing.writeHead(404).end();
    return;
  }
  const path = incoming.url.slice("/auth/v1".length);
  const upstream = request({
    hostname: "127.0.0.1",
    port: 54325,
    path,
    method: incoming.method,
    headers: { ...incoming.headers, host: "127.0.0.1:54325" },
  }, (response) => {
    outgoing.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(outgoing);
  });
  upstream.on("error", () => {
    if (!outgoing.headersSent) outgoing.writeHead(502);
    outgoing.end();
  });
  incoming.pipe(upstream);
}).listen(54321, "127.0.0.1");

import http from "node:http";
import crypto from "node:crypto";

const port = Number(process.env.KAMRA_GATEWAY_PORT || 8788);
const upstreamBase = (process.env.KAMRA_UPSTREAM_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const upstreamHost = process.env.KAMRA_UPSTREAM_HOST || "kamra.localhost";
const publicKey = process.env.KAMRA_GATEWAY_API_KEY;
const publicSecret = process.env.KAMRA_GATEWAY_API_SECRET;
const upstreamKey = process.env.KAMRA_UPSTREAM_API_KEY;
const upstreamSecret = process.env.KAMRA_UPSTREAM_API_SECRET;
const writesEnabled = process.env.KAMRA_GATEWAY_WRITE_ENABLED === "true";
const allowedMethods = new Set([
  "/api/method/kamra.api.guest_search",
  "/api/method/kamra.api.find_reservations",
  "/api/method/kamra.api.front_desk_snapshot",
  ...(writesEnabled ? [
    "/api/method/kamra.api.create_booking",
    "/api/method/kamra.api.amend_stay",
    "/api/method/kamra.api.move_reservation",
    "/api/method/kamra.api.check_in",
    "/api/method/kamra.api.check_out",
    "/api/method/kamra.api.set_housekeeping_status",
  ] : []),
]);
const MAX_BODY = 16 * 1024;
const MAX_RESPONSE = 2 * 1024 * 1024;

function required(name, value) {
  if (!value) throw new Error(`missing_${name}`);
  return value;
}

required("KAMRA_GATEWAY_API_KEY", publicKey);
required("KAMRA_GATEWAY_API_SECRET", publicSecret);
required("KAMRA_UPSTREAM_API_KEY", upstreamKey);
required("KAMRA_UPSTREAM_API_SECRET", upstreamSecret);

function same(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function authorized(request) {
  const match = String(request.headers.authorization || "").match(/^token\s+([^:]+):(.+)$/i);
  return !!match && same(match[1], publicKey) && same(match[2], publicSecret);
}

function send(response, status, body, extra = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...extra,
  });
  response.end(payload);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function requestUpstream(path, body, requestId) {
  const target = new URL(upstreamBase);
  return new Promise((resolve, reject) => {
    const upstream = http.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 80,
      path,
      method: "POST",
      timeout: 8000,
      headers: {
        Authorization: `token ${upstreamKey}:${upstreamSecret}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        Host: upstreamHost,
        "X-Request-ID": requestId,
      },
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size <= MAX_RESPONSE) chunks.push(chunk);
      });
      response.on("end", () => resolve({ status: response.statusCode || 502, contentType: response.headers["content-type"], body: Buffer.concat(chunks), tooLarge: size > MAX_RESPONSE }));
    });
    upstream.on("timeout", () => upstream.destroy(new Error("upstream_timeout")));
    upstream.on("error", reject);
    upstream.end(body);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://gateway.local");
  if (request.method === "GET" && url.pathname === "/healthz") {
    return send(response, 200, { ok: true, service: "kamra-readonly-gateway", readOnly: !writesEnabled });
  }
  if (request.method !== "POST") return send(response, 405, { ok: false, error: "method_not_allowed" });
  if (!allowedMethods.has(url.pathname)) return send(response, 404, { ok: false, error: "readonly_method_not_allowed" });
  if (!authorized(request)) return send(response, 401, { ok: false, error: "invalid_gateway_credentials" });

  let body;
  try {
    body = await readBody(request);
    if (body) JSON.parse(body);
  } catch (error) {
    return send(response, error?.message === "request_too_large" ? 413 : 400, { ok: false, error: "invalid_json" });
  }

  const requestId = String(request.headers["x-request-id"] || crypto.randomUUID()).slice(0, 120);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const upstream = await requestUpstream(url.pathname, body || "{}", requestId);
    const payload = upstream.body;
    if (upstream.tooLarge) return send(response, 502, { ok: false, error: "upstream_response_too_large" });
    response.writeHead(upstream.status, {
      "Content-Type": upstream.contentType || "application/json; charset=utf-8",
      "Content-Length": payload.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    response.end(payload);
    console.log(JSON.stringify({ method: request.method, path: url.pathname, status: upstream.status, requestId }));
  } catch (error) {
    const code = error?.name === "AbortError" ? "upstream_timeout" : "upstream_unavailable";
    send(response, 502, { ok: false, error: code });
    console.error(JSON.stringify({ method: request.method, path: url.pathname, error: code, requestId }));
  } finally {
    clearTimeout(timer);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(JSON.stringify({ service: "kamra-readonly-gateway", address: `http://127.0.0.1:${port}`, readOnly: true }));
});

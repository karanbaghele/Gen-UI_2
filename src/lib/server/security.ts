import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "request_failed",
  ) {
    super(message);
  }
}
export const isLoopbackHost = (hostname: string) =>
  ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname.toLowerCase());

export function localUrl(value: string | undefined, label: string): URL {
  if (!value)
    throw new HttpError(
      503,
      `${label} is not configured. Follow the local setup guide.`,
      "configuration_missing",
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(
      503,
      `${label} has an invalid URL.`,
      "configuration_invalid",
    );
  }
  if (!isLoopbackHost(url.hostname))
    throw new HttpError(
      503,
      `${label} must point to a local service.`,
      "local_service_required",
    );
  return url;
}

export function serviceUrl(value: string | undefined, label: string): URL {
  if (!value)
    throw new HttpError(503, `${label} is not configured.`, "configuration_missing");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(503, `${label} has an invalid URL.`, "configuration_invalid");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    (!isLoopbackHost(url.hostname) && url.protocol !== "https:") ||
    url.username ||
    url.password
  )
    throw new HttpError(
      503,
      `${label} must use HTTPS outside localhost.`,
      "configuration_invalid",
    );
  return url;
}

export function assertSameOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  const expected = serviceUrl(
    process.env.APP_URL ?? "http://127.0.0.1:3000",
    "Application URL",
  ).origin;
  if (origin !== expected)
    throw new HttpError(
      403,
      "This request must originate from this application.",
      "origin_mismatch",
    );
}

export function assertLocalTestAuth(
  requestUrl: string,
  token: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (env.NODE_ENV === "production" || env.GENUI_TEST_AUTH !== "true")
    return false;
  const configured = env.GENUI_TEST_AUTH_TOKEN;
  if (
    !configured ||
    configured.length < 32 ||
    !token ||
    !isLoopbackHost(new URL(requestUrl).hostname)
  )
    return false;
  const given = Buffer.from(token);
  const expected = Buffer.from(configured);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function encryptionKey() {
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!key || !/^[0-9a-f]{64}$/i.test(key))
    throw new HttpError(
      503,
      "A 32-byte credential encryption key must be configured on the server.",
      "encryption_unconfigured",
    );
  return Buffer.from(key, "hex");
}
export function encryptSecret(value: string, context: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    nonce.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}
export function decryptSecret(value: string, context: string) {
  const [version, nonce, tag, body] = value.split(".");
  if (version !== "v1" || !nonce || !tag || !body)
    throw new HttpError(
      503,
      "Stored source credentials are invalid.",
      "credentials_invalid",
    );
  const cipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(nonce, "base64url"),
  );
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    cipher.update(Buffer.from(body, "base64url")),
    cipher.final(),
  ]).toString("utf8");
}

const buckets = new Map<string, { count: number; until: number }>();
export function rateLimit(key: string, maximum = 60, windowMs = 60_000) {
  const now = Date.now();
  if (buckets.size > 10_000)
    for (const [id, entry] of buckets)
      if (entry.until <= now) buckets.delete(id);
  const bucket = buckets.get(key);
  if (!bucket || bucket.until <= now) {
    buckets.set(key, { count: 1, until: now + windowMs });
    return;
  }
  if (++bucket.count > maximum)
    throw new HttpError(
      429,
      "Too many requests. Please wait a moment and try again.",
      "rate_limited",
    );
}

export function assertCanWrite(role: string) {
  if (!["admin", "analyst"].includes(role))
    throw new HttpError(
      403,
      "Your workspace role does not allow editing.",
      "forbidden",
    );
}

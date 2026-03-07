/**
 * JWT authentication for dashboard WebSocket connections.
 * Uses HMAC-SHA256 for signing — no external deps needed.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createChildLogger } from "../logger/index.js";

const log = createChildLogger("security:jwt");

export interface JwtPayload {
  sub: string;       // Actor / user ID
  iss: string;       // Issuer ("scb")
  iat: number;       // Issued at (unix seconds)
  exp: number;       // Expiry (unix seconds)
  origin: "web" | "telegram";
}

const HEADER = { alg: "HS256", typ: "JWT" };

function base64url(data: string | Buffer): string {
  const b = typeof data === "string" ? Buffer.from(data) : data;
  return b.toString("base64url");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Issue a new JWT token for a dashboard session.
 */
export function issueToken(
  actorId: string,
  secret: string,
  origin: "web" | "telegram" = "web",
  ttlSeconds = 86400
): string {
  const now = Math.floor(Date.now() / 1000);

  const payload: JwtPayload = {
    sub: actorId,
    iss: "scb",
    iat: now,
    exp: now + ttlSeconds,
    origin,
  };

  const headerB64 = base64url(JSON.stringify(HEADER));
  const payloadB64 = base64url(JSON.stringify(payload));
  const unsigned = `${headerB64}.${payloadB64}`;
  const signature = sign(unsigned, secret);

  return `${unsigned}.${signature}`;
}

/**
 * Verify and decode a JWT token.
 * Returns the payload if valid, null otherwise.
 */
export function verifyToken(
  token: string,
  secret: string
): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;

    // Validate algorithm to prevent algorithm confusion attacks
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf-8"));
    if (header.alg !== "HS256") {
      log.warn({ alg: header.alg }, "JWT invalid algorithm");
      return null;
    }

    // Verify signature using timing-safe comparison
    const unsigned = `${headerB64}.${payloadB64}`;
    const expectedSig = sign(unsigned, secret);

    const sigBuf = Buffer.from(signatureB64!, "base64url");
    const expectedBuf = Buffer.from(expectedSig, "base64url");

    if (sigBuf.length !== expectedBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expectedBuf)) {
      log.warn("JWT signature mismatch — possible tampering");
      return null;
    }

    // Decode payload
    const payload: JwtPayload = JSON.parse(
      Buffer.from(payloadB64!, "base64url").toString("utf-8")
    );

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      log.debug({ sub: payload.sub }, "JWT expired");
      return null;
    }

    // Validate issuer
    if (payload.iss !== "scb") {
      log.warn({ iss: payload.iss }, "JWT invalid issuer");
      return null;
    }

    return payload;
  } catch (err) {
    log.warn({ err }, "JWT verification failed");
    return null;
  }
}

/**
 * Generate a random JWT secret (64 bytes hex).
 */
export function generateJwtSecret(): string {
  return randomBytes(64).toString("hex");
}

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const catalogSessionCookie = "trip-catalog-session";
export const catalogSessionMaxAge = 30 * 24 * 60 * 60;

export interface CatalogAuthConfig {
  password: string;
  sessionSecret: string;
  encryptionKey: string;
}

export function catalogAuthConfig(): CatalogAuthConfig | null {
  const password = process.env.TRIP_CATALOG_PASSWORD;
  const sessionSecret = process.env.TRIP_CATALOG_SESSION_SECRET;
  const encryptionKey = process.env.TRIP_CATALOG_ENCRYPTION_KEY;
  if (!password || !sessionSecret || !encryptionKey) return null;
  return { password, sessionSecret, encryptionKey };
}

function signature(payload: string, config: CatalogAuthConfig) {
  return createHmac("sha256", `${config.sessionSecret}:${config.password}`)
    .update(payload)
    .digest("base64url");
}

function equal(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

// @spec CAT-API-001, CAT-SEC-001
export function passwordIsValid(password: string, config: CatalogAuthConfig) {
  return equal(password, config.password);
}

// @spec CAT-API-001, CAT-SEC-002
export function createCatalogSession(
  config: CatalogAuthConfig,
  now = Date.now(),
) {
  const payload = `${Math.floor(now / 1000) + catalogSessionMaxAge}.${randomBytes(16).toString("base64url")}`;
  return `${payload}.${signature(payload, config)}`;
}

// @spec CAT-API-002, CAT-SEC-002
export function sessionIsValid(
  session: string | undefined,
  config: CatalogAuthConfig,
  now = Date.now(),
) {
  if (!session) return false;
  const [expiry, nonce, providedSignature, ...extra] = session.split(".");
  if (!expiry || !nonce || !providedSignature || extra.length) return false;
  const expiresAt = Number(expiry);
  if (!Number.isSafeInteger(expiresAt) || expiresAt * 1000 <= now) return false;
  return equal(providedSignature, signature(`${expiry}.${nonce}`, config));
}

export function sessionCookie(value: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${catalogSessionCookie}=${value}; Max-Age=${catalogSessionMaxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

export function expiredSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${catalogSessionCookie}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

export function sessionFromRequest(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(
    new RegExp(`(?:^|;\\s*)${catalogSessionCookie}=([^;]+)`),
  );
  return match?.[1];
}

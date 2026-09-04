import { createHash, randomBytes } from "node:crypto";

// @spec TRIP-BE-001
export function generateShareToken() {
  return randomBytes(16).toString("base64url");
}
export function isValidShareToken(token: string) {
  return /^[A-Za-z0-9_-]{22}$/.test(token);
}

// @spec TRIP-BE-002
export function tripKeyForToken(token: string) {
  return `trip:v1:${createHash("sha256").update(token).digest("hex")}`;
}
export function hashPrivateKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

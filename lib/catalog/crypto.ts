import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function keyFrom(value: string) {
  const key = Buffer.from(value, "base64url");
  if (key.length !== 32)
    throw new Error("Trip catalog encryption key must be 32 bytes");
  return key;
}

// @spec CAT-DATA-001, CAT-SEC-003
export function encryptCatalogToken(token: string, encryptionKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(encryptionKey), iv);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

// @spec CAT-DATA-001, CAT-SEC-003
export function decryptCatalogToken(value: string, encryptionKey: string) {
  const [version, iv, tag, encrypted, ...extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted || extra.length)
    throw new Error("Trip catalog token is invalid");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyFrom(encryptionKey),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

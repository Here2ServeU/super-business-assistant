import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

// AES-256-GCM for OAuth tokens at rest. ENCRYPTION_KEY is any long random string;
// it is stretched to 32 bytes with SHA-256.

function key() {
  return createHash("sha256").update(env.encryptionKey()).digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function decrypt(blob: string): string {
  const [v, iv, tag, body] = blob.split(".");
  if (v !== "v1") throw new Error("unknown ciphertext version");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}

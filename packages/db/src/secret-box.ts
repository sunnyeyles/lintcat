/** AES-256-GCM for secrets stored at rest, such as an organization's model key. */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { loadLocalEnv } from "./env";

const VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

// Layout: version byte, nonce, auth tag, ciphertext. `context` is bound as AAD.
export function sealSecret(key: Uint8Array, plaintext: string, context: string): Uint8Array {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.of(VERSION), nonce, cipher.getAuthTag(), ciphertext]);
}

/** Throws when the key, the context or a single byte differs from the seal. */
export function openSecret(key: Uint8Array, sealed: Uint8Array, context: string): string {
  const bytes = Buffer.from(sealed);
  if (bytes[0] !== VERSION || bytes.length < 1 + NONCE_BYTES + TAG_BYTES) {
    throw new Error("sealed secret has an unknown format");
  }
  const nonce = bytes.subarray(1, 1 + NONCE_BYTES);
  const tag = bytes.subarray(1 + NONCE_BYTES, 1 + NONCE_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(bytes.subarray(1 + NONCE_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString("utf8");
}

export function parseEncryptionKey(value: string | undefined): Buffer {
  if (!value?.trim()) {
    throw new Error("MODEL_KEY_ENCRYPTION_KEY is not set; generate one with `openssl rand -base64 32`");
  }
  const key = Buffer.from(value.trim(), "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`MODEL_KEY_ENCRYPTION_KEY must be ${KEY_BYTES} bytes of base64`);
  }
  return key;
}

/** The key that seals model keys, from MODEL_KEY_ENCRYPTION_KEY. */
export function modelKeyEncryptionKey(): Buffer {
  loadLocalEnv();
  return parseEncryptionKey(process.env.MODEL_KEY_ENCRYPTION_KEY);
}

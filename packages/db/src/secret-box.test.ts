import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { openSecret, parseEncryptionKey, sealSecret } from "./secret-box";

const key = randomBytes(32);

describe("sealSecret and openSecret", () => {
  it("round-trips a secret", () => {
    const sealed = sealSecret(key, "sk-ant-api03-secret", "org:1");
    expect(openSecret(key, sealed, "org:1")).toBe("sk-ant-api03-secret");
  });

  it("never contains the plaintext", () => {
    const sealed = sealSecret(key, "sk-ant-api03-secret", "org:1");
    expect(Buffer.from(sealed).toString("latin1")).not.toContain("sk-ant");
  });

  it("uses a fresh nonce each time", () => {
    const a = sealSecret(key, "same", "org:1");
    const b = sealSecret(key, "same", "org:1");
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("rejects another key, another context and a tampered ciphertext", () => {
    const sealed = sealSecret(key, "sk-secret", "org:1");
    expect(() => openSecret(randomBytes(32), sealed, "org:1")).toThrow();
    expect(() => openSecret(key, sealed, "org:2")).toThrow();
    const tampered = Uint8Array.from(sealed);
    tampered[tampered.length - 1]! ^= 1;
    expect(() => openSecret(key, tampered, "org:1")).toThrow();
  });
});

describe("parseEncryptionKey", () => {
  it("accepts 32 bytes of base64", () => {
    expect(parseEncryptionKey(key.toString("base64"))).toEqual(key);
  });

  it("rejects a missing or short key without echoing it", () => {
    expect(() => parseEncryptionKey(undefined)).toThrow(/MODEL_KEY_ENCRYPTION_KEY/);
    const short = randomBytes(16).toString("base64");
    expect(() => parseEncryptionKey(short)).toThrow(/32 bytes/);
    try {
      parseEncryptionKey(short);
    } catch (error) {
      expect((error as Error).message).not.toContain(short);
    }
  });
});

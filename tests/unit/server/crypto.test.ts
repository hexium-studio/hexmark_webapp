import { describe, expect, it } from "vitest";
import {
  ENCRYPTION_KEY_ENV,
  keyId,
  readInstanceSecrets,
} from "../../../apps/server/src/config/secrets";
import {
  createKeyring,
  DecryptError,
  decrypt,
  encrypt,
  type Keyring,
  sealedKeyId,
} from "../../../apps/server/src/lib/crypto";

// Encryption at rest (AES-256-GCM with key id) and the instance keys read
// from the environment (INTERNAL_API_KEY, ENCRYPTION_KEY, ENCRYPTION_KEY_PREVIOUS).

const KEY_A = Buffer.alloc(32, 0xa1);
const KEY_B = Buffer.alloc(32, 0xb2);
const ringA = createKeyring("a", [["a", KEY_A]]);
const ringB = createKeyring("b", [["b", KEY_B]]);

function failure(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof DecryptError) return error.code;
    throw error;
  }
  return undefined;
}

describe("encrypt / decrypt", () => {
  it("round trip, with and without context, including non-ASCII text", () => {
    for (const text of ["JBSWY3DPEHPK3PXP", "", "äöü – ✓ 🔑"]) {
      expect(decrypt(encrypt(text, ringA), ringA)).toBe(text);
      expect(decrypt(encrypt(text, ringA, "user:42"), ringA, "user:42")).toBe(text);
    }
  });

  it("names its key and uses a fresh IV each time", () => {
    const first = encrypt("secret", ringA);
    const second = encrypt("secret", ringA);
    expect(first).toMatch(/^v1\.a\.[A-Za-z0-9_-]+$/);
    expect(sealedKeyId(first)).toBe("a");
    expect(first).not.toBe(second);
    expect(first).not.toContain("secret");
  });

  it("detects any change to the payload", () => {
    const sealed = encrypt("secret", ringA);
    const payload = Buffer.from(sealed.slice("v1.a.".length), "base64url");
    for (const index of [0, 12, payload.length - 1]) {
      const changed = Buffer.from(payload);
      changed[index] = (changed[index] ?? 0) ^ 0x01;
      expect(failure(() => decrypt(`v1.a.${changed.toString("base64url")}`, ringA))).toBe(
        "tampered",
      );
    }
  });

  it("refuses another context (a value moved to another row)", () => {
    const sealed = encrypt("secret", ringA, "user:1");
    expect(failure(() => decrypt(sealed, ringA, "user:2"))).toBe("tampered");
    expect(failure(() => decrypt(sealed, ringA))).toBe("tampered");
  });

  it("refuses an unknown key id and a relabelled key id", () => {
    const sealed = encrypt("secret", ringA);
    expect(failure(() => decrypt(sealed, ringB))).toBe("unknown_key");
    // Relabelled to a key the ring has: the label is authenticated.
    const both = createKeyring("a", [
      ["a", KEY_A],
      ["b", KEY_A],
    ]);
    expect(failure(() => decrypt(sealed.replace("v1.a.", "v1.b."), both))).toBe("tampered");
  });

  it("refuses the wrong key under the right id", () => {
    const impostor = createKeyring("a", [["a", KEY_B]]);
    expect(failure(() => decrypt(encrypt("secret", ringA), impostor))).toBe("tampered");
  });

  it.each(["", "secret", "v2.a.AAAA", "v1..AAAA", "v1.a.", "v1.a.AAAA", "v1.a.b.c", "v1.a!.AA"])(
    "refuses the malformed value %j",
    (value) => {
      expect(failure(() => decrypt(value, ringA))).toBe("malformed");
    },
  );

  it("refuses keyrings with bad keys", () => {
    expect(() => createKeyring("a", [["a", Buffer.alloc(16)]])).toThrow();
    expect(() => createKeyring("a.b", [["a.b", KEY_A]])).toThrow();
    expect(() => createKeyring("x", [["a", KEY_A]])).toThrow();
  });
});

describe("readInstanceSecrets", () => {
  const a = KEY_A.toString("base64url");
  const b = KEY_B.toString("base64url");
  const internal = Buffer.alloc(32, 0x33).toString("base64url");

  it("valid keys: configured, keyring with the current key active", () => {
    const secrets = readInstanceSecrets({ INTERNAL_API_KEY: internal, [ENCRYPTION_KEY_ENV]: a });
    expect(secrets.problems).toEqual([]);
    expect(secrets.internalApiKey).toBe(internal);
    expect(secrets.encryption?.activeKeyId).toBe(keyId(KEY_A));
    expect([...(secrets.encryption?.keys.keys() ?? [])]).toEqual([keyId(KEY_A)]);
  });

  it("names missing and invalid variables, never their values", () => {
    const secrets = readInstanceSecrets({ ENCRYPTION_KEY: "not-a-key", INTERNAL_API_KEY: " " });
    expect(secrets.problems).toEqual(["INTERNAL_API_KEY is missing", "ENCRYPTION_KEY is invalid"]);
    expect(secrets.internalApiKey).toBeNull();
    expect(secrets.encryption).toBeNull();
    expect(secrets.problems.join(" ")).not.toContain("not-a-key");
  });

  it("an invalid ENCRYPTION_KEY_PREVIOUS is a problem; a missing one is not", () => {
    const base = { INTERNAL_API_KEY: internal, ENCRYPTION_KEY: a };
    expect(readInstanceSecrets(base).problems).toEqual([]);
    expect(readInstanceSecrets({ ...base, ENCRYPTION_KEY_PREVIOUS: "x" }).problems).toEqual([
      "ENCRYPTION_KEY_PREVIOUS is invalid",
    ]);
  });

  it("key change: values sealed with the previous key stay readable", () => {
    const before = readInstanceSecrets({ INTERNAL_API_KEY: internal, ENCRYPTION_KEY: a });
    const sealed = encrypt("totp-secret", before.encryption as Keyring, "user:1");
    const after = readInstanceSecrets({
      INTERNAL_API_KEY: internal,
      ENCRYPTION_KEY: b,
      ENCRYPTION_KEY_PREVIOUS: a,
    });
    const ring = after.encryption as Keyring;
    expect(ring.activeKeyId).toBe(keyId(KEY_B));
    expect(decrypt(sealed, ring, "user:1")).toBe("totp-secret");
    expect(sealedKeyId(encrypt("new", ring))).toBe(keyId(KEY_B));
    // Without the previous key, the old value cannot be read.
    const lost = readInstanceSecrets({ INTERNAL_API_KEY: internal, ENCRYPTION_KEY: b });
    expect(failure(() => decrypt(sealed, lost.encryption as Keyring, "user:1"))).toBe(
      "unknown_key",
    );
  });

  it("key ids are stable, short and differ per key", () => {
    expect(keyId(KEY_A)).toBe(keyId(Buffer.from(KEY_A)));
    expect(keyId(KEY_A)).not.toBe(keyId(KEY_B));
    expect(keyId(KEY_A)).toMatch(/^[A-Za-z0-9_-]{8}$/);
  });
});

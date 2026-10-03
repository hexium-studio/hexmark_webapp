import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Encryption of small secrets at rest (e.g. second-factor secrets) with
// AES-256-GCM. A sealed value is one string:
//
//   v1.<key id>.<base64url of: 12-byte IV | ciphertext | 16-byte tag>
//
// The key id names the key that sealed it, so a keyring can hold old keys
// next to the active one and values sealed with an old key stay readable
// after a new key becomes active. The prefix "v1.<key id>." and an optional
// context string (e.g. the owning row's id) are authenticated as associated
// data: a value moved to another row or relabelled with another key id does
// not open.

export const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT = "v1";
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export interface Keyring {
  // Seals new values.
  activeKeyId: string;
  // Every key that may have sealed a stored value, by id.
  keys: ReadonlyMap<string, Buffer>;
}

export type DecryptFailure = "malformed" | "unknown_key" | "tampered";

export class DecryptError extends Error {
  constructor(readonly code: DecryptFailure) {
    super(`cannot decrypt: ${code}`);
    this.name = "DecryptError";
  }
}

export function isKeyId(value: string): boolean {
  return KEY_ID_PATTERN.test(value);
}

// The keyring after checking every key's id and length; throws otherwise.
export function createKeyring(activeKeyId: string, keys: Iterable<[string, Buffer]>): Keyring {
  const map = new Map(keys);
  for (const [id, key] of map) {
    if (!isKeyId(id)) throw new Error("invalid key id");
    if (key.length !== KEY_BYTES) throw new Error(`key ${id} must be ${KEY_BYTES} bytes`);
  }
  if (!map.has(activeKeyId)) throw new Error("the active key is not in the keyring");
  return { activeKeyId, keys: map };
}

function associatedData(keyId: string, context: string): Buffer {
  return Buffer.from(`${FORMAT}.${keyId}.${context}`, "utf8");
}

export function encrypt(plaintext: string, keyring: Keyring, context = ""): string {
  const keyId = keyring.activeKeyId;
  const key = keyring.keys.get(keyId);
  if (!key) throw new Error("the active key is not in the keyring");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(associatedData(keyId, context));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const payload = Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
  return `${FORMAT}.${keyId}.${payload}`;
}

// The id of the key that sealed `sealed`, e.g. to find values that still
// need re-sealing after a key change; undefined when it is not a sealed value.
export function sealedKeyId(sealed: string): string | undefined {
  const [format, keyId, payload, extra] = sealed.split(".");
  if (format !== FORMAT || !keyId || !isKeyId(keyId) || !payload || extra !== undefined) {
    return undefined;
  }
  return keyId;
}

// Throws DecryptError: "malformed" for anything not produced by encrypt(),
// "unknown_key" when the keyring lacks the key, "tampered" when the value,
// its key id or the context do not match what was sealed.
export function decrypt(sealed: string, keyring: Keyring, context = ""): string {
  const keyId = sealedKeyId(sealed);
  if (!keyId) throw new DecryptError("malformed");
  const raw = Buffer.from(sealed.slice(FORMAT.length + keyId.length + 2), "base64url");
  if (raw.length < IV_BYTES + TAG_BYTES) throw new DecryptError("malformed");
  const key = keyring.keys.get(keyId);
  if (!key) throw new DecryptError("unknown_key");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(associatedData(keyId, context));
  decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
  try {
    const body = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    throw new DecryptError("tampered");
  }
}

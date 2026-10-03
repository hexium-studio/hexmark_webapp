import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from "node:crypto";

// A software WebAuthn authenticator for tests: answers registration and
// authentication options the way a browser with a security key would
// (ES256 key, attestation "none"), so the server's verification can be
// exercised end to end without a browser. Not a security device.

type CborValue = number | string | Buffer | CborValue[] | Map<CborValue, CborValue> | object;

function head(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 256) return Buffer.from([(major << 5) | 24, length]);
  const out = Buffer.alloc(3);
  out[0] = (major << 5) | 25;
  out.writeUInt16BE(length, 1);
  return out;
}

// Minimal CBOR encoder (RFC 8949): integers, byte and text strings, arrays,
// maps; enough for attestation objects and COSE keys.
export function cbor(value: CborValue): Buffer {
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cbor)]);
  const entries = value instanceof Map ? [...value] : Object.entries(value);
  return Buffer.concat([
    head(5, entries.length),
    ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)]),
  ]);
}

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest();
const b64u = (data: Buffer) => data.toString("base64url");

export interface SoftCredential {
  id: Buffer;
  privateKey: KeyObject;
  publicKey: KeyObject;
  counter: number;
}

export interface CreationOptions {
  challenge: string;
  rp: { id?: string };
}

export interface RequestOptions {
  challenge: string;
  rpId?: string;
}

function coseKey(publicKey: KeyObject): Buffer {
  const jwk = publicKey.export({ format: "jwk" });
  const x = Buffer.from(jwk.x as string, "base64url");
  const y = Buffer.from(jwk.y as string, "base64url");
  // kty EC2 (1: 2), alg ES256 (3: -7), crv P-256 (-1: 1), x (-2), y (-3).
  return cbor(
    new Map<CborValue, CborValue>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, x],
      [-3, y],
    ]),
  );
}

function counterBytes(counter: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(counter);
  return out;
}

export function newCredential(): SoftCredential {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return { id: randomBytes(32), privateKey, publicKey, counter: 0 };
}

// navigator.credentials.create() answer as JSON. `overrides` changes the
// client data (e.g. another origin) to produce answers that must fail.
export function register(
  credential: SoftCredential,
  options: CreationOptions,
  origin: string,
  overrides: { origin?: string; challenge?: string } = {},
) {
  const rpId = options.rp.id ?? new URL(origin).hostname;
  const clientData = Buffer.from(
    JSON.stringify({
      type: "webauthn.create",
      challenge: overrides.challenge ?? options.challenge,
      origin: overrides.origin ?? origin,
      crossOrigin: false,
    }),
  );
  const idLength = Buffer.alloc(2);
  idLength.writeUInt16BE(credential.id.length);
  const authData = Buffer.concat([
    sha256(rpId),
    // User present, user verified, attested credential data included.
    Buffer.from([0x01 | 0x04 | 0x40]),
    counterBytes(credential.counter),
    Buffer.alloc(16),
    idLength,
    credential.id,
    coseKey(credential.publicKey),
  ]);
  const attestationObject = cbor({ fmt: "none", attStmt: new Map(), authData });
  return {
    id: b64u(credential.id),
    rawId: b64u(credential.id),
    type: "public-key",
    response: {
      clientDataJSON: b64u(clientData),
      attestationObject: b64u(attestationObject),
      transports: ["usb"],
    },
    clientExtensionResults: {},
  };
}

// navigator.credentials.get() answer as JSON; increments the counter unless
// `counter` is given.
export function authenticate(
  credential: SoftCredential,
  options: RequestOptions,
  origin: string,
  overrides: { counter?: number; origin?: string } = {},
) {
  const rpId = options.rpId ?? new URL(origin).hostname;
  credential.counter = overrides.counter ?? credential.counter + 1;
  const clientData = Buffer.from(
    JSON.stringify({
      type: "webauthn.get",
      challenge: options.challenge,
      origin: overrides.origin ?? origin,
      crossOrigin: false,
    }),
  );
  const authData = Buffer.concat([
    sha256(rpId),
    Buffer.from([0x01 | 0x04]),
    counterBytes(credential.counter),
  ]);
  const signature = sign(
    "sha256",
    Buffer.concat([authData, sha256(clientData)]),
    credential.privateKey,
  );
  return {
    id: b64u(credential.id),
    rawId: b64u(credential.id),
    type: "public-key",
    response: {
      clientDataJSON: b64u(clientData),
      authenticatorData: b64u(authData),
      signature: b64u(signature),
    },
    clientExtensionResults: {},
  };
}

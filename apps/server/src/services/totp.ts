import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { TOTP_PARAMETERS } from "../config/two-factor";

// Time-based one-time passwords (RFC 6238 on top of HOTP, RFC 4226), as
// authenticator apps produce them. Pure: the caller passes the time, so the
// rules can be checked against the RFC test vectors and without a clock.
//
// Written here instead of using a library: the algorithm is a few lines on
// top of node:crypto, and the parts that matter for security (the window,
// replay protection, constant-time comparison) are decided here anyway.

export type TotpAlgorithm = "sha1" | "sha256" | "sha512";

export interface TotpOptions {
  digits: number;
  stepSeconds: number;
  algorithm: TotpAlgorithm;
}

export const DEFAULT_TOTP_OPTIONS: TotpOptions = {
  digits: TOTP_PARAMETERS.digits,
  stepSeconds: TOTP_PARAMETERS.stepSeconds,
  algorithm: "sha1",
};

// HOTP value for one counter (RFC 4226, section 5.3), zero-padded.
export function hotp(secret: Buffer, counter: number, options = DEFAULT_TOTP_OPTIONS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(options.algorithm, secret).update(message).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** options.digits).padStart(options.digits, "0");
}

// The time step `at` falls into (RFC 6238, T0 = 0).
export function totpStep(at: Date, options = DEFAULT_TOTP_OPTIONS): number {
  return Math.floor(at.getTime() / 1000 / options.stepSeconds);
}

export function totpCode(secret: Buffer, at: Date, options = DEFAULT_TOTP_OPTIONS): string {
  return hotp(secret, totpStep(at, options), options);
}

function sameCode(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

// The step whose code matches `code`, searching the current step and
// `window` steps on either side; null when none matches. A step at or
// before `lastUsedStep` is never accepted, so a code that was used once
// (or an older one) cannot be replayed. Every step in the window is
// computed, so the time taken does not tell which one matched.
export function matchTotp(
  secret: Buffer,
  code: string,
  at: Date,
  lastUsedStep: number | null,
  window: number = TOTP_PARAMETERS.window,
  options = DEFAULT_TOTP_OPTIONS,
): number | null {
  const current = totpStep(at, options);
  let matched: number | null = null;
  for (let step = current - window; step <= current + window; step++) {
    if (step < 0) continue;
    const fresh = lastUsedStep === null || step > lastUsedStep;
    if (sameCode(hotp(secret, step, options), code) && fresh && matched === null) matched = step;
  }
  return matched;
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// RFC 4648 base32 without padding, the form authenticator apps accept.
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

// Inverse of base32Encode; ignores case, spaces and padding. Null for any
// other character.
export function base32Decode(text: string): Buffer | null {
  const clean = text.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) return null;
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function newTotpSecret(): Buffer {
  return randomBytes(TOTP_PARAMETERS.secretBytes);
}

// otpauth:// URI (Key URI format of Google Authenticator) for the QR code.
export function totpUri(secret: Buffer, issuer: string, account: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: "SHA1",
    digits: String(DEFAULT_TOTP_OPTIONS.digits),
    period: String(DEFAULT_TOTP_OPTIONS.stepSeconds),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

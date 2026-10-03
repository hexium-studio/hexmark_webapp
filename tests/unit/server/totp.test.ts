import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  hotp,
  matchTotp,
  type TotpOptions,
  totpCode,
  totpStep,
  totpUri,
} from "../../../apps/server/src/services/totp";

// TOTP against the test vectors of RFC 6238 (appendix B) and HOTP against
// RFC 4226 (appendix D), then the window and replay rules Hexmark adds.

const SEEDS = {
  sha1: Buffer.from("12345678901234567890", "ascii"),
  sha256: Buffer.from("12345678901234567890123456789012", "ascii"),
  sha512: Buffer.from("1234567890123456789012345678901234567890123456789012345678901234", "ascii"),
};

// [time in seconds, sha1, sha256, sha512] – 8-digit codes from RFC 6238.
const RFC6238: [number, string, string, string][] = [
  [59, "94287082", "46119246", "90693936"],
  [1111111109, "07081804", "68084774", "25091201"],
  [1111111111, "14050471", "67062674", "99943326"],
  [1234567890, "89005924", "91819424", "93441116"],
  [2000000000, "69279037", "90698825", "38618901"],
  [20000000000, "65353130", "77737706", "47863826"],
];

describe("RFC 6238 test vectors", () => {
  it.each(RFC6238)("at %i s", (seconds, sha1, sha256, sha512) => {
    const at = new Date(seconds * 1000);
    const options = (algorithm: TotpOptions["algorithm"]): TotpOptions => ({
      digits: 8,
      stepSeconds: 30,
      algorithm,
    });
    expect(totpCode(SEEDS.sha1, at, options("sha1"))).toBe(sha1);
    expect(totpCode(SEEDS.sha256, at, options("sha256"))).toBe(sha256);
    expect(totpCode(SEEDS.sha512, at, options("sha512"))).toBe(sha512);
  });
});

describe("RFC 4226 test vectors", () => {
  const expected = [
    "755224",
    "287082",
    "359152",
    "969429",
    "338314",
    "254676",
    "287922",
    "162583",
    "399871",
    "520489",
  ];
  it.each(expected.map((code, counter) => [counter, code] as const))(
    "counter %i",
    (counter, code) => {
      expect(hotp(SEEDS.sha1, counter)).toBe(code);
    },
  );
});

describe("matchTotp", () => {
  const secret = SEEDS.sha1;
  const at = new Date(1_700_000_000_000);
  const step = totpStep(at);
  const codeAt = (offset: number) => hotp(secret, step + offset);

  it("accepts the current step and one step on either side", () => {
    expect(matchTotp(secret, codeAt(0), at, null)).toBe(step);
    expect(matchTotp(secret, codeAt(-1), at, null)).toBe(step - 1);
    expect(matchTotp(secret, codeAt(1), at, null)).toBe(step + 1);
  });

  it("refuses codes two steps away and wrong codes", () => {
    expect(matchTotp(secret, codeAt(-2), at, null)).toBeNull();
    expect(matchTotp(secret, codeAt(2), at, null)).toBeNull();
    expect(matchTotp(secret, "000000", at, null)).toBeNull();
    expect(matchTotp(secret, codeAt(0).slice(1), at, null)).toBeNull();
  });

  it("refuses the last used step and older ones (replay)", () => {
    expect(matchTotp(secret, codeAt(0), at, step)).toBeNull();
    expect(matchTotp(secret, codeAt(-1), at, step)).toBeNull();
    expect(matchTotp(secret, codeAt(-1), at, step - 1)).toBeNull();
    expect(matchTotp(secret, codeAt(0), at, step - 1)).toBe(step);
    expect(matchTotp(secret, codeAt(1), at, step)).toBe(step + 1);
  });

  it("uses 30-second steps from the Unix epoch", () => {
    expect(totpStep(new Date(29_999))).toBe(0);
    expect(totpStep(new Date(30_000))).toBe(1);
  });
});

describe("base32", () => {
  // RFC 4648, section 10 (without padding).
  it.each([
    ["", ""],
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ])("encodes %j as %j and back", (text, encoded) => {
    expect(base32Encode(Buffer.from(text))).toBe(encoded);
    expect(base32Decode(encoded)?.toString()).toBe(text);
  });

  it("decodes lower case with spaces and padding, refuses other characters", () => {
    expect(base32Decode("mzxw 6ytb oi======")?.toString()).toBe("foobar");
    expect(base32Decode("MZXW1")).toBeNull();
  });
});

describe("totpUri", () => {
  it("builds the otpauth URI apps expect", () => {
    expect(totpUri(Buffer.from("foobar"), "Hexmark", "ada@example.com")).toBe(
      "otpauth://totp/Hexmark:ada%40example.com?secret=MZXW6YTBOI&issuer=Hexmark&algorithm=SHA1&digits=6&period=30",
    );
  });
});

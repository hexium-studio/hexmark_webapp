import { describe, expect, it } from "vitest";
import { readWebauthnConfig } from "../../../apps/server/src/config/webauthn";

// PUBLIC_ORIGIN: when security keys are offered, and which relying party ID
// and origin the server checks against.

const read = (value?: string) =>
  readWebauthnConfig(value === undefined ? {} : { PUBLIC_ORIGIN: value });

describe("PUBLIC_ORIGIN", () => {
  it("is optional: without it security keys are off, without a complaint", () => {
    expect(read()).toEqual({ enabled: false });
    expect(read("  ")).toEqual({ enabled: false });
  });

  it.each([
    ["https://wiki.example.com", "wiki.example.com", "https://wiki.example.com"],
    ["https://wiki.example.com/", "wiki.example.com", "https://wiki.example.com"],
    ["  https://Wiki.Example.com:8443  ", "wiki.example.com", "https://wiki.example.com:8443"],
    ["http://localhost:3000", "localhost", "http://localhost:3000"],
    ["http://hexmark.localhost", "hexmark.localhost", "http://hexmark.localhost"],
  ])("accepts %j", (value, rpID, origin) => {
    expect(read(value)).toEqual({ enabled: true, rpID, origin, rpName: "Hexmark" });
  });

  it.each([
    ["not a URL", "hexmark-wiki"],
    ["http on another host", "http://wiki.example.com"],
    ["a path", "https://example.com/wiki"],
    ["a query", "https://example.com/?a=1"],
    ["credentials", "https://user:pass@example.com"],
    ["an IPv4 address", "https://192.0.2.10"],
    ["an IPv6 address", "https://[2001:db8::1]"],
    ["another scheme", "ftp://example.com"],
  ])("refuses %s, with a problem for the log that hides the value", (_, value) => {
    const config = read(value);
    expect(config.enabled).toBe(false);
    if (config.enabled) return;
    expect(config.problem).toMatch(
      /^PUBLIC_ORIGIN .+; security keys and passkeys are not offered\.$/,
    );
    expect(config.problem).not.toContain(value);
  });
});

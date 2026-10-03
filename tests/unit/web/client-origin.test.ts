import { describe, expect, it } from "vitest";
import { resolveClientOrigin, walkForwardedFor } from "@/lib/client-origin/resolve";
import { parseTrustConfig } from "@/lib/client-origin/trusted-proxies";

// How the web server decides which address a request comes from and
// whether it arrived over HTTPS: TRUSTED_PROXIES parsing (IPv4 and IPv6,
// single addresses and CIDR ranges), walking X-Forwarded-For, and which
// headers are believed from whom.

describe("parseTrustConfig", () => {
  it("is empty by default and trusts nobody", () => {
    const config = parseTrustConfig(undefined, undefined);
    expect(config.entries).toEqual([]);
    expect(config.isTrusted("127.0.0.1")).toBe(false);
    expect(config.clientHeader).toBeNull();
  });

  it("matches IPv4 addresses and ranges", () => {
    const config = parseTrustConfig("10.0.0.5, 172.16.0.0/12", undefined);
    expect(config.entries).toEqual(["10.0.0.5", "172.16.0.0/12"]);
    expect(config.isTrusted("10.0.0.5")).toBe(true);
    expect(config.isTrusted("10.0.0.6")).toBe(false);
    expect(config.isTrusted("172.16.0.1")).toBe(true);
    expect(config.isTrusted("172.31.255.254")).toBe(true);
    expect(config.isTrusted("172.32.0.1")).toBe(false);
    // An IPv4 peer as a dual-stack socket reports it.
    expect(config.isTrusted("::ffff:172.20.0.3")).toBe(true);
  });

  it("matches IPv6 addresses and ranges, in any spelling", () => {
    const config = parseTrustConfig("fd00::/8,2001:DB8::10", undefined);
    expect(config.entries).toEqual(["fd00::/8", "2001:db8::10"]);
    expect(config.isTrusted("fd12:3456::1")).toBe(true);
    expect(config.isTrusted("fe80::1")).toBe(false);
    expect(config.isTrusted("2001:db8:0:0:0:0:0:10")).toBe(true);
    expect(config.isTrusted("2001:db8::11")).toBe(false);
    expect(config.isTrusted("10.0.0.1")).toBe(false);
  });

  it("accepts an IPv4-mapped IPv6 range as the IPv4 range", () => {
    const config = parseTrustConfig("::ffff:10.0.0.0/104", undefined);
    expect(config.entries).toEqual(["10.0.0.0/8"]);
    expect(config.isTrusted("10.200.1.1")).toBe(true);
  });

  it("skips invalid entries and keeps the rest", () => {
    const config = parseTrustConfig(
      "proxy.example.com, 10.0.0.0/33, fd00::/129, 10.0.0.1/8/8, 1.2.3.4/x, ,192.0.2.7",
      undefined,
    );
    expect(config.entries).toEqual(["192.0.2.7"]);
    expect(config.invalid).toEqual([
      "proxy.example.com",
      "10.0.0.0/33",
      "fd00::/129",
      "10.0.0.1/8/8",
      "1.2.3.4/x",
    ]);
  });

  it("takes one client header, lower-cased, and refuses reserved names", () => {
    expect(parseTrustConfig("", "CF-Connecting-IP").clientHeader).toBe("cf-connecting-ip");
    for (const name of ["X-Forwarded-For", "x-hexmark-client-ip", "x-hexmark-peer-address"]) {
      const config = parseTrustConfig("", name);
      expect(config.clientHeader).toBeNull();
      expect(config.invalidHeader).toBe(name);
    }
    expect(parseTrustConfig("", "two words").clientHeader).toBeNull();
    expect(parseTrustConfig("", " ").invalidHeader).toBeNull();
  });
});

describe("walkForwardedFor", () => {
  const rules = parseTrustConfig("10.0.0.0/8, fd00::/8", undefined);
  const walk = (header: string | null, peer = "10.0.0.2") =>
    walkForwardedFor(header, peer, rules.isTrusted);

  it("takes the right-most address that is not a trusted proxy", () => {
    expect(walk("203.0.113.9")).toBe("203.0.113.9");
    expect(walk("203.0.113.9, 10.0.0.7")).toBe("203.0.113.9");
    expect(walk("198.51.100.1, 203.0.113.9, 10.0.0.7, fd00::3")).toBe("203.0.113.9");
  });

  it("ignores what a client wrote to the left of the first untrusted hop", () => {
    // The client sent "10.0.0.99, 1.1.1.1" itself; the proxy appended the
    // real client address.
    expect(walk("10.0.0.99, 1.1.1.1, 203.0.113.9")).toBe("203.0.113.9");
  });

  it("stops at the last trusted hop when an entry is not an address", () => {
    expect(walk("203.0.113.9, garbage, 10.0.0.7")).toBe("10.0.0.7");
    expect(walk("garbage")).toBe("10.0.0.2");
  });

  it("falls back to the left-most trusted hop or the peer", () => {
    expect(walk("10.0.0.8, 10.0.0.7")).toBe("10.0.0.8");
    expect(walk(null)).toBe("10.0.0.2");
    expect(walk(" , ")).toBe("10.0.0.2");
  });

  it("normalises entries with ports and brackets", () => {
    expect(walk("[2001:db8::5]:4711, 10.0.0.7")).toBe("2001:db8::5");
    expect(walk("203.0.113.9:5555")).toBe("203.0.113.9");
  });
});

describe("resolveClientOrigin", () => {
  const forged = {
    forwardedFor: "198.51.100.66",
    forwardedProto: "https",
    clientHeader: "198.51.100.77",
  };

  it("without trusted proxies: the peer, and no header is believed", () => {
    const rules = parseTrustConfig("", "CF-Connecting-IP");
    expect(resolveClientOrigin({ peer: "203.0.113.9", ...forged }, rules)).toEqual({
      ip: "203.0.113.9",
      secure: false,
    });
  });

  it("an untrusted peer is the client even when trusted proxies exist", () => {
    const rules = parseTrustConfig("10.0.0.0/8", "CF-Connecting-IP");
    expect(resolveClientOrigin({ peer: "::ffff:203.0.113.9", ...forged }, rules)).toEqual({
      ip: "203.0.113.9",
      secure: false,
    });
  });

  it("a trusted peer: X-Forwarded-For and the last X-Forwarded-Proto", () => {
    const rules = parseTrustConfig("10.0.0.0/8", undefined);
    const origin = (forwardedProto: string | null) =>
      resolveClientOrigin(
        { peer: "10.0.0.2", forwardedFor: "203.0.113.9", forwardedProto, clientHeader: null },
        rules,
      );
    expect(origin("https")).toEqual({ ip: "203.0.113.9", secure: true });
    expect(origin("HTTPS")).toEqual({ ip: "203.0.113.9", secure: true });
    expect(origin("https, http")).toEqual({ ip: "203.0.113.9", secure: false });
    expect(origin("http, https")).toEqual({ ip: "203.0.113.9", secure: true });
    expect(origin(null)).toEqual({ ip: "203.0.113.9", secure: false });
  });

  it("a trusted peer with a client header: that header first, else X-Forwarded-For", () => {
    const rules = parseTrustConfig("10.0.0.0/8", "CF-Connecting-IP");
    const base = { peer: "10.0.0.2", forwardedFor: "198.51.100.66", forwardedProto: "http" };
    expect(resolveClientOrigin({ ...base, clientHeader: "2001:db8::7" }, rules).ip).toBe(
      "2001:db8::7",
    );
    expect(resolveClientOrigin({ ...base, clientHeader: "not an ip" }, rules).ip).toBe(
      "198.51.100.66",
    );
    expect(resolveClientOrigin({ ...base, clientHeader: null }, rules).ip).toBe("198.51.100.66");
  });

  it("no usable peer: no address, not secure", () => {
    const rules = parseTrustConfig("10.0.0.0/8", undefined);
    expect(resolveClientOrigin({ peer: undefined, ...forged }, rules)).toEqual({
      ip: undefined,
      secure: false,
    });
    expect(resolveClientOrigin({ peer: "garbage", ...forged }, rules)).toEqual({
      ip: undefined,
      secure: false,
    });
  });
});

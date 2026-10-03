import { BlockList, isIP } from "node:net";
import { normalizeIpAddress } from "@hexmark/shared/internal-calls";
import type { TrustRules } from "./resolve";

// Reverse proxies in front of the web server whose forwarding headers are
// believed (docs/deployment.md). Both optional, empty by default:
//
//   TRUSTED_PROXIES       comma-separated IPv4/IPv6 addresses and CIDR ranges,
//                         e.g. "10.0.0.5, 172.16.0.0/12, fd00::/8"
//   TRUSTED_PROXY_HEADER  one header that a trusted proxy sets to the client's
//                         address, e.g. "CF-Connecting-IP"; used only on
//                         requests from a trusted proxy
//
// Invalid entries are logged at start-up and skipped; the rest still apply.

export interface TrustConfig extends TrustRules {
  // Accepted entries, canonical, for the log.
  entries: string[];
  invalid: string[];
  // TRUSTED_PROXY_HEADER was set but is not a usable header name.
  invalidHeader: string | null;
}

const HEADER_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
// Headers that already have a meaning here; naming one would change it.
const RESERVED_HEADERS = new Set(["x-forwarded-for", "x-forwarded-proto", "host"]);

function addEntry(list: BlockList, entry: string): string | undefined {
  const [address, prefix, extra] = entry.split("/");
  const ip = normalizeIpAddress(address);
  if (!ip || extra !== undefined || address?.trim() !== address) return undefined;
  const family = isIP(ip) === 6 ? "ipv6" : "ipv4";
  if (prefix === undefined) {
    list.addAddress(ip, family);
    return ip;
  }
  const bits = /^\d{1,3}$/.test(prefix) ? Number(prefix) : Number.NaN;
  // An IPv4-mapped IPv6 range (::ffff:10.0.0.0/104) was normalised to IPv4
  // above; its prefix also counts the 96 bits in front of the IPv4 part.
  const mapped = family === "ipv4" && isIP(address ?? "") === 6;
  const ipv4Bits = mapped ? bits - 96 : bits;
  if (!(ipv4Bits >= 0 && ipv4Bits <= (family === "ipv6" ? 128 : 32))) return undefined;
  list.addSubnet(ip, ipv4Bits, family);
  return `${ip}/${ipv4Bits}`;
}

export function parseTrustConfig(
  proxies: string | undefined,
  header: string | undefined,
): TrustConfig {
  const list = new BlockList();
  const entries: string[] = [];
  const invalid: string[] = [];
  for (const raw of (proxies ?? "").split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    const added = addEntry(list, entry);
    if (added) entries.push(added);
    else invalid.push(entry);
  }
  const name = header?.trim().toLowerCase() ?? "";
  const usable =
    HEADER_NAME.test(name) && !RESERVED_HEADERS.has(name) && !name.startsWith("x-hexmark-");
  return {
    entries,
    invalid,
    clientHeader: usable ? name : null,
    invalidHeader: name && !usable ? (header ?? null) : null,
    isTrusted(address) {
      const ip = normalizeIpAddress(address);
      if (!ip || entries.length === 0) return false;
      return list.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");
    },
  };
}

// Next.js bundles the proxy, the instrumentation and the app separately,
// each with its own copy of this module; the process-wide slot makes them
// share one configuration and log it once.
const SLOT = Symbol.for("hexmark.trustConfig");
type Slot = typeof globalThis & { [SLOT]?: TrustConfig };

// The configuration of this process, read and logged once.
export function trustConfig(): TrustConfig {
  const scope = globalThis as Slot;
  const known = scope[SLOT];
  if (known) return known;
  const cached = parseTrustConfig(process.env.TRUSTED_PROXIES, process.env.TRUSTED_PROXY_HEADER);
  scope[SLOT] = cached;
  if (cached.invalid.length > 0) {
    console.error(`TRUSTED_PROXIES: ignored invalid entries: ${cached.invalid.join(", ")}`);
  }
  if (cached.invalidHeader !== null) {
    console.error(`TRUSTED_PROXY_HEADER: "${cached.invalidHeader}" cannot be used; ignored.`);
  }
  if (cached.entries.length > 0) {
    const via = cached.clientHeader ? `, client header ${cached.clientHeader}` : "";
    console.log(`Trusted proxies: ${cached.entries.join(", ")}${via}`);
  }
  return cached;
}

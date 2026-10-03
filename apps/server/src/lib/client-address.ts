import { normalizeIpAddress } from "@hexmark/shared/internal-calls";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

// Source address of the TCP connection, in canonical form (IPv4-mapped IPv6
// as plain IPv4). Forwarding headers are not looked at here; which of them
// to believe is decided in src/services/client-address.ts.
export function socketAddress(c: Context): string {
  try {
    return normalizeIpAddress(getConnInfo(c).remote.address) ?? "unknown";
  } catch {
    return "unknown";
  }
}

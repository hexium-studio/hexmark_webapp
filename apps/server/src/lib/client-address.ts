import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

// Source address of the TCP connection. Forwarding headers such as
// X-Forwarded-For are ignored on purpose: they are set by the caller and
// cannot be trusted without a known proxy in front of this server.
export function clientAddress(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

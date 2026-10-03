import type { InstanceCapabilities } from "@hexmark/shared";
import type { Context } from "hono";
import { webauthnConfig } from "../../../config/webauthn";

// GET /api/instance/v1/capabilities – see index.ts for the contract. Needs
// no database: the answer comes from the configuration.
export function getCapabilities(c: Context): Response {
  const capabilities: InstanceCapabilities = { webauthn: webauthnConfig().enabled };
  return c.json(capabilities, 200);
}

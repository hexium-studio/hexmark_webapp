import {
  type CreatedApiToken,
  createApiTokenInputSchema,
  MCP_SERVER_NAME,
  mcpServersConfig,
} from "@hexmark/shared";
import type { Context } from "hono";
import { mcpPublicUrl } from "../../../config/mcp";
import { sendOutcome } from "../../../lib/outcome";
import { parseJsonBody, readJsonBody } from "../../../lib/validation";
import { createToken } from "../../../services/api-tokens/tokens";
import { logRefusedInput } from "../../../services/audit/refused-input";
import { sessionOnly } from "./session-only";

// POST /api/tokens/v1/tokens – see index.ts for the contract.
export async function postToken(c: Context): Promise<Response> {
  const now = new Date();
  const ref = await sessionOnly(c, now);
  if (ref instanceof Response) return ref;
  const body = await parseJsonBody(c, createApiTokenInputSchema);
  if (!body.ok) {
    await logRefusedInput(c, ref, "token.created", body.response, await readJsonBody(c));
    return body.response;
  }
  const outcome = await createToken(ref, now, body.data);
  return sendOutcome(c, outcome, ({ token, info }) => {
    const created: CreatedApiToken = {
      token,
      info,
      mcp: {
        serverName: MCP_SERVER_NAME,
        url: mcpPublicUrl,
        config: mcpPublicUrl ? mcpServersConfig(mcpPublicUrl, token) : null,
      },
    };
    return c.json(created, 201);
  });
}

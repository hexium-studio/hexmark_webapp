import { hideInputSchema } from "@hexmark/shared";
import type { RouteDoc } from "../../../lib/openapi";
import { both, write } from "./openapi-common";

// Hiding in the OpenAPI document (openapi.ts).

const HIDE_RESULT = "{ kind, id, path, hidden, changed }";
const UNHIDE_403 =
  "forbidden (permission; reason session_required: only signed-in people unhide) | " +
  "reauthentication_required | setup_token_present";

function hideRoutes(kind: "notes" | "folders", noun: string): RouteDoc[] {
  return [
    {
      method: "post",
      path: `/${kind}/{id}/hide`,
      summary: `Hide a ${noun} from agents (a token must give a reason)`,
      security: both,
      body: hideInputSchema,
      bodyOptional: true,
      responses: { "200": HIDE_RESULT, ...write },
    },
    {
      method: "post",
      path: `/${kind}/{id}/unhide`,
      summary: `Make a hidden ${noun} visible to agents again (signed-in people only)`,
      security: both,
      body: hideInputSchema,
      bodyOptional: true,
      responses: { "200": HIDE_RESULT, ...write, "403": UNHIDE_403 },
    },
  ];
}

export const HIDDEN_ROUTES: RouteDoc[] = [
  ...hideRoutes("notes", "note"),
  ...hideRoutes("folders", "folder"),
  {
    method: "get",
    path: "/hidden",
    summary: "Notes and folders hidden themselves (signed-in people only)",
    security: both,
    responses: { "200": "{ items }", ...write, "403": "forbidden (reason session_required)" },
  },
];

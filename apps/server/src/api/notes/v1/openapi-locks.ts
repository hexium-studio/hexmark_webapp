import { lockInputSchema } from "@hexmark/shared";
import type { RouteDoc } from "../../../lib/openapi";
import { both, write } from "./openapi-common";

// Locks in the OpenAPI document (openapi.ts).

const LOCK_RESULT = "{ kind, id, path, locked, changed }";
const UNLOCK_403 =
  "forbidden (permission; reason session_required: only signed-in people unlock) | " +
  "setup_token_present";

function lockRoutes(kind: "notes" | "folders", noun: string): RouteDoc[] {
  return [
    {
      method: "post",
      path: `/${kind}/{id}/lock`,
      summary: `Lock a ${noun} (a token must give a reason)`,
      security: both,
      body: lockInputSchema,
      bodyOptional: true,
      responses: { "200": LOCK_RESULT, ...write },
    },
    {
      method: "post",
      path: `/${kind}/{id}/unlock`,
      summary: `Lift a ${noun}'s lock (signed-in people only)`,
      security: both,
      body: lockInputSchema,
      bodyOptional: true,
      responses: { "200": LOCK_RESULT, ...write, "403": UNLOCK_403 },
    },
  ];
}

export const LOCK_ROUTES: RouteDoc[] = [
  ...lockRoutes("notes", "note"),
  ...lockRoutes("folders", "folder"),
  {
    method: "get",
    path: "/locked",
    summary: "Notes and folders with a lock of their own",
    security: both,
    responses: { "200": "{ items }", ...write },
  },
];

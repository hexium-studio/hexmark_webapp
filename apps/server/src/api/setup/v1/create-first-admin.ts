import { type FieldErrors, setupInputSchema } from "@hexmark/shared";
import type { Context } from "hono";
import { type CreateAdminResult, createFirstAdmin } from "../_lib/create-first-admin";
import { guardSetupRequest } from "../_lib/guard";
import { pingDatabase } from "../_lib/setup-state";

// POST /api/setup/v1/create-first-admin: creates the first admin account.
// Guard failures as in _lib/guard.ts; then 201 { ok: true, ticket: { token,
// expiresAt } } (the setup enrolment ticket, see index.ts), 404 when another
// request created a user first, 409 when e-mail or username is taken
// (`fields: { <field>: { code: "taken" } }`).

export async function createFirstAdminAccount(c: Context): Promise<Response> {
  const guard = await guardSetupRequest(c, setupInputSchema);
  if (!guard.ok) return guard.response;
  let result: CreateAdminResult;
  try {
    result = await createFirstAdmin(guard.data);
  } catch (error) {
    if (!(await pingDatabase())) return c.json({ error: "database_unavailable" }, 503);
    throw error;
  }
  switch (result.status) {
    case "created": {
      const { token, expiresAt } = result.ticket;
      return c.json({ ok: true, ticket: { token, expiresAt: expiresAt.toISOString() } }, 201);
    }
    case "closed":
      return c.json({ error: "not_found" }, 404);
    case "conflict": {
      const fields: FieldErrors = { [result.field]: { code: "taken" } };
      return c.json({ error: "conflict", fields }, 409);
    }
  }
}

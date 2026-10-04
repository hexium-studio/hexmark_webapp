import { z } from "zod";
import type { AuditAction, AuditActionInfo } from "./audit-actions";
import type { FieldErrorCode } from "./field-errors";
import { idSchema } from "./notes";
import { sinceSchema } from "./notes-api";

// Query string and answers of GET /api/audit/v1/events (signed-in people
// only; the endpoint is described in apps/server/src/api/audit/v1/index.ts).

const code = (value: FieldErrorCode) => value;

export const AUDIT_ACTOR_KINDS = ["human", "agent", "system"] as const;
export type AuditActorKind = (typeof AUDIT_ACTOR_KINDS)[number];

export const AUDIT_SOURCES = ["web", "http", "mcp", "system"] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

export const AUDIT_OUTCOMES = ["success", "failure"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export const AUDIT_PAGE_LIMITS = { default: 50, max: 200 } as const;

// An exact code ("note.updated") or a prefix ending in a dot ("note.").
const ACTION_FILTER = /^[a-z_]+(\.[a-z_]+)*\.?$/;

// The position after the last event of a page (occurred_at and id),
// opaque to clients.
const CURSOR = /^[A-Za-z0-9_-]{1,200}$/;

export const auditEventsQuerySchema = z.object({
  // Actor name: username, token name or "System".
  actor: z.string().trim().min(1, code("empty")).max(64, code("too_long")).optional(),
  actorMatch: z.enum(["exact", "partial"], { error: code("invalid_option") }).default("exact"),
  actorKind: z.enum(AUDIT_ACTOR_KINDS, { error: code("invalid_option") }).optional(),
  action: z
    .string()
    .max(64, code("too_long"))
    .regex(ACTION_FILTER, code("invalid_format"))
    .optional(),
  outcome: z.enum(AUDIT_OUTCOMES, { error: code("invalid_option") }).optional(),
  targetKind: z
    .string()
    .max(32, code("too_long"))
    .regex(/^[a-z][a-z_]*$/, code("invalid_format"))
    .optional(),
  targetId: idSchema.optional(),
  // From (inclusive) and to (exclusive), ISO 8601 with a time zone.
  from: sinceSchema.optional(),
  to: sinceSchema.optional(),
  cursor: z.string().regex(CURSOR, code("invalid_format")).optional(),
  limit: z.coerce
    .number({ error: code("invalid_type") })
    .int(code("invalid_type"))
    .min(1, code("invalid"))
    .max(AUDIT_PAGE_LIMITS.max, code("too_long"))
    .default(AUDIT_PAGE_LIMITS.default),
});
export type AuditEventsQuery = z.infer<typeof auditEventsQuerySchema>;

export interface AuditEventView {
  id: string;
  occurredAt: string;
  actor: {
    kind: AuditActorKind;
    // Username, token name or "System" as it was then; "unknown" for a
    // sign-in with an e-mail that matched no account, "invalid token" for
    // an unknown API token.
    name: string;
    // Null for the system, and once the user or token was deleted.
    userId: string | null;
    tokenId: string | null;
  };
  source: AuditSource;
  action: string;
  outcome: AuditOutcome;
  errorCode: string | null;
  target: { kind: string; id: string | null; label: string | null } | null;
  reason: string | null;
  details: Record<string, unknown>;
}

export interface AuditEventsPage {
  events: AuditEventView[];
  // Pass as cursor for the next (older) page; null on the last page.
  nextCursor: string | null;
}

export interface AuditActionsListing {
  actions: ({ code: AuditAction } & AuditActionInfo)[];
}

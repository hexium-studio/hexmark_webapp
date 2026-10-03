import type { SetupInput } from "@hexmark/shared";
import { sql } from "drizzle-orm";
import { getDb } from "../../../db/client";
import { instanceSettings, users } from "../../../db/schema";
import { hashPassword } from "../../../services/password";
import { type IssuedChallengeRow, issueChallenge } from "../../../services/two-factor/challenges";

// Creates the first admin. This is where "setup only while no user exists" is
// decided: under a transaction-scoped advisory lock, so two concurrent
// requests are serialised and the second one sees the first one's user. The
// same transaction stores the chosen locale on the admin and as the instance
// default, so there is never an admin without instance settings or the reverse,
// and issues the setup enrolment ticket.

// Arbitrary constant that identifies the setup lock among advisory locks.
const SETUP_LOCK_KEY = 7_316_101;

export type CreateAdminResult =
  // `ticket`: the setup enrolment ticket for wizard steps 5 and 6.
  | { status: "created"; ticket: IssuedChallengeRow }
  | { status: "closed" }
  | { status: "conflict"; field: "email" | "username" };

const CONFLICT_FIELDS = {
  users_email_unique: "email",
  users_username_unique: "username",
} as const;

// Drizzle wraps driver errors; walk the cause chain to the PostgreSQL error.
function uniqueViolationField(error: unknown): "email" | "username" | null {
  let current: unknown = error;
  while (current instanceof Error) {
    const { code, constraint_name } = current as { code?: unknown; constraint_name?: unknown };
    if (code === "23505" && typeof constraint_name === "string") {
      return CONFLICT_FIELDS[constraint_name as keyof typeof CONFLICT_FIELDS] ?? null;
    }
    current = current.cause;
  }
  return null;
}

export async function createFirstAdmin(input: SetupInput): Promise<CreateAdminResult> {
  // Hashing is slow on purpose; do it before taking the lock.
  const passwordHash = await hashPassword(input.password);
  try {
    return await getDb().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${SETUP_LOCK_KEY})`);
      const existing = await tx.select({ id: users.id }).from(users).limit(1);
      if (existing.length > 0) return { status: "closed" } as const;
      const now = new Date();
      const [admin] = await tx
        .insert(users)
        .values({
          email: input.email,
          username: input.username,
          displayName: input.displayName,
          passwordHash,
          role: "admin",
          locale: input.locale,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: users.id });
      if (!admin) throw new Error("admin insert returned no row");
      // Single row (id 1). An existing row (e.g. left by an earlier install
      // whose users were removed) keeps its created_at.
      await tx
        .insert(instanceSettings)
        .values({ id: 1, defaultLocale: input.locale, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: instanceSettings.id,
          set: { defaultLocale: input.locale, updatedAt: now },
        });
      // Sign-in stays refused while SETUP_TOKEN is set; this ticket lets the
      // new admin finish the wizard (second factor, system settings).
      const ticket = await issueChallenge(tx, {
        userId: admin.id,
        purpose: "setup_enrolment",
        now,
      });
      return { status: "created", ticket } as const;
    });
  } catch (error) {
    const field = uniqueViolationField(error);
    if (field) return { status: "conflict", field };
    throw error;
  }
}

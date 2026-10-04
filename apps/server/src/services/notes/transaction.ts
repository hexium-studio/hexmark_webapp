import { getDb, type Transaction } from "../../db/client";
import type { Failure, Outcome } from "../../lib/outcome";
import { isFailure, refuse } from "./refusals";

// Runs one note operation in a transaction. A refusal rolls back whatever the
// operation wrote before it refused. Unique and foreign key violations - the
// database deciding a race two requests ran at the same time - become the
// refusal a client understands. Two transactions that wait for each other's
// rows (PostgreSQL aborts one with deadlock_detected) are not an answer:
// the aborted operation runs again from the start, a few times at most.

class Refused extends Error {
  constructor(readonly failure: Failure) {
    super(failure.error);
  }
}

// Constraint -> refusal for violations that are answers, not bugs.
export const CONSTRAINT_REFUSALS: Record<string, Parameters<typeof refuse>[0]> = {
  notes_folder_id_title_unique: "title_taken",
  notes_root_title_unique: "title_taken",
  folders_parent_id_name_unique: "name_taken",
  folders_root_name_unique: "name_taken",
  api_tokens_user_id_name_unique: "name_taken",
  // A folder deleted while a note or folder was put into it.
  notes_folder_id_folders_id_fk: "folder_not_found",
  folders_parent_id_folders_id_fk: "folder_not_found",
};

// A field of the driver's error, which the query builder wraps as `cause`.
function driverField(error: unknown, field: "constraint_name" | "code"): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const value = (current as Record<string, unknown>)[field];
    if (typeof value === "string") return value;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function constraintOf(error: unknown): string | undefined {
  return driverField(error, "constraint_name");
}

const DEADLOCK_DETECTED = "40P01";
const ATTEMPTS = 3;

export async function runNoteTransaction<T>(
  operation: (tx: Transaction) => Promise<T | Failure>,
  violations: Record<string, Failure> = {},
): Promise<Outcome<T>> {
  for (let attempt = 1; ; attempt++) {
    try {
      const value = await getDb().transaction(async (tx) => {
        const result = await operation(tx);
        if (isFailure(result)) throw new Refused(result);
        return result;
      });
      return { ok: true, value };
    } catch (error) {
      if (error instanceof Refused) return error.failure;
      if (driverField(error, "code") === DEADLOCK_DETECTED && attempt < ATTEMPTS) continue;
      const constraint = constraintOf(error);
      const specific = constraint ? violations[constraint] : undefined;
      if (specific) return specific;
      const code = constraint ? CONSTRAINT_REFUSALS[constraint] : undefined;
      if (code) return refuse(code);
      throw error;
    }
  }
}

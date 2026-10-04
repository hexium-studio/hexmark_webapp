import type { Transaction } from "../../db/client";
import { type Failure, fail, type Outcome } from "../../lib/outcome";
import { runNoteTransaction } from "../notes/transaction";
import { type AttemptInfo, recordAttemptFailure } from "./access-events";

// The frame of every operation of the notes core, the trash and API tokens
// that the audit log covers: the operation runs in its transaction (which
// writes the success event itself, recordAccessEvent); when it is refused
// or throws, the transaction is rolled back and the failure is written
// afterwards, with the action, the input as summarized and the error code.
// Endpoints and MCP tools reach these operations only through services
// built on this, so no way in can skip the log.

export async function runAudited<T>(
  attempt: AttemptInfo,
  operation: (tx: Transaction) => Promise<T | Failure>,
  violations?: Record<string, Failure>,
): Promise<Outcome<T>> {
  let outcome: Outcome<T>;
  try {
    outcome = await runNoteTransaction(operation, violations);
  } catch (error) {
    await recordAttemptFailure(attempt, fail(500, "internal"));
    throw error;
  }
  if (!outcome.ok) await recordAttemptFailure(attempt, outcome);
  return outcome;
}

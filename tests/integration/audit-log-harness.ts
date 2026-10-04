import { expect } from "vitest";
import type { TestDatabase } from "../support/databases";

// Helpers for the tests of what the server writes to the audit log: the
// events an action added, and a scan of every event for secrets.

export interface LoggedEvent {
  id: string;
  actor_kind: string;
  actor_user_id: string | null;
  actor_token_id: string | null;
  actor_name: string;
  source: string;
  action: string;
  outcome: string;
  error_code: string | null;
  target_kind: string | null;
  target_id: string | null;
  target_label: string | null;
  reason: string | null;
  details: Record<string, unknown>;
}

export async function allEvents(db: TestDatabase): Promise<LoggedEvent[]> {
  return (await db.sql`
    select id, actor_kind, actor_user_id, actor_token_id, actor_name, source, action, outcome,
      error_code, target_kind, target_id, target_label, reason, details
    from audit_events order by occurred_at, id
  `) as unknown as LoggedEvent[];
}

// The events written while `run` ran (by any request it made), oldest first.
export async function eventsOf(db: TestDatabase, run: () => Promise<unknown>) {
  const before = new Set((await allEvents(db)).map((event) => event.id));
  const result = await run();
  const events = (await allEvents(db)).filter((event) => !before.has(event.id));
  return { result, events };
}

// Exactly one event, returned for further checks.
export async function oneEvent(db: TestDatabase, run: () => Promise<unknown>) {
  const { result, events } = await eventsOf(db, run);
  expect(events, JSON.stringify(events)).toHaveLength(1);
  return { result, event: events[0] as LoggedEvent };
}

// Secrets a test used (passwords, tokens, codes, note bodies): none may
// appear anywhere in any event of the file's database. Returns how many
// events were scanned, so a test can show the scan saw something.
export async function expectNoSecrets(
  db: TestDatabase,
  secrets: Iterable<string>,
): Promise<number> {
  const events = await allEvents(db);
  const texts = events.map((event) => JSON.stringify(event));
  const checked = [...secrets].filter((secret) => secret.length >= 6);
  for (const secret of checked) {
    const leaks = texts.filter((text) => text.includes(secret));
    expect(leaks, `secret "${secret.slice(0, 6)}…" in the audit log`).toEqual([]);
  }
  return events.length;
}

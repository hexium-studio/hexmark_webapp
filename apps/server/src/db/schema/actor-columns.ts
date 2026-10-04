import { type SQL, sql } from "drizzle-orm";
import { check, type PgColumn, text, uuid } from "drizzle-orm/pg-core";
import { apiTokens } from "./api-tokens";
import { users } from "./users";

// Longest actor name: a token name (1-64) or a username (at most 32).
export const ACTOR_NAME_MAX_LENGTH = 64;

// Who made a change: a human (user id) or an agent (API token id), plus the
// name shown for it. The name is a snapshot taken when the change is written,
// so history stays readable after a user is renamed or deleted or a token is
// revoked or deleted.
//
// The application sets exactly one of the two ids on insert. The database
// only enforces "at most one": deleting the user or the token sets its id to
// null (the history row stays), so a row may legitimately end up with neither.
//
// Columns: <prefix>_user_id, <prefix>_token_id, <prefix>_name.
export function actorColumns(prefix: string) {
  return {
    userId: uuid(`${prefix}_user_id`).references(() => users.id, { onDelete: "set null" }),
    tokenId: uuid(`${prefix}_token_id`).references(() => apiTokens.id, { onDelete: "set null" }),
    name: text(`${prefix}_name`),
  };
}

interface ActorRefs {
  userId: PgColumn;
  tokenId: PgColumn;
  name: PgColumn;
}

// Checks for one actor triple: at most one id, and a name of 1-64 characters
// (null passes the length check; required triples declare the name not null).
export function actorChecks(table: string, prefix: string, actor: ActorRefs) {
  return [
    check(
      `${table}_${prefix}_single_id_check`,
      sql`num_nonnulls(${actor.userId}, ${actor.tokenId}) <= 1`,
    ),
    check(
      `${table}_${prefix}_name_length_check`,
      sql`char_length(${actor.name}) between 1 and ${sql.raw(String(ACTOR_NAME_MAX_LENGTH))}`,
    ),
  ];
}

// For an optional triple (locked_by): all of it is null exactly when `at`
// (the matching timestamp) is null; the ids may still be null when it is set.
export function optionalActorPairing(
  table: string,
  prefix: string,
  at: PgColumn,
  actor: ActorRefs,
) {
  const unset: SQL = sql`${actor.userId} is null and ${actor.tokenId} is null and ${actor.name} is null`;
  return check(
    `${table}_${prefix}_pairing_check`,
    sql`(${at} is null and ${unset}) or (${at} is not null and ${actor.name} is not null)`,
  );
}

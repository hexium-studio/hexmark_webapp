import type { TestDatabase } from "../../support/databases";

// A username or e-mail address "already taken" (409) can only happen when
// another account was created between the check and the insert, which a
// test cannot time. Instead, a trigger in the worker's database refuses
// these two values with the unique violation PostgreSQL itself would raise,
// so the API server answers exactly as in the real race. Any other value is
// inserted as usual.

export const TAKEN_USERNAME = "taken";
export const TAKEN_EMAIL = "taken@example.com";

export async function rejectTakenValues(db: TestDatabase): Promise<void> {
  await db.sql.unsafe(`
    create or replace function e2e_reject_taken() returns trigger language plpgsql as $$
    begin
      if new.username = '${TAKEN_USERNAME}' then
        raise exception 'username taken'
          using errcode = 'unique_violation', constraint = 'users_username_unique';
      end if;
      if new.email = '${TAKEN_EMAIL}' then
        raise exception 'e-mail taken'
          using errcode = 'unique_violation', constraint = 'users_email_unique';
      end if;
      return new;
    end $$
  `);
  await db.sql.unsafe("drop trigger if exists e2e_reject_taken on users");
  await db.sql.unsafe(
    "create trigger e2e_reject_taken before insert on users for each row execute function e2e_reject_taken()",
  );
}

export async function acceptTakenValues(db: TestDatabase): Promise<void> {
  await db.sql.unsafe("drop trigger if exists e2e_reject_taken on users");
  await db.sql.unsafe("drop function if exists e2e_reject_taken()");
}

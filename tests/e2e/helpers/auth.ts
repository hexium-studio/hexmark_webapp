import { createHash } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { expect, type Page } from "@playwright/test";
import type { Stack, StackServerOptions } from "../fixtures";
import { text, type UiLocale } from "./messages";

// Signing in through the UI. Accounts are written straight into the
// worker's database (an Argon2id hash, which the server verifies like its
// own); the API server then runs without SETUP_TOKEN, as after a finished
// setup. Uses locators: not for layer measurements.

export const SESSION_COOKIE = "hexmark_session";
export const LOCALE_COOKIE = "hexmark_locale";

export interface TestAccount {
  email: string;
  password: string;
  displayName: string;
  username: string;
  role: "admin" | "user" | "guest";
  locale: string;
}

export const ADA: TestAccount = {
  email: "ada@example.com",
  password: "correct horse battery",
  displayName: "Ada Lovelace",
  username: "ada",
  role: "admin",
  locale: "en",
};

export const GRACE: TestAccount = {
  email: "grace@example.com",
  password: "another long password",
  displayName: "Grace Hopper",
  username: "grace",
  role: "user",
  locale: "de",
};

export async function seedAccount(stack: Stack, account: TestAccount): Promise<void> {
  const passwordHash = await hash(account.password);
  await stack.db.sql`
    insert into users (email, username, display_name, password_hash, role, locale)
    values (${account.email}, ${account.username}, ${account.displayName}, ${passwordHash},
            ${account.role}, ${account.locale})
  `;
}

// Setup done (accounts exist), SETUP_TOKEN removed, the server restarted.
export async function prepareSignIn(
  stack: Stack,
  accounts: TestAccount[] = [ADA],
  server: StackServerOptions = {},
): Promise<void> {
  for (const account of accounts) await seedAccount(stack, account);
  await stack.restartServer({ setupToken: null, ...server });
}

export function signInHeading(page: Page, locale: UiLocale) {
  return page.getByRole("heading", { level: 1, name: text(locale, "auth.title") });
}

export function homeHeading(page: Page, locale: UiLocale, name: string) {
  return page.getByRole("heading", { level: 1, name: text(locale, "home.greeting", { name }) });
}

export function emailField(page: Page, locale: UiLocale) {
  return page.getByLabel(text(locale, "auth.fields.email.label"), { exact: true });
}

export function passwordField(page: Page, locale: UiLocale) {
  return page.getByLabel(text(locale, "auth.fields.password.label"), { exact: true });
}

export function rememberBox(page: Page, locale: UiLocale) {
  return page.getByRole("checkbox", { name: text(locale, "auth.fields.remember.label") });
}

export function signInButton(page: Page, locale: UiLocale) {
  return page.getByRole("button", { name: text(locale, "auth.submit"), exact: true });
}

export function signOutButton(page: Page, locale: UiLocale) {
  return page.getByRole("button", { name: text(locale, "home.signOut"), exact: true });
}

export async function openSignIn(page: Page, locale: UiLocale) {
  await page.goto("/");
  await expect(signInHeading(page, locale)).toBeVisible();
}

export async function signInWith(
  page: Page,
  locale: UiLocale,
  account: Pick<TestAccount, "email" | "password">,
  remember = false,
) {
  await emailField(page, locale).fill(account.email);
  await passwordField(page, locale).fill(account.password);
  if (remember) await rememberBox(page, locale).check();
  await signInButton(page, locale).click();
}

export async function sessionCookie(page: Page) {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === SESSION_COOKIE);
}

export async function localeCookie(page: Page) {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === LOCALE_COOKIE);
}

// Moves a timestamp of the session behind `token` into the past
// (`now() - interval`): the server compares it with its own clock.
export async function ageSession(stack: Stack, token: string, column: string, interval: string) {
  const digest = createHash("sha256").update(token).digest("hex");
  const rows = await stack.db.sql.unsafe(
    `update sessions set ${column} = now() - $2::interval where token_hash = $1 returning id`,
    [digest, interval],
  );
  expect(rows.length).toBe(1);
}

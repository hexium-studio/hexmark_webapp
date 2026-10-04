import { expect, type Page } from "@playwright/test";
import type { Stack } from "../fixtures";
import { homeHeading, prepareSignIn, sessionCookie, signInWith, type TestAccount } from "./auth";
import { text, type UiLocale } from "./messages";

// The API token page (/account/tokens): signing in, folders for the scope
// (created through the notes API with the browser's session) and creating a
// token through the form. Uses locators: not for layer measurements.

export async function signInToTokens(
  page: Page,
  stack: Stack,
  account: TestAccount,
  locale: UiLocale = "en",
): Promise<void> {
  await prepareSignIn(stack, [account]);
  await page.goto("/");
  await signInWith(page, locale, account);
  await expect(homeHeading(page, locale, account.displayName)).toBeVisible();
  await page.goto("/account/tokens");
  await expect(tokensHeading(page, locale)).toBeVisible();
}

export function tokensHeading(page: Page, locale: UiLocale) {
  return page.getByRole("heading", { level: 1, name: text(locale, "tokens.title") });
}

// A folder made with the signed-in user's session, straight at the API server.
export async function createFolder(
  page: Page,
  stack: Stack,
  name: string,
  parentId: string | null = null,
): Promise<string> {
  const session = (await sessionCookie(page))?.value ?? "";
  const response = await fetch(`${stack.serverUrl}/api/notes/v1/folders`, {
    method: "POST",
    headers: { authorization: `Session ${session}`, "content-type": "application/json" },
    body: JSON.stringify({ name, parentId }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

export function nameField(page: Page, locale: UiLocale) {
  return page.getByLabel(text(locale, "tokens.form.name.label"), { exact: true });
}

export function createButton(page: Page, locale: UiLocale) {
  return page.getByRole("button", { name: text(locale, "tokens.form.submit"), exact: true });
}

export function confirmDialog(page: Page, locale: UiLocale) {
  return page.getByRole("dialog", { name: text(locale, "tokens.confirm.title") });
}

// Submits the form as filled in and, when asked, confirms the password.
export async function submitToken(page: Page, locale: UiLocale, password?: string) {
  await createButton(page, locale).click();
  if (password) {
    const dialog = confirmDialog(page, locale);
    await dialog
      .getByLabel(text(locale, "tokens.confirm.passwordLabel"), { exact: true })
      .fill(password);
    await dialog.getByRole("button", { name: text(locale, "tokens.confirm.submit") }).click();
    await expect(dialog).toHaveCount(0);
  }
}

// The one-time configuration block, parsed.
export async function shownConfig(page: Page) {
  const raw = (await page.locator("#tokens-created-config").textContent()) ?? "";
  return { raw, config: JSON.parse(raw) as McpBlock };
}

export interface McpBlock {
  mcpServers: {
    hexmark: { type: string; url: string; headers: { Authorization: string } };
  };
}

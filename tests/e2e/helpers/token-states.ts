import { expect, type Page } from "@playwright/test";
import type { Stack } from "../fixtures";
import { ADA, ageSession, sessionCookie } from "./auth";
import { text, type UiLocale } from "./messages";
import {
  createButton,
  createFolder,
  modeRadio,
  nameField,
  openFolder,
  signInToTokens,
  submitToken,
  treeBox,
} from "./tokens";
import { toasts } from "./wizard";

// Walks through every state of the token page worth checking on its own
// (accessibility, layout) and calls `visit` in each: the list with a token
// and folders, the form with its errors, the form with a mode chosen and the
// tree opened, the password dialog, the one-time configuration, the form
// changing a token and the revoke dialog. Long, unbroken names and paths test
// wrapping. Uses locators, so it is not suitable for layer measurements.

export type TokenState =
  | "page"
  | "form-errors"
  | "tree-open"
  | "confirm-dialog"
  | "created"
  | "edit-form"
  | "revoke-dialog";

export const LONG_NAME = "agent-with-a-very-long-name-that-has-no-spaces-anywhere-in-it-x";
export const LONG_FOLDER = "Folder-with-a-long-name-and-no-spaces-to-break-the-line-anywhere";

// Folders and a token made through the API with the browser's session. The
// server wants the password re-entered for a new token; afterwards that
// confirmation is moved out of its window again, so the page still asks.
export async function seedTokenPage(page: Page, stack: Stack): Promise<void> {
  const parent = await createFolder(page, stack, LONG_FOLDER);
  const child = await createFolder(page, stack, "Web", parent);
  const session = (await sessionCookie(page))?.value ?? "";
  const reauthentication = await fetch(`${stack.serverUrl}/api/auth/v1/reauthenticate`, {
    method: "POST",
    headers: { authorization: `Session ${session}`, "content-type": "application/json" },
    body: JSON.stringify({ password: ADA.password }),
  });
  expect(reauthentication.status).toBe(200);
  const response = await fetch(`${stack.serverUrl}/api/tokens/v1/tokens`, {
    method: "POST",
    headers: { authorization: `Session ${session}`, "content-type": "application/json" },
    body: JSON.stringify({
      name: LONG_NAME,
      mode: "allow_list",
      entries: [
        { kind: "folder", id: parent, permissions: ["read", "search"] },
        { kind: "folder", id: child, permissions: ["read", "search", "edit"] },
      ],
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    }),
  });
  expect(response.status).toBe(201);
  await ageSession(stack, session, "reauthenticated_at", "1 hour");
}

export async function eachTokenState(
  page: Page,
  stack: Stack,
  locale: UiLocale,
  visit: (state: TokenState) => Promise<void>,
) {
  const t = (key: string, values?: Record<string, string>) => text(locale, key, values);
  const ada = { ...ADA, locale };
  await signInToTokens(page, stack, ada, locale);
  await seedTokenPage(page, stack);
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: LONG_NAME })).toBeVisible();
  await visit("page");

  await createButton(page, locale).click();
  await expect(page.getByText(t("tokens.form.access.modeMissing"))).toBeVisible();
  await visit("form-errors");

  await nameField(page, locale).fill("layout-check");
  await modeRadio(page, locale, "allow_list").check();
  await openFolder(page, locale, LONG_FOLDER);
  await treeBox(page, locale, "folder", "Web").check();
  await visit("tree-open");
  await createButton(page, locale).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await visit("confirm-dialog");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await submitToken(page, locale, ada.password);
  await expect(
    page.getByRole("heading", { name: t("tokens.created.heading", { name: "layout-check" }) }),
  ).toBeFocused();
  await visit("created");
  // The success toast may cover "Done" on a narrow screen (paused by settle).
  await toasts(page).first().getByRole("button").last().click();
  await page.getByRole("button", { name: t("tokens.created.done") }).click();

  const item = page.getByRole("listitem").filter({ hasText: LONG_NAME });
  await item.getByRole("button", { name: new RegExp(`^${t("tokens.list.edit")}`) }).click();
  await expect(
    page.getByRole("heading", { name: t("tokens.form.editTitle", { name: LONG_NAME }) }),
  ).toBeVisible();
  await visit("edit-form");
  await page.getByRole("button", { name: t("tokens.form.cancel"), exact: true }).click();

  await item.getByRole("button", { name: new RegExp(`^${t("tokens.list.revoke")}`) }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await visit("revoke-dialog");
  await page.keyboard.press("Escape");
}

import { expect, type Page } from "@playwright/test";
import { text, type UiLocale } from "./messages";

// Walking through the setup wizard with locators, in the UI language
// `locale`. Not for layer measurements: locators add a compositing layer of
// their own (layers.spec.ts uses page.evaluate and real input only).

export const WRONG_TOKEN = "WRONG234";

export const ADMIN = {
  displayName: "Ada Admin",
  username: "ada",
  email: "ada@example.com",
  password: "correct horse battery",
};

export function stepHeading(page: Page, locale: UiLocale, step: string) {
  return page.getByRole("heading", { level: 2, name: text(locale, `setup.steps.${step}.title`) });
}

export async function openSetup(page: Page, locale: UiLocale) {
  await page.goto("/setup");
  await expect(stepHeading(page, locale, "language")).toBeVisible();
}

export async function continueStep(page: Page, locale: UiLocale, next: string) {
  await page.getByRole("button", { name: text(locale, "common.continue"), exact: true }).click();
  await expect(stepHeading(page, locale, next)).toBeVisible();
}

export async function toTokenStep(page: Page, locale: UiLocale) {
  await openSetup(page, locale);
  await continueStep(page, locale, "connection");
  await continueStep(page, locale, "token");
}

export function tokenCells(page: Page, locale: UiLocale) {
  const name = new RegExp(`^${text(locale, "codeInput.cell", { position: "\\d", length: 8 })}$`);
  return page.getByRole("textbox", { name });
}

export function tokenCell(page: Page, locale: UiLocale, position: number) {
  return page.getByRole("textbox", {
    name: text(locale, "codeInput.cell", { position, length: 8 }),
    exact: true,
  });
}

export async function typeToken(page: Page, locale: UiLocale, token: string) {
  await tokenCell(page, locale, 1).click();
  await page.keyboard.type(token);
}

export function verifyButton(page: Page, locale: UiLocale) {
  return page.getByRole("button", { name: text(locale, "setup.token.verify") });
}

export async function toAccountStep(page: Page, locale: UiLocale, token: string) {
  await toTokenStep(page, locale);
  await typeToken(page, locale, token);
  await verifyButton(page, locale).click();
  await expect(stepHeading(page, locale, "account")).toBeVisible();
}

export function accountField(page: Page, locale: UiLocale, name: string) {
  return page.getByLabel(text(locale, `setup.account.fields.${name}.label`), { exact: true });
}

export function createButton(page: Page, locale: UiLocale) {
  return page.getByRole("button", { name: text(locale, "setup.account.create") });
}

export async function fillAccount(page: Page, locale: UiLocale, admin = ADMIN) {
  await accountField(page, locale, "displayName").fill(admin.displayName);
  await accountField(page, locale, "username").fill(admin.username);
  await accountField(page, locale, "email").fill(admin.email);
  await accountField(page, locale, "password").fill(admin.password);
  await accountField(page, locale, "passwordConfirm").fill(admin.password);
}

// The visible toasts (not the screen reader live regions).
export function toasts(page: Page) {
  return page.locator("[data-toast-id]");
}

// Steps 5 and 6 after the admin was created: skips the second factor
// (confirming the warning) and finishes with the preselected settings.
export async function finishWithoutSecondFactor(page: Page, locale: UiLocale) {
  await expect(stepHeading(page, locale, "twoFactor")).toBeVisible();
  await page.getByRole("button", { name: text(locale, "setup.twoFactor.skip") }).click();
  await page
    .getByRole("button", { name: text(locale, "setup.twoFactor.skipConfirm.skip") })
    .click();
  await expect(stepHeading(page, locale, "settings")).toBeVisible();
  await page.getByRole("button", { name: text(locale, "setup.settings.finish") }).click();
  await expect(page).toHaveURL(/\/setup\/complete$/);
}

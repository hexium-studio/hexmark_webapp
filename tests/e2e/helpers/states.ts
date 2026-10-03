import { expect, type Page } from "@playwright/test";
import type { Stack } from "../fixtures";
import { text, type UiLocale } from "./messages";
import { acceptTakenValues, rejectTakenValues, TAKEN_USERNAME } from "./taken";
import {
  ADMIN,
  accountField,
  continueStep,
  createButton,
  fillAccount,
  openSetup,
  stepHeading,
  toasts,
  tokenCell,
  typeToken,
  verifyButton,
  WRONG_TOKEN,
} from "./wizard";

// Walks through every state of the setup flow worth checking on its own
// (accessibility, layout) and calls `visit` in each. Uses locators, so it
// is not suitable for layer measurements.

export type FlowState =
  | "language"
  | "connection"
  | "token"
  | "token-wrong"
  | "account-rules"
  | "account-taken"
  | "two-factor"
  | "two-factor-app"
  | "two-factor-skip"
  | "settings"
  | "complete";

export async function eachFlowState(
  page: Page,
  locale: UiLocale,
  stack: Stack,
  visit: (state: FlowState) => Promise<void>,
) {
  const { token } = stack;
  await openSetup(page, locale);
  await visit("language");
  await continueStep(page, locale, "connection");
  await visit("connection");
  await continueStep(page, locale, "token");
  await visit("token");

  await typeToken(page, locale, WRONG_TOKEN);
  await verifyButton(page, locale).click();
  await expect(toasts(page).first()).toBeVisible();
  await visit("token-wrong");
  // In narrow windows the toast covers the buttons; close it like a user would.
  await toasts(page).first().getByRole("button").last().click();
  await expect(toasts(page)).toHaveCount(0);

  await tokenCell(page, locale, 1).click();
  await page.keyboard.type(token);
  await verifyButton(page, locale).click();
  await expect(stepHeading(page, locale, "account")).toBeVisible();
  // Some rules met, some not; leaving the fields shows no errors.
  for (const [field, value] of [
    ["displayName", " "],
    ["username", "a"],
    ["email", "ada@"],
    ["password", "short"],
    ["passwordConfirm", "other"],
  ] as const) {
    await accountField(page, locale, field).fill(value);
    await accountField(page, locale, field).blur();
  }
  await expect(page.locator("li[data-met]")).toHaveCount(1);
  await visit("account-rules");

  // The server refuses the username: the one red state of the form.
  await rejectTakenValues(stack.db);
  try {
    await fillAccount(page, locale, { ...ADMIN, username: TAKEN_USERNAME });
    await createButton(page, locale).click();
    await expect(page.getByText(text(locale, "errors.fields.username.taken"))).toBeVisible();
    await visit("account-taken");
  } finally {
    await acceptTakenValues(stack.db);
  }

  await fillAccount(page, locale);
  await createButton(page, locale).click();
  await expect(stepHeading(page, locale, "twoFactor")).toBeVisible();
  await expect(toasts(page).first()).toBeVisible();
  await visit("two-factor");
  // In narrow windows the toast covers the buttons; close it like a user would.
  await toasts(page).first().getByRole("button").last().click();
  await expect(toasts(page)).toHaveCount(0);
  await page.getByRole("button", { name: text(locale, "setup.twoFactor.app.start") }).click();
  await expect(page.locator("#setup-totp-key")).not.toHaveText(/X{4}/);
  await visit("two-factor-app");
  await page.getByRole("button", { name: text(locale, "twoFactor.totp.cancel") }).click();
  await page.getByRole("button", { name: text(locale, "setup.twoFactor.skip") }).click();
  await visit("two-factor-skip");
  await page
    .getByRole("button", { name: text(locale, "setup.twoFactor.skipConfirm.skip") })
    .click();
  await expect(stepHeading(page, locale, "settings")).toBeVisible();
  await visit("settings");
  await page.getByRole("button", { name: text(locale, "setup.settings.finish") }).click();
  await expect(page).toHaveURL(/\/setup\/complete$/);
  await expect(toasts(page).first()).toBeVisible();
  await visit("complete");
}

// Lets the page come to rest before a check: stops the toasts' time, so they
// cannot disappear in the middle of it, and waits for running colour
// transitions (e.g. a button leaving its pending state) to end.
export async function settle(page: Page) {
  await page.addStyleTag({
    content: "[data-toast-id] * { animation-play-state: paused !important; }",
  });
  await page.evaluate(async () => {
    const transitions = document
      .getAnimations()
      .filter((animation) => animation instanceof CSSTransition);
    await Promise.all(transitions.map((transition) => transition.finished.catch(() => {})));
  });
}

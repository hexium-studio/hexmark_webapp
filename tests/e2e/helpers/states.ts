import { expect, type Page } from "@playwright/test";
import type { UiLocale } from "./messages";
import {
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
  | "account-errors"
  | "complete";

export async function eachFlowState(
  page: Page,
  locale: UiLocale,
  token: string,
  visit: (state: FlowState) => Promise<void>,
) {
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
  await expect(accountField(page, locale, "username")).toHaveAttribute("aria-invalid", "true");
  await visit("account-errors");

  await fillAccount(page, locale);
  await createButton(page, locale).click();
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

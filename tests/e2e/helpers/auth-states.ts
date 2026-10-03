import { expect, type Page } from "@playwright/test";
import type { Stack } from "../fixtures";
import {
  ADA,
  emailField,
  homeHeading,
  openSignIn,
  passwordField,
  prepareSignIn,
  signInHeading,
  signInWith,
  signOutButton,
} from "./auth";
import { text, type UiLocale } from "./messages";
import { toasts } from "./wizard";

// Walks through every state of sign-in worth checking on its own
// (accessibility, layout) and calls `visit` in each. Uses locators, so it is
// not suitable for layer measurements.

export type AuthState =
  | "sign-in"
  | "sign-in-invalid"
  | "wrong-password"
  | "home"
  | "signed-out"
  | "blocked";

export async function eachAuthState(
  page: Page,
  stack: Stack,
  locale: UiLocale,
  visit: (state: AuthState) => Promise<void>,
) {
  // The account's language follows the walk, so home is in `locale` too.
  await prepareSignIn(stack, [{ ...ADA, locale }]);
  await openSignIn(page, locale);
  await visit("sign-in");

  // Invalid input, fields left: the button stays disabled, no field errors.
  await emailField(page, locale).fill("ada@");
  await emailField(page, locale).blur();
  await expect(page.locator("main form button[type=submit]")).toBeDisabled();
  await visit("sign-in-invalid");

  await signInWith(page, locale, { email: ADA.email, password: "not the password" });
  await expect(toasts(page).first()).toBeVisible();
  await visit("wrong-password");
  await toasts(page).first().getByRole("button").last().click();
  await expect(toasts(page)).toHaveCount(0);

  await passwordField(page, locale).fill(ADA.password);
  await page.keyboard.press("Enter");
  await expect(homeHeading(page, locale, ADA.displayName)).toBeVisible();
  await visit("home");

  await signOutButton(page, locale).click();
  await expect(signInHeading(page, locale)).toBeVisible();
  await expect(toasts(page).first()).toBeVisible();
  await visit("signed-out");

  await stack.restartServer({ setupToken: stack.token });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: text(locale, "auth.signInBlocked.title") }),
  ).toBeVisible();
  await visit("blocked");
}

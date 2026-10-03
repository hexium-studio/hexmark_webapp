import { RECOVERY_CODE_COUNT } from "@hexmark/shared";
import { expect, type Page } from "@playwright/test";
import type { Stack } from "../fixtures";
import { ADA, GRACE, homeHeading, prepareSignIn, signInWith } from "./auth";
import { text, type UiLocale } from "./messages";
import {
  localOrigin,
  manualKey,
  seedTotpAccount,
  setRequireTwoFactor,
  totpCode,
  typeTotp,
} from "./two-factor";
import { toasts } from "./wizard";

// Walks through every state of the second-factor pages worth checking on
// its own (accessibility, layout) and calls `visit` in each: the second
// step at sign-in (security key, code, a wrong code), the recovery code,
// the account security page and its dialog, and forced enrolment. Uses
// locators, so it is not suitable for layer measurements.

export type TwoFactorState =
  | "second-factor"
  | "second-factor-wrong"
  | "recovery"
  | "account"
  | "account-dialog"
  | "enrolment-choose"
  | "enrolment-app"
  | "enrolment-codes";

export async function eachTwoFactorState(
  page: Page,
  stack: Stack,
  locale: UiLocale,
  visit: (state: TwoFactorState) => Promise<void>,
) {
  const t = (key: string) => text(locale, key);
  const origin = localOrigin(stack);
  const ada = { ...ADA, locale };
  const { secret } = await seedTotpAccount(stack, ada, { env: { PUBLIC_ORIGIN: origin } }, origin);

  await page.goto(origin);
  await signInWith(page, locale, ada);
  await expect(
    page.getByRole("heading", { level: 1, name: t("secondFactor.title") }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: t("secondFactor.key.use") })).toBeVisible();
  await visit("second-factor");

  await page.locator("#second-factor-code-1").click();
  await page.keyboard.type(totpCode(secret, 5));
  await page.getByRole("button", { name: t("secondFactor.code.verify"), exact: true }).click();
  await expect(toasts(page).first()).toBeVisible();
  await visit("second-factor-wrong");
  await toasts(page).first().getByRole("button").last().click();

  await page.getByRole("button", { name: t("secondFactor.useRecovery") }).click();
  await expect(page.locator("#recovery-code-1")).toBeVisible();
  await visit("recovery");
  await page.getByRole("button", { name: t("secondFactor.recovery.back") }).click();

  await typeTotp(page, "second-factor-code", secret);
  await page.getByRole("button", { name: t("secondFactor.code.verify"), exact: true }).click();
  await expect(homeHeading(page, locale, ada.displayName)).toBeVisible();
  await page.goto(`${origin}/account/security`);
  await expect(
    page.getByRole("heading", { level: 1, name: t("accountSecurity.title") }),
  ).toBeVisible();
  await visit("account");

  await page.getByRole("button", { name: t("accountSecurity.codes.regenerate") }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await visit("account-dialog");
  await page.keyboard.press("Escape");

  // Forced enrolment of a second account.
  const grace = { ...GRACE, locale };
  await prepareSignIn(stack, [grace], { env: { PUBLIC_ORIGIN: origin } });
  await setRequireTwoFactor(stack, true);
  await page.context().clearCookies();
  await page.goto(origin);
  await signInWith(page, locale, grace);
  await expect(
    page.getByRole("heading", { level: 1, name: t("secondFactor.enrolment.title") }),
  ).toBeVisible();
  await visit("enrolment-choose");
  await page.getByRole("button", { name: t("secondFactor.enrolment.useApp") }).click();
  const graceSecret = await manualKey(page, "enrol-totp");
  await visit("enrolment-app");
  await typeTotp(page, "enrol-totp-code", graceSecret);
  await page.getByRole("button", { name: t("twoFactor.totp.confirm"), exact: true }).click();
  await expect(page.locator("main ol li")).toHaveCount(RECOVERY_CODE_COUNT);
  await visit("enrolment-codes");
}

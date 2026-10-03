import { randomBytes } from "node:crypto";
import { RECOVERY_CODE_COUNT } from "@hexmark/shared";
import { expect, test } from "./fixtures";
import {
  ADA,
  homeHeading,
  openSignIn,
  prepareSignIn,
  sessionCookie,
  signInHeading,
  signInWith,
  signOutButton,
} from "./helpers/auth";
import { text } from "./helpers/messages";
import { topsOf } from "./helpers/positions";
import {
  forgetLastTotpStep,
  manualKey,
  seedTotpAccount,
  setRequireTwoFactor,
  totpCode,
  typeTotp,
} from "./helpers/two-factor";
import { toasts } from "./helpers/wizard";

// Signing in with a second factor: the authenticator app's code, a recovery
// code (once), wrong codes, a challenge that ran out, an account without a
// usable method, and the forced set-up of a factor when the instance
// requires one. Security keys at sign-in: account-security.spec.ts.

const t = (key: string, values?: Record<string, string | number>) => text("en", key, values);

test.use({ locale: "en-US" });

const secondFactorHeading = (page: import("@playwright/test").Page) =>
  page.getByRole("heading", { level: 1, name: t("secondFactor.title") });
const verify = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: t("secondFactor.code.verify"), exact: true });

test("the authenticator app's code completes the sign-in", async ({ page, stack }) => {
  const { secret } = await seedTotpAccount(stack);
  await openSignIn(page, "en");
  await signInWith(page, "en", ADA);
  await expect(secondFactorHeading(page)).toBeFocused();
  // Security keys are not offered by this server: no button for them.
  await expect(page.getByRole("button", { name: t("secondFactor.key.use") })).toHaveCount(0);
  await expect(verify(page)).toBeDisabled();
  expect(await sessionCookie(page)).toBeUndefined();
  const challenge = (await page.context().cookies()).find((c) => c.name === "hexmark_challenge");
  expect(challenge?.httpOnly).toBe(true);

  await typeTotp(page, "second-factor-code", secret);
  await verify(page).click();
  await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();
  expect(await sessionCookie(page)).toBeDefined();
  expect((await page.context().cookies()).map((cookie) => cookie.name)).not.toContain(
    "hexmark_challenge",
  );
});

test("a wrong code: red cells, a toast with the attempts left, nothing moves", async ({
  page,
  stack,
}) => {
  const { secret } = await seedTotpAccount(stack);
  await openSignIn(page, "en");
  await signInWith(page, "en", ADA);
  await expect(secondFactorHeading(page)).toBeVisible();
  const watched = ["main form button[type=submit]", "main button:last-of-type"];
  const before = await topsOf(page, watched);

  // Five steps ahead: outside the accepted window (±1) at any moment.
  const wrong = totpCode(secret, 5);
  await page.locator("#second-factor-code-1").click();
  await page.keyboard.type(wrong);
  await verify(page).click();
  const toast = toasts(page).first();
  await expect(toast).toHaveAttribute("data-type", "error");
  await expect(toast).toContainText(t("twoFactor.errors.invalid_code.title"));
  await expect(toast).toContainText("4 more attempts");
  const cells = page.locator("#second-factor-code input");
  await expect(cells.first()).toHaveAttribute("aria-invalid", "true");
  await expect(cells.first()).toBeFocused();
  // No text below the cells: the red frame is all, so nothing moved.
  expect(await topsOf(page, watched)).toEqual(before);
  // Typing again clears the red state, also when the key is the digit the
  // cell already shows (the input's value does not change then).
  await page.keyboard.type(wrong.charAt(0));
  await expect(cells.first()).not.toHaveAttribute("aria-invalid");
});

test("a recovery code works once", async ({ page, stack }) => {
  const { recoveryCodes } = await seedTotpAccount(stack);
  const [first, second] = recoveryCodes;
  for (const [code, works] of [
    [first, true],
    [first, false],
    [second, true],
  ] as const) {
    await page.context().clearCookies();
    await openSignIn(page, "en");
    await signInWith(page, "en", ADA);
    await page.getByRole("button", { name: t("secondFactor.useRecovery") }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: t("secondFactor.recovery.title") }),
    ).toBeFocused();
    const submit = page.getByRole("button", { name: t("secondFactor.recovery.verify") });
    await expect(submit).toBeDisabled();
    // Typed in lower case with its dashes: the groups fill one after another.
    await page.locator("#recovery-code-1").click();
    await page.keyboard.type(code?.toLowerCase() ?? "");
    await expect(page.locator("#recovery-code-3")).toHaveValue(code?.slice(-4) ?? "");
    await submit.click();
    if (works) {
      await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();
    } else {
      await expect(toasts(page).first()).toContainText(t("twoFactor.errors.invalid_code.title"));
      await expect(page.locator("#recovery-code-1")).toHaveAttribute("aria-invalid", "true");
    }
  }
  const [row] = await stack.db.sql`
    select count(*)::int as used from recovery_codes where used_at is not null`;
  expect(row?.used).toBe(2);
});

test("a challenge that ran out leads back to the password with a note", async ({ page, stack }) => {
  const { secret } = await seedTotpAccount(stack);
  await openSignIn(page, "en");
  await signInWith(page, "en", ADA);
  await expect(secondFactorHeading(page)).toBeVisible();
  await stack.db.sql`
    update auth_challenges set created_at = now() - interval '10 minutes',
      expires_at = now() - interval '5 minutes'`;
  await typeTotp(page, "second-factor-code", secret);
  await verify(page).click();
  await expect(signInHeading(page, "en")).toBeFocused();
  const toast = toasts(page).first();
  await expect(toast).toHaveAttribute("data-type", "info");
  await expect(toast).toContainText(t("secondFactor.expired.title"));
});

test("without any usable method the page says whom to ask", async ({ page, stack }) => {
  await prepareSignIn(stack);
  // A key only, and the server offers no security keys: nothing is usable.
  await stack.db.sql`
    insert into webauthn_credentials (user_id, credential_id, public_key, name)
    select id, ${randomBytes(16).toString("base64url")}, ${randomBytes(65)}, 'Desk key'
    from users where email = ${ADA.email}`;
  await openSignIn(page, "en");
  await signInWith(page, "en", ADA);
  await expect(page.locator("main [role=alert]")).toContainText(
    t("secondFactor.noMethod.none.title"),
  );
  await page.getByRole("button", { name: t("secondFactor.noMethod.back") }).click();
  await expect(signInHeading(page, "en")).toBeFocused();
});

test("an account without a factor sets one up when the instance requires it", async ({
  page,
  stack,
}) => {
  await prepareSignIn(stack);
  await setRequireTwoFactor(stack, true);
  await openSignIn(page, "en");
  await signInWith(page, "en", ADA, true);
  await expect(
    page.getByRole("heading", { level: 1, name: t("secondFactor.enrolment.title") }),
  ).toBeVisible();
  // Only the app is offered here (no PUBLIC_ORIGIN), so its set-up opens at once.
  const secret = await manualKey(page, "enrol-totp");
  await typeTotp(page, "enrol-totp-code", secret);
  await page.getByRole("button", { name: t("twoFactor.totp.confirm"), exact: true }).click();

  // The codes come first; the session waits until they are saved.
  await expect(page.locator("main ol li")).toHaveCount(RECOVERY_CODE_COUNT);
  await expect(
    page.getByRole("heading", { name: t("secondFactor.enrolment.codesHeading") }),
  ).toBeFocused();
  expect(await sessionCookie(page)).toBeUndefined();
  await page.getByRole("checkbox", { name: t("twoFactor.recovery.savedConfirm") }).check();
  await page.getByRole("button", { name: t("secondFactor.enrolment.finish") }).click();
  await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();
  // "Remember me" was carried through the challenge.
  expect((await sessionCookie(page))?.expires).toBeGreaterThan(Date.now() / 1000 + 86_400);

  // Next time the app's code is asked for.
  await forgetLastTotpStep(stack, ADA.email);
  await signOutButton(page, "en").click();
  await signInWith(page, "en", ADA);
  await expect(secondFactorHeading(page)).toBeVisible();
});

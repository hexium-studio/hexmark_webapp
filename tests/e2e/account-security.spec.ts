import { RECOVERY_CODE_COUNT } from "@hexmark/shared";
import type { Page } from "@playwright/test";
import { seedLegacyRecoveryCodes } from "../support/legacy-recovery-codes";
import { expect, test } from "./fixtures";
import {
  ADA,
  homeHeading,
  prepareSignIn,
  signInHeading,
  signInWith,
  signOutButton,
} from "./helpers/auth";
import { text } from "./helpers/messages";
import {
  addVirtualAuthenticator,
  localOrigin,
  manualKey,
  seedTotpAccount,
  setRequireTwoFactor,
  typeTotp,
} from "./helpers/two-factor";
import { toasts } from "./helpers/wizard";

// The account security page (/account/security): adding the authenticator
// app and security keys (Chrome's virtual authenticator), renaming and
// removing keys with the password confirmed in a dialog, new recovery
// codes, the last-factor rule, dates in the account's time zone, and
// signing in with the key afterwards.

const t = (key: string, values?: Record<string, string | number>) => text("en", key, values);

test.use({ locale: "en-US" });

async function signInAt(page: Page, origin: string) {
  await page.goto(origin);
  await expect(signInHeading(page, "en")).toBeVisible();
  await signInWith(page, "en", ADA);
  await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();
}

test("manages factors, asks for the password before removing one", async ({ page, stack }) => {
  const origin = localOrigin(stack);
  await prepareSignIn(stack, [ADA], { env: { PUBLIC_ORIGIN: origin } });
  await stack.db.sql`update users set timezone = 'Asia/Tokyo' where email = ${ADA.email}`;
  const authenticator = await addVirtualAuthenticator(page);
  await signInAt(page, origin);
  await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();

  // Home points to the security page while there is no second factor.
  await expect(page.getByText(t("home.twoFactorMissing.title"))).toBeVisible();
  await page.getByRole("link", { name: t("home.twoFactorMissing.link") }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: t("accountSecurity.title") }),
  ).toBeVisible();

  // Authenticator app, with the first recovery codes.
  await page.getByRole("button", { name: t("accountSecurity.app.setUp") }).click();
  const secret = await manualKey(page, "account-totp");
  await typeTotp(page, "account-totp-code", secret);
  await page.getByRole("button", { name: t("twoFactor.totp.confirm"), exact: true }).click();
  await expect(
    page.getByRole("heading", { name: t("accountSecurity.codes.firstHeading") }),
  ).toBeFocused();
  await page.getByRole("checkbox", { name: t("twoFactor.recovery.savedConfirm") }).check();
  await page.getByRole("button", { name: t("accountSecurity.codes.done") }).click();
  await expect(
    page.getByText(t("accountSecurity.codes.left", { count: RECOVERY_CODE_COUNT }), {
      exact: true,
    }),
  ).toBeVisible();

  // A security key, named, with the date in the account's zone (Tokyo).
  await page.getByRole("button", { name: t("accountSecurity.keys.add") }).click();
  await page.getByLabel(t("twoFactor.key.nameLabel")).fill("YubiKey on my keyring");
  await page.getByRole("button", { name: t("twoFactor.key.register") }).click();
  const item = page.getByRole("listitem").filter({ hasText: "YubiKey on my keyring" });
  await expect(item).toBeVisible();
  // The form is gone; focus is on the section's heading, not lost.
  await expect(page.getByRole("heading", { name: t("accountSecurity.keys.title") })).toBeFocused();
  expect(await authenticator.credentials()).toHaveLength(1);
  const [key] = await stack.db.sql`select created_at from webauthn_credentials`;
  const added = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(key?.created_at as Date);
  await expect(item).toContainText(t("accountSecurity.keys.addedOn", { date: added }));
  await expect(item).toContainText(t("accountSecurity.keys.neverUsed"));

  // Renaming needs no password.
  await item.getByRole("button", { name: /^Rename/ }).click();
  await page.getByLabel(/^New name for/).fill("Spare key");
  await page.getByRole("button", { name: t("accountSecurity.keys.save") }).click();
  const renamed = page.getByRole("listitem").filter({ hasText: "Spare key" });
  await expect(renamed).toBeVisible();
  await expect(renamed.getByRole("button", { name: /^Rename/ })).toBeFocused();

  // Removing asks for the password in a dialog; Escape closes it and
  // focus returns to the button.
  const remove = renamed.getByRole("button", { name: "Remove Spare key" });
  await remove.click();
  const dialog = page.getByRole("dialog", { name: t("accountSecurity.confirm.removeKey.title") });
  await expect(dialog).toContainText("Spare key");
  const password = dialog.getByLabel(t("accountSecurity.confirm.passwordLabel"), { exact: true });
  await expect(password).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(remove).toBeFocused();

  await remove.click();
  await password.fill("not the password");
  await dialog.getByRole("button", { name: t("accountSecurity.confirm.removeKey.action") }).click();
  await expect(password).toHaveAttribute("aria-invalid", "true");
  await expect(dialog).toContainText(t("accountSecurity.confirm.passwordWrong"));
  await password.fill(ADA.password);
  await dialog.getByRole("button", { name: t("accountSecurity.confirm.removeKey.action") }).click();
  await expect(dialog).toHaveCount(0);
  await expect(toasts(page).first()).toContainText(t("accountSecurity.done.removeKey"));
  await expect(page.getByRole("listitem").filter({ hasText: "Spare key" })).toHaveCount(0);

  // Within 10 minutes no password is asked again: new codes right away.
  await page.getByRole("button", { name: t("accountSecurity.codes.regenerate") }).click();
  const regenerate = page.getByRole("dialog");
  await expect(regenerate.getByLabel(t("accountSecurity.confirm.passwordLabel"))).toHaveCount(0);
  await regenerate
    .getByRole("button", { name: t("accountSecurity.confirm.regenerate.action") })
    .click();
  await expect(
    page.getByRole("heading", { name: t("accountSecurity.codes.newHeading") }),
  ).toBeFocused();
  await expect(page.locator("main ol li")).toHaveCount(RECOVERY_CODE_COUNT);
});

test("the last factor stays while the instance requires one", async ({ page, stack }) => {
  const origin = localOrigin(stack);
  await prepareSignIn(stack, [ADA], { env: { PUBLIC_ORIGIN: origin } });
  await addVirtualAuthenticator(page);
  await signInAt(page, origin);
  await page.goto(`${origin}/account/security`);
  await page.getByRole("button", { name: t("accountSecurity.keys.add") }).click();
  await page.getByLabel(t("twoFactor.key.nameLabel")).fill("Desk key");
  await page.getByRole("button", { name: t("twoFactor.key.register") }).click();
  await page.getByRole("checkbox", { name: t("twoFactor.recovery.savedConfirm") }).check();
  await page.getByRole("button", { name: t("accountSecurity.codes.done") }).click();

  await setRequireTwoFactor(stack, true);
  await page.reload();
  await expect(page.getByText(t("accountSecurity.required"))).toBeVisible();
  const remove = page.getByRole("button", { name: "Remove Desk key" });
  await expect(remove).toBeDisabled();
  await expect(remove).toHaveAccessibleDescription(t("accountSecurity.keys.lastFactor"));

  // Signing in with the key: the quickest way is offered first.
  await page.getByRole("link", { name: t("accountSecurity.home") }).click();
  await signOutButton(page, "en").click();
  await signInWith(page, "en", ADA);
  await page.getByRole("button", { name: t("secondFactor.key.use") }).click();
  await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();
  // A factor exists: home links to the page instead of warning.
  await expect(page.getByText(t("home.twoFactorMissing.title"))).toHaveCount(0);
  await expect(page.getByRole("link", { name: t("home.securityLink") })).toBeVisible();
  const [row] = await stack.db.sql`select last_used_at from webauthn_credentials`;
  expect(row?.last_used_at).not.toBeNull();
});

// A set issued when sets were larger keeps every code: the page counts all
// of them, and new codes replace them with a set of today's size.
test("counts a larger set issued earlier and replaces it", async ({ page, stack }) => {
  await seedTotpAccount(stack);
  const [user] = await stack.db.sql`select id from users where email = ${ADA.email}`;
  const legacy = await seedLegacyRecoveryCodes(stack.db, user?.id as string, 10);

  await page.goto("/");
  await signInWith(page, "en", ADA);
  await page.getByRole("button", { name: t("secondFactor.useRecovery") }).click();
  await page.locator("#recovery-code-1").click();
  await page.keyboard.type(legacy[9] ?? "");
  await page.getByRole("button", { name: t("secondFactor.recovery.verify") }).click();
  await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();

  await page.goto("/account/security");
  const left = (count: number) =>
    page.getByText(t("accountSecurity.codes.left", { count }), { exact: true });
  await expect(left(9)).toBeVisible();
  await expect(page.getByText(t("accountSecurity.codes.description"))).toBeVisible();

  await page.getByRole("button", { name: t("accountSecurity.codes.regenerate") }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel(t("accountSecurity.confirm.passwordLabel"), { exact: true })
    .fill(ADA.password);
  await dialog
    .getByRole("button", { name: t("accountSecurity.confirm.regenerate.action") })
    .click();
  await expect(page.locator("main ol li")).toHaveCount(RECOVERY_CODE_COUNT);
  await page.getByRole("checkbox", { name: t("twoFactor.recovery.savedConfirm") }).check();
  await page.getByRole("button", { name: t("accountSecurity.codes.done") }).click();
  await expect(left(RECOVERY_CODE_COUNT)).toBeVisible();
  const [row] = await stack.db.sql`
    select count(*)::int as n from recovery_codes where user_id = ${user?.id as string}`;
  expect(row?.n).toBe(RECOVERY_CODE_COUNT);
});

test("signed out, the page leads to sign-in", async ({ page, stack }) => {
  await prepareSignIn(stack);
  await page.goto("/account/security");
  await expect(signInHeading(page, "en")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

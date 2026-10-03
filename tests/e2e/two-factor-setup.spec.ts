import { readFile } from "node:fs/promises";
import { RECOVERY_CODE_COUNT } from "@hexmark/shared";
import { expect, test } from "./fixtures";
import { text } from "./helpers/messages";
import {
  addVirtualAuthenticator,
  localOrigin,
  manualKey,
  offerSecurityKeys,
  typeTotp,
} from "./helpers/two-factor";
import {
  ADMIN,
  continueStep,
  createButton,
  fillAccount,
  stepHeading,
  toasts,
  typeToken,
  verifyButton,
} from "./helpers/wizard";

// Setup steps 5 and 6: a second factor for the first admin (authenticator
// app with a code computed from the shown key, a security key through
// Chrome's virtual authenticator), the recovery codes shown once, and the
// system settings. Also skipping step 5 and a setup ticket that ran out.

const t = (key: string, values?: Record<string, string | number>) => text("en", key, values);

test.use({ locale: "en-US", timezoneId: "Europe/Berlin" });

async function toTwoFactorStep(
  page: import("@playwright/test").Page,
  origin: string,
  token: string,
) {
  await page.goto(`${origin}/setup`);
  await expect(stepHeading(page, "en", "language")).toBeVisible();
  await continueStep(page, "en", "connection");
  await continueStep(page, "en", "token");
  await typeToken(page, "en", token);
  await verifyButton(page, "en").click();
  await fillAccount(page, "en");
  await createButton(page, "en").click();
  await expect(stepHeading(page, "en", "twoFactor")).toBeVisible();
  await expect(toasts(page).first()).toContainText(t("setup.account.created.title"));
}

test("adds an app and a key, shows the codes once and saves the settings", async ({
  page,
  stack,
}) => {
  await offerSecurityKeys(stack);
  const origin = localOrigin(stack);
  const authenticator = await addVirtualAuthenticator(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await toTwoFactorStep(page, origin, stack.token);

  // Authenticator app: the key shown for manual entry gives the codes.
  await page.getByRole("button", { name: t("setup.twoFactor.app.start") }).click();
  await expect(page.getByRole("img", { name: t("twoFactor.totp.qrLabel") })).toBeVisible();
  const secret = await manualKey(page, "setup-totp");
  const confirm = page.getByRole("button", { name: t("twoFactor.totp.confirm"), exact: true });
  await expect(confirm).toBeDisabled();
  await typeTotp(page, "setup-totp-code", secret);
  await confirm.click();

  // The first factor brings the recovery codes, shown this one time.
  const codesHeading = page.getByRole("heading", { name: t("setup.twoFactor.codesHeading") });
  await expect(codesHeading).toBeFocused();
  const codes = await page.locator("main ol li code").allInnerTexts();
  expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
  for (const code of codes) expect(code).toMatch(/^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){2}$/);
  await page.getByRole("button", { name: t("twoFactor.recovery.copyAll") }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(codes.join("\n"));
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: t("twoFactor.recovery.download") }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("hexmark-recovery-codes.txt");
  const file = await readFile((await download.path()) ?? "", "utf8");
  for (const code of codes) expect(file).toContain(`\n${code}\n`);
  expect(file).toContain(ADMIN.email);
  const done = page.getByRole("button", { name: t("setup.twoFactor.codesDone") });
  await expect(done).toBeDisabled();
  await page.getByRole("checkbox", { name: t("twoFactor.recovery.savedConfirm") }).check();
  await done.click();
  await expect(page.getByText(t("setup.twoFactor.app.enabled"), { exact: true })).toBeVisible();

  // Security key: named, then registered through the virtual authenticator.
  const register = page.getByRole("button", { name: t("twoFactor.key.register") });
  await expect(register).toBeDisabled();
  await page.getByLabel(t("twoFactor.key.nameLabel")).fill("Desk key");
  await register.click();
  await expect(page.getByText("1 key added", { exact: true })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Desk key" })).toBeVisible();
  expect(await authenticator.credentials()).toHaveLength(1);

  // System settings: the browser's zone is preselected; requiring a second
  // factor is possible now that the admin has one.
  await page.getByRole("button", { name: t("setup.twoFactor.continue") }).click();
  await expect(stepHeading(page, "en", "settings")).toBeVisible();
  const zone = page.getByLabel(t("setup.settings.timezone.label"));
  await expect(zone).toHaveValue("Europe/Berlin");
  await expect(zone.locator("optgroup").first()).toHaveAttribute(
    "label",
    t("setup.settings.timezone.regions.UTC"),
  );
  await zone.selectOption("America/New_York");
  const require = page.getByRole("switch", { name: t("setup.settings.require.label") });
  await expect(require).toBeEnabled();
  await require.check();
  await page.getByRole("button", { name: t("setup.settings.finish") }).click();

  await expect(page).toHaveURL(/\/setup\/complete$/);
  await expect(toasts(page).first()).toContainText(t("flash.setupSaved.title"));
  const [settings] = await stack.db.sql`
    select default_timezone, require_two_factor from instance_settings`;
  expect(settings).toEqual({ default_timezone: "America/New_York", require_two_factor: true });
  const [factors] = await stack.db.sql`
    select (select count(*)::int from totp_credentials where confirmed_at is not null) as totp,
           (select count(*)::int from webauthn_credentials) as keys,
           (select count(*)::int from recovery_codes where used_at is null) as codes,
           (select count(*)::int from auth_challenges where used_at is null
              and expires_at > now()) as open_tickets`;
  expect(factors).toEqual({ totp: 1, keys: 1, codes: RECOVERY_CODE_COUNT, open_tickets: 0 });
  // The ticket cookie is gone, and with it the wizard.
  expect((await page.goto(`${origin}/setup`))?.status()).toBe(404);
});

test("skipping step 5 asks first and keeps the requirement off", async ({ page, stack }) => {
  const origin = localOrigin(stack);
  await toTwoFactorStep(page, origin, stack.token);
  // Without PUBLIC_ORIGIN the server offers no security keys and says so.
  await expect(page.getByText(t("twoFactor.key.unavailable.server"))).toBeVisible();

  await page.getByRole("button", { name: t("setup.twoFactor.skip") }).click();
  const stay = page.getByRole("button", { name: t("setup.twoFactor.skipConfirm.stay") });
  await expect(stay).toBeFocused();
  await expect(page.locator("main [role=alert]")).toContainText(
    t("setup.twoFactor.skipConfirm.title"),
  );
  await page.getByRole("button", { name: t("setup.twoFactor.skipConfirm.skip") }).click();

  await expect(stepHeading(page, "en", "settings")).toBeVisible();
  const require = page.getByRole("switch", { name: t("setup.settings.require.label") });
  await expect(require).toBeDisabled();
  await expect(require).not.toBeChecked();
  await expect(page.getByText(t("setup.settings.require.needsFactor"))).toBeVisible();
  await page.getByRole("button", { name: t("setup.settings.require.backToStep") }).click();
  await expect(stepHeading(page, "en", "twoFactor")).toBeVisible();
  await page.getByRole("button", { name: t("setup.twoFactor.skip") }).click();
  await page.getByRole("button", { name: t("setup.twoFactor.skipConfirm.skip") }).click();
  await page.getByRole("button", { name: t("setup.settings.finish") }).click();

  await expect(page).toHaveURL(/\/setup\/complete$/);
  const [settings] = await stack.db.sql`
    select default_timezone, require_two_factor from instance_settings`;
  expect(settings).toEqual({ default_timezone: "Europe/Berlin", require_two_factor: false });
});

test("a setup ticket that ran out says how to go on", async ({ page, stack }) => {
  const origin = localOrigin(stack);
  await toTwoFactorStep(page, origin, stack.token);
  await stack.db.sql`
    update auth_challenges set created_at = now() - interval '20 minutes',
      expires_at = now() - interval '5 minutes'
    where purpose = 'setup_enrolment'`;

  await page.getByRole("button", { name: t("setup.twoFactor.app.start") }).click();
  await expect(page.getByText(t("setup.ticket.expired.title"))).toBeVisible();
  // A reload shows the same explanation instead of a dead end.
  await page.reload();
  await expect(page.getByText(t("setup.ticket.expired.title"))).toBeVisible();
  await page.getByRole("link", { name: t("setup.ticket.expired.continue") }).click();
  await expect(page).toHaveURL(/\/setup\/complete$/);
});

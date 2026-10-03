import { expect, test } from "./fixtures";
import { ADA, homeHeading, signInWith } from "./helpers/auth";
import { text } from "./helpers/messages";
import { topsOf } from "./helpers/positions";
import { localOrigin, seedTotpAccount, totpCode, typeTotp } from "./helpers/two-factor";
import { toasts } from "./helpers/wizard";

// Messages of the second-factor pages never move what is below them: a
// wrong recovery code only turns its groups red; a wrong password in the
// confirmation dialog takes the hint's reserved place; a wrong code while
// adding the authenticator app only marks the cells; and the security key
// controls, decided only after hydration, keep their room.

const t = (key: string, values?: Record<string, string | number>) => text("en", key, values);

test.use({ locale: "en-US" });

test("wrong answers and hydration move nothing", async ({ page, browser, stack }) => {
  const origin = localOrigin(stack);
  const { secret } = await seedTotpAccount(stack, ADA, { env: { PUBLIC_ORIGIN: origin } });
  await page.goto(origin);
  await signInWith(page, "en", ADA);

  // Recovery code: the groups turn red, the button and link stay put.
  await page.getByRole("button", { name: t("secondFactor.useRecovery") }).click();
  const recovery = ["main form button[type=submit]", "main form button:last-of-type"];
  const before = await topsOf(page, recovery);
  expect(Object.values(before)).not.toContain(null);
  await page.locator("#recovery-code-1").click();
  await page.keyboard.type("ABCD-EFGH-JKLM");
  await page.getByRole("button", { name: t("secondFactor.recovery.verify") }).click();
  await expect(page.locator("#recovery-code-2")).toHaveAttribute("aria-invalid", "true");
  expect(await topsOf(page, recovery)).toEqual(before);

  await page.getByRole("button", { name: t("secondFactor.recovery.back") }).click();
  await typeTotp(page, "second-factor-code", secret);
  await page.getByRole("button", { name: t("secondFactor.code.verify"), exact: true }).click();
  await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();

  // Security key controls: the same height before and after hydration
  // (JavaScript off shows what the server rendered).
  const below = ["#security-codes"];
  await page.goto(`${origin}/account/security`);
  await expect(page.getByRole("button", { name: t("accountSecurity.keys.add") })).toBeVisible();
  const hydrated = await topsOf(page, below);
  expect(hydrated["#security-codes"]).not.toBeNull();
  const cookies = await page.context().cookies();
  const serverOnly = await browser.newContext({ javaScriptEnabled: false, locale: "en-US" });
  await serverOnly.addCookies(cookies);
  const plain = await serverOnly.newPage();
  await plain.goto(`${origin}/account/security`);
  expect(await topsOf(plain, below)).toEqual(hydrated);
  await serverOnly.close();

  // Dialog: a wrong password replaces the hint; the buttons stay put.
  await page.getByRole("button", { name: t("accountSecurity.codes.regenerate") }).click();
  const dialog = page.getByRole("dialog");
  const buttons = ["dialog form > div:last-child"];
  const open = await topsOf(page, buttons);
  expect(open["dialog form > div:last-child"]).not.toBeNull();
  await dialog.getByLabel(t("accountSecurity.confirm.passwordLabel"), { exact: true }).fill("x");
  await dialog
    .getByRole("button", { name: t("accountSecurity.confirm.regenerate.action") })
    .click();
  await expect(dialog.getByText(t("accountSecurity.confirm.passwordWrong"))).toBeVisible();
  expect(await topsOf(page, buttons)).toEqual(open);
  await page.keyboard.press("Escape");

  // Adding the app with a wrong code: red cells, a toast, nothing moves.
  await stack.db.sql`delete from totp_credentials`;
  await page.reload();
  await page.getByRole("button", { name: t("accountSecurity.app.setUp") }).click();
  const setup = ["form:has(#account-totp-code) > div:last-child", "#security-keys"];
  await expect(page.locator("#account-totp-key")).not.toHaveText(/X{4}/);
  const ready = await topsOf(page, setup);
  expect(Object.values(ready)).not.toContain(null);
  await page.locator("#account-totp-code-1").click();
  await page.keyboard.type(totpCode("JBSWY3DPEHPK3PXP", 3));
  await page.getByRole("button", { name: t("twoFactor.totp.confirm"), exact: true }).click();
  await expect(toasts(page).first()).toContainText(t("twoFactor.errors.invalid_code.title"));
  await expect(page.locator("#account-totp-code-1")).toHaveAttribute("aria-invalid", "true");
  expect(await topsOf(page, setup)).toEqual(ready);
});

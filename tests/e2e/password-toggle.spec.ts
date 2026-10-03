import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openSignIn, passwordField, prepareSignIn } from "./helpers/auth";
import { text, type UiLocale } from "./helpers/messages";
import { accountField, toAccountStep } from "./helpers/wizard";

// The eye button inside a password field: one name ("Show password"), the
// state in aria-pressed, the value kept while it switches. Same component
// on the sign-in page and in the setup account step.

function toggleFor(page: Page, locale: UiLocale, subject: string) {
  return page.getByRole("button", { name: text(locale, "field.reveal", { subject }), exact: true });
}

async function expectToggles(field: Locator, toggle: Locator) {
  await field.fill("secret value");
  await expect(field).toHaveAttribute("type", "password");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await toggle.click();
  await expect(field).toHaveAttribute("type", "text");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(field).toHaveValue("secret value");

  await toggle.click();
  await expect(field).toHaveAttribute("type", "password");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
}

test("sign-in: the password toggle", async ({ page, stack }) => {
  await prepareSignIn(stack);
  await openSignIn(page, "en");
  const subject = text("en", "auth.fields.password.toggleSubject");
  await expectToggles(passwordField(page, "en"), toggleFor(page, "en", subject));
});

test.describe("German", () => {
  test.use({ locale: "de-DE" });

  test("setup account step: both password toggles", async ({ page, stack }) => {
    await toAccountStep(page, "de", stack.token);
    for (const name of ["password", "passwordConfirm"]) {
      const subject = text("de", `setup.account.fields.${name}.toggleSubject`);
      await expectToggles(accountField(page, "de", name), toggleFor(page, "de", subject));
    }
  });
});

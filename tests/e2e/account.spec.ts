import { expect, test } from "./fixtures";
import { text, type UiLocale } from "./helpers/messages";
import { accountField, createButton, fillAccount, toAccountStep } from "./helpers/wizard";

// The account step: the button stays disabled until every field is valid,
// a field shows its error only once it was left, and a valid form creates
// the admin.

for (const locale of ["en", "de"] as const satisfies UiLocale[]) {
  test.describe(`account step (${locale})`, () => {
    test.use({ locale: locale === "de" ? "de-DE" : "en-US" });

    test("validates on blur and enables the button once everything is valid", async ({
      page,
      stack,
    }) => {
      await toAccountStep(page, locale, stack.token);
      const create = createButton(page, locale);
      await expect(create).toBeDisabled();

      // No error while typing the first characters ...
      const username = accountField(page, locale, "username");
      await username.fill("a");
      await expect(username).not.toHaveAttribute("aria-invalid", "true");
      await expect(page.getByText(text(locale, "errors.too_short", { min: 3 }))).toHaveCount(0);
      // ... but once the field is left.
      await username.blur();
      await expect(username).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByText(text(locale, "errors.too_short", { min: 3 }))).toBeVisible();

      // A mismatching confirmation is reported on the confirmation field.
      await accountField(page, locale, "password").fill("correct horse battery");
      const confirm = accountField(page, locale, "passwordConfirm");
      await confirm.fill("correct horse batterz");
      await confirm.blur();
      await expect(
        page.getByText(text(locale, "errors.fields.passwordConfirm.mismatch")),
      ).toBeVisible();
      await expect(create).toBeDisabled();

      await fillAccount(page, locale);
      await expect(
        page.getByText(text(locale, "errors.fields.passwordConfirm.mismatch")),
      ).toHaveCount(0);
      await expect(username).not.toHaveAttribute("aria-invalid", "true");
      await expect(create).toBeEnabled();
      await create.click();
      await expect(page).toHaveURL(/\/setup\/complete$/);
      expect(await stack.db.sql`select count(*)::int as n from users`).toEqual([{ n: 1 }]);
    });
  });
}

test("lists the fields that still block the button", async ({ page, stack }) => {
  await toAccountStep(page, "en", stack.token);
  const note = page.getByText(/^Complete all fields to create the account\./);
  await expect(note).toContainText(
    "Display name, Username, E-mail address, Password, and Confirm password",
  );
  await fillAccount(page, "en");
  await expect(note).toHaveCount(0);
});

test("an invalid e-mail address is explained after leaving the field", async ({ page, stack }) => {
  await toAccountStep(page, "en", stack.token);
  const email = accountField(page, "en", "email");
  await email.fill("ada@");
  await expect(page.getByText(text("en", "errors.invalid_email"))).toHaveCount(0);
  await email.press("Tab");
  await expect(page.getByText(text("en", "errors.invalid_email"))).toBeVisible();
  await email.fill("ada@example.com");
  await expect(page.getByText(text("en", "errors.invalid_email"))).toHaveCount(0);
});

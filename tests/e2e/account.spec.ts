import { expect, test } from "./fixtures";
import { text, type UiLocale } from "./helpers/messages";
import { acceptTakenValues, rejectTakenValues, TAKEN_EMAIL } from "./helpers/taken";
import {
  ADMIN,
  accountField,
  createButton,
  fillAccount,
  stepHeading,
  toAccountStep,
} from "./helpers/wizard";

// The account step: every field shows its rules as a checklist that follows
// the typing, nothing turns red while typing or on leaving a field, the
// button stays disabled until every rule is met, and only a refusal of the
// server (a taken e-mail address) shows an error at a field.

for (const locale of ["en", "de"] as const satisfies UiLocale[]) {
  test.describe(`account step (${locale})`, () => {
    test.use({ locale: locale === "de" ? "de-DE" : "en-US" });

    test("checklists follow the typing; the button waits for every rule", async ({
      page,
      stack,
    }) => {
      await toAccountStep(page, locale, stack.token);
      const create = createButton(page, locale);
      await expect(create).toBeDisabled();

      const username = accountField(page, locale, "username");
      const lengthRule = page.getByRole("listitem").filter({
        hasText: text(locale, "setup.account.rules.usernameLength", { min: 3, max: 32 }),
      });
      const charsRule = page.getByRole("listitem").filter({
        hasText: text(locale, "setup.account.rules.usernameChars"),
      });
      // Read with the field: its rules, nothing else.
      await expect(username).toHaveAccessibleDescription(
        `${text(locale, "setup.account.rules.usernameLength", { min: 3, max: 32 })} ${text(locale, "setup.account.rules.usernameChars")}`,
      );

      await username.fill("a");
      await username.blur();
      // Leaving the field shows no error.
      await expect(username).not.toHaveAttribute("aria-invalid", "true");
      await expect(page.getByText(text(locale, "errors.too_short", { min: 3 }))).toHaveCount(0);
      await expect(lengthRule).not.toHaveAttribute("data-met");
      await expect(charsRule).toHaveAttribute("data-met");
      await expect(charsRule).toContainText(text(locale, "setup.account.rules.met"));

      await username.fill("_ada");
      await expect(lengthRule).toHaveAttribute("data-met");
      await expect(charsRule).not.toHaveAttribute("data-met");
      await expect(lengthRule).toContainText(text(locale, "setup.account.rules.met"));
      await expect(charsRule).not.toContainText(text(locale, "setup.account.rules.met"));

      // A mismatching confirmation leaves its rule open, without an error.
      await accountField(page, locale, "password").fill(ADMIN.password);
      const confirm = accountField(page, locale, "passwordConfirm");
      await confirm.fill("correct horse batterz");
      await confirm.blur();
      const matchRule = page.getByRole("listitem").filter({
        hasText: text(locale, "setup.account.rules.passwordMatch"),
      });
      await expect(matchRule).not.toHaveAttribute("data-met");
      await expect(confirm).not.toHaveAttribute("aria-invalid", "true");
      await expect(create).toBeDisabled();

      await fillAccount(page, locale);
      await expect(page.locator("li[data-met]")).toHaveCount(6);
      await expect(page.locator("[aria-invalid=true]")).toHaveCount(0);
      await expect(create).toBeEnabled();
      await create.click();
      await expect(stepHeading(page, locale, "twoFactor")).toBeVisible();
      expect(await stack.db.sql`select count(*)::int as n from users`).toEqual([{ n: 1 }]);
    });
  });
}

test("the summary lists the fields that still block the button", async ({ page, stack }) => {
  await toAccountStep(page, "en", stack.token);
  const note = page.locator("#account-submit-hint");
  await expect(note).toHaveAttribute("aria-live", "polite");
  await expect(note).toContainText(
    "Display name, Username, E-mail address, Password, and Confirm password",
  );
  await expect(createButton(page, "en")).toHaveAccessibleDescription(/^Complete all fields/);
  await fillAccount(page, "en");
  await expect(note).toHaveText(text("en", "setup.account.ready"));
  await expect(createButton(page, "en")).toHaveAccessibleDescription("");
});

test("an e-mail address the server refuses as taken is shown in red at the field", async ({
  page,
  stack,
}) => {
  await toAccountStep(page, "en", stack.token);
  await rejectTakenValues(stack.db);
  try {
    await fillAccount(page, "en", { ...ADMIN, email: TAKEN_EMAIL });
    await createButton(page, "en").click();
    const email = accountField(page, "en", "email");
    const message = text("en", "errors.fields.email.taken");
    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute("aria-invalid", "true");
    // The error takes the checklist's place, also for screen readers.
    await expect(email).toHaveAccessibleDescription(message);
    await expect(page.getByText(message)).toBeVisible();
    await expect(page).toHaveURL(/\/setup$/);

    // Editing the field brings the checklist back.
    await email.fill(ADMIN.email);
    await expect(email).not.toHaveAttribute("aria-invalid", "true");
    await expect(email).toHaveAccessibleDescription(
      `${text("en", "setup.account.rules.emailValid")} ${text("en", "setup.account.rules.met")}`,
    );
  } finally {
    await acceptTakenValues(stack.db);
  }
});

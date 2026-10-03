import { expect, test } from "./fixtures";
import { ADA, emailField, openSignIn, passwordField, prepareSignIn } from "./helpers/auth";
import { text, type UiLocale } from "./helpers/messages";
import { topsOf } from "./helpers/positions";
import { acceptTakenValues, rejectTakenValues, TAKEN_USERNAME } from "./helpers/taken";
import { ADMIN, accountField, createButton, toAccountStep } from "./helpers/wizard";

// Field messages never move the layout (UI guidelines): whatever a field's
// slot shows (rules, met rules, a server error), the fields below it and the
// buttons stay where they were. Measured in a desktop window and at 320 px,
// in English and German.

const ACCOUNT_TARGETS = [
  "#account-displayName",
  "#account-username",
  "#account-email",
  "#account-password",
  "#account-passwordConfirm",
  "main form button[type=submit]",
] as const;

const SIGN_IN_TARGETS = [
  "#sign-in-email",
  "#sign-in-password",
  "main form input[name=remember]",
  "main form button[type=submit]",
] as const;

const VIEWPORTS = [
  { name: "desktop", size: { width: 1440, height: 900 } },
  { name: "320 px", size: { width: 320, height: 640 } },
] as const;

for (const locale of ["en", "de"] as const satisfies UiLocale[]) {
  for (const { name, size } of VIEWPORTS) {
    test.describe(`${name} (${locale})`, () => {
      test.use({ viewport: size, locale: locale === "de" ? "de-DE" : "en-US" });

      test("account step: nothing moves while rules change or the server refuses", async ({
        page,
        stack,
      }) => {
        await toAccountStep(page, locale, stack.token);
        const before = await topsOf(page, ACCOUNT_TARGETS);
        const moved: string[] = [];
        async function check(state: string) {
          const now = await topsOf(page, ACCOUNT_TARGETS);
          if (JSON.stringify(now) !== JSON.stringify(before)) {
            moved.push(`${state}: ${JSON.stringify(now)}`);
          }
        }

        for (const [field, invalid, valid] of [
          ["displayName", " ", ADMIN.displayName],
          ["username", "_a", TAKEN_USERNAME],
          ["email", "ada@", ADMIN.email],
          ["password", "short", ADMIN.password],
          ["passwordConfirm", "other", ADMIN.password],
        ] as const) {
          const input = accountField(page, locale, field);
          await input.fill(invalid);
          await input.blur();
          await check(`${field} invalid`);
          await input.fill(valid);
          await input.blur();
          await check(`${field} valid`);
        }

        await rejectTakenValues(stack.db);
        try {
          await createButton(page, locale).click();
          await expect(page.getByText(text(locale, "errors.fields.username.taken"))).toBeVisible();
          await check("username taken");
          await accountField(page, locale, "username").fill(ADMIN.username);
          await check("username edited after the refusal");
        } finally {
          await acceptTakenValues(stack.db);
        }
        expect(moved).toEqual([]);
      });

      test("sign-in: nothing moves on invalid or valid input", async ({ page, stack }) => {
        await prepareSignIn(stack);
        await openSignIn(page, locale);
        const before = await topsOf(page, SIGN_IN_TARGETS);
        const email = emailField(page, locale);
        const password = passwordField(page, locale);

        await email.fill("ada@");
        await email.blur();
        await password.focus();
        await password.blur();
        // No error at either field.
        await expect(page.locator("[aria-invalid=true]")).toHaveCount(0);
        expect(await topsOf(page, SIGN_IN_TARGETS)).toEqual(before);

        await email.fill(ADA.email);
        await password.fill(ADA.password);
        await password.blur();
        expect(await topsOf(page, SIGN_IN_TARGETS)).toEqual(before);
      });
    });
  }
}

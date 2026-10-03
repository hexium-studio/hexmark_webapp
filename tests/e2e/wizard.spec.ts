import { expect, test } from "./fixtures";
import { text, type UiLocale } from "./helpers/messages";
import {
  ADMIN,
  continueStep,
  createButton,
  fillAccount,
  finishWithoutSecondFactor,
  openSetup,
  stepHeading,
  toAccountStep,
  toasts,
  typeToken,
  verifyButton,
} from "./helpers/wizard";

// The whole wizard, from the language step to /setup/complete, in English
// and German, and what is true once setup is done. Steps 5 and 6 with a
// second factor are in two-factor-setup.spec.ts; here they are skipped.

for (const locale of ["en", "de"] as const satisfies UiLocale[]) {
  test.describe(`happy path (${locale})`, () => {
    test.use({ locale: locale === "de" ? "de-DE" : "en-US" });

    test("creates the first admin and lands on /setup/complete", async ({ page, stack }) => {
      await toAccountStep(page, locale, stack.token.toLowerCase());
      await fillAccount(page, locale);
      await createButton(page, locale).click();
      const created = toasts(page).first();
      await expect(created).toHaveAttribute("data-type", "success");
      await expect(created).toContainText(text(locale, "setup.account.created.title"));
      await finishWithoutSecondFactor(page, locale);

      const toast = toasts(page).first();
      await expect(toast).toBeVisible();
      await expect(toast).toHaveAttribute("data-type", "success");
      await expect(toast).toContainText(text(locale, "flash.setupSaved.title"));
      await expect(
        page.getByRole("heading", { level: 2, name: text(locale, "setupComplete.heading") }),
      ).toBeVisible();

      const users = await stack.db.sql`select username, email, locale, role from users`;
      expect(users).toEqual([
        { username: ADMIN.username, email: ADMIN.email, locale, role: "admin" },
      ]);
      const settings = await stack.db.sql`select default_locale from instance_settings`;
      expect(settings).toEqual([{ default_locale: locale }]);
    });
  });
}

test.describe("after setup", () => {
  test("/setup answers 404; visitors get their browser language, else the instance one", async ({
    page,
    browser,
    stack,
  }) => {
    // Start in English and switch to German: the language the wizard is
    // shown in becomes the instance default.
    await openSetup(page, "en");
    await page.getByRole("radio", { name: "Deutsch" }).check();
    await expect(stepHeading(page, "de", "language")).toBeVisible();
    await continueStep(page, "de", "connection");
    await continueStep(page, "de", "token");
    await typeToken(page, "de", stack.token);
    await verifyButton(page, "de").click();
    await fillAccount(page, "de");
    await createButton(page, "de").click();
    await finishWithoutSecondFactor(page, "de");

    const response = await page.goto("/setup");
    expect(response?.status()).toBe(404);

    // Visitors without a language cookie: a browser language the instance
    // offers wins over the instance default, any other gets the default.
    for (const [browserLocale, expected] of [
      ["en-US", "en"],
      ["fr-FR", "de"],
    ] as const) {
      const visitor = await browser.newContext({ locale: browserLocale });
      const other = await visitor.newPage();
      await other.goto(`${stack.webUrl}/setup/complete`);
      await expect(other.locator("html")).toHaveAttribute("lang", expected);
      await visitor.close();
    }
  });
});

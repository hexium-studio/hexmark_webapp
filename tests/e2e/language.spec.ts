import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { text } from "./helpers/messages";
import { continueStep, openSetup, stepHeading } from "./helpers/wizard";

// The language step: order of the languages for the browser's language,
// and switching the page language at once.

// Radio rows as "name [hints]" in document order, "—" for a block separator.
function rows(page: Page) {
  return page.evaluate(() => {
    const box = document.querySelector("main section form fieldset > div");
    return [...(box?.children ?? [])].map((element) => {
      const input = element.querySelector("input");
      if (!input) return "—";
      const name = document.getElementById(input.getAttribute("aria-labelledby") ?? "");
      const hints = input.getAttribute("aria-describedby");
      const hint = hints ? ` [${document.getElementById(hints)?.textContent}]` : "";
      return `${name?.textContent}${hint}`;
    });
  });
}

const cases = [
  ["de-DE", "de", ["Deutsch [Browsersprache]", "—", "English"]],
  ["en-US", "en", ["English [Browser language]", "—", "Deutsch"]],
  ["fr-FR", "en", ["Deutsch", "English"]],
] as const;

for (const [browserLocale, pageLocale, expected] of cases) {
  test.describe(`browser language ${browserLocale}`, () => {
    test.use({ locale: browserLocale });

    test(`shows the page in ${pageLocale} and orders the languages`, async ({ page }) => {
      await openSetup(page, pageLocale);
      await expect(page.locator("html")).toHaveAttribute("lang", pageLocale);
      expect(await rows(page)).toEqual(expected);
      // The language the page is shown in is preselected.
      const selected = pageLocale === "de" ? "Deutsch" : "English";
      await expect(page.getByRole("radio", { name: selected })).toBeChecked();
    });
  });
}

test.describe("switching", () => {
  test.use({ locale: "de-DE" });

  test("picking a language switches the page at once and stays on step 1", async ({ page }) => {
    await openSetup(page, "de");
    await page.getByRole("radio", { name: "English" }).check();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(stepHeading(page, "en", "language")).toBeVisible();
    await expect(
      page.getByText(text("en", "setup.stepCounter", { current: 1, total: 4 })),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "Language changed to English." }),
    ).toBeAttached();
    // The order follows the browser, not the UI language.
    expect(await rows(page)).toEqual(["Deutsch [Browser language]", "—", "English"]);
    await expect(page.getByRole("radio", { name: "English" })).toBeChecked();

    // The arrow keys move through the group and switch as well.
    await page.getByRole("radio", { name: "English" }).focus();
    await page.keyboard.press("ArrowUp");
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.getByRole("radio", { name: "Deutsch" })).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await continueStep(page, "en", "connection");

    // The choice is stored in a cookie and survives a reload.
    await page.reload();
    await expect(stepHeading(page, "en", "language")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

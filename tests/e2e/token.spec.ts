import { expect, test } from "./fixtures";
import { text, type UiLocale } from "./helpers/messages";
import {
  toasts,
  tokenCell,
  tokenCells,
  toTokenStep,
  typeToken,
  verifyButton,
  WRONG_TOKEN,
} from "./helpers/wizard";

// The token step: 8 cells, typing, pasting, masking, the Verify button and
// a wrong token.

const values = (cells: ReturnType<typeof tokenCells>) =>
  cells.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));

const glyphs = (page: import("@playwright/test").Page) =>
  page.locator("#setup-token [aria-hidden='true']").filter({ hasText: "*" });

test("typing fills the cells one by one, masked, and enables Verify when complete", async ({
  page,
}) => {
  await toTokenStep(page, "en");
  const cells = tokenCells(page, "en");
  await expect(cells).toHaveCount(8);
  await expect(verifyButton(page, "en")).toBeDisabled();

  await typeToken(page, "en", "ab3");
  await expect(tokenCell(page, "en", 4)).toBeFocused();
  // Masked: the inputs hold nothing, an asterisk is drawn per character.
  expect(await values(cells)).toEqual(["", "", "", "", "", "", "", ""]);
  await expect(glyphs(page)).toHaveCount(3);
  await expect(
    page.getByText(text("en", "setup.token.progress", { length: 8, entered: 3 })),
  ).toBeVisible();

  await page.keyboard.type("d567");
  await expect(verifyButton(page, "en")).toBeDisabled();
  await page.keyboard.type("8");
  await expect(verifyButton(page, "en")).toBeEnabled();

  await page.getByRole("button", { name: /^Show/ }).click();
  expect(await values(cells)).toEqual(["A", "B", "3", "D", "5", "6", "7", "8"]);
  await expect(glyphs(page)).toHaveCount(0);
  await page.getByRole("button", { name: /^Hide/ }).click();
  await expect(glyphs(page)).toHaveCount(8);
});

test("Backspace and the arrow keys move between cells", async ({ page }) => {
  await toTokenStep(page, "en");
  await typeToken(page, "en", "abcd");
  await page.getByRole("button", { name: /^Show/ }).click();
  await tokenCell(page, "en", 5).focus();
  await page.keyboard.press("Backspace");
  await expect(tokenCell(page, "en", 4)).toBeFocused();
  expect(await values(tokenCells(page, "en"))).toEqual(["A", "B", "C", "", "", "", "", ""]);
  await page.keyboard.press("Home");
  await expect(tokenCell(page, "en", 1)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(tokenCell(page, "en", 2)).toBeFocused();
  await page.keyboard.press("End");
  await expect(tokenCell(page, "en", 8)).toBeFocused();
});

test("pasting normalises the token and fills all cells", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await toTokenStep(page, "en");
  await page.getByRole("button", { name: /^Show/ }).click();
  await page.evaluate(() => navigator.clipboard.writeText(" test-2345 "));
  // A complete token replaces everything, wherever it is pasted.
  await tokenCell(page, "en", 3).click();
  await page.keyboard.press("ControlOrMeta+V");
  expect(await values(tokenCells(page, "en"))).toEqual(["T", "E", "S", "T", "2", "3", "4", "5"]);
  await expect(tokenCell(page, "en", 8)).toBeFocused();
  await expect(verifyButton(page, "en")).toBeEnabled();

  // A partial paste fills from the cell on.
  await page.evaluate(() => navigator.clipboard.writeText("x y"));
  await tokenCell(page, "en", 2).click();
  await page.keyboard.press("ControlOrMeta+V");
  expect(await values(tokenCells(page, "en"))).toEqual(["T", "X", "Y", "T", "2", "3", "4", "5"]);
});

for (const locale of ["en", "de"] as const satisfies UiLocale[]) {
  test.describe(`wrong token (${locale})`, () => {
    test.use({ locale: locale === "de" ? "de-DE" : "en-US" });

    test("shows an error toast and marks the cells until the next edit", async ({ page }) => {
      await toTokenStep(page, locale);
      await typeToken(page, locale, WRONG_TOKEN);
      await verifyButton(page, locale).click();

      const toast = toasts(page).first();
      await expect(toast).toBeVisible();
      await expect(toast).toHaveAttribute("data-type", "error");
      await expect(toast).toContainText(text(locale, "setup.errors.wrong_token.title"));
      const cells = tokenCells(page, locale);
      for (const cell of await cells.all())
        await expect(cell).toHaveAttribute("aria-invalid", "true");
      await expect(tokenCell(page, locale, 1)).toBeFocused();

      // The frames turn red (the danger colour of the theme).
      const colours = await page.evaluate(() => {
        const group = document.querySelector("#setup-token [data-invalid] > div");
        const danger = getComputedStyle(document.documentElement).getPropertyValue(
          "--color-danger",
        );
        const probe = document.createElement("span");
        probe.style.color = danger;
        document.body.append(probe);
        const expected = getComputedStyle(probe).color;
        probe.remove();
        return { border: group ? getComputedStyle(group).borderTopColor : "", expected };
      });
      expect(colours.border).toBe(colours.expected);

      await page.keyboard.press("Backspace");
      for (const cell of await cells.all()) await expect(cell).not.toHaveAttribute("aria-invalid");
      await expect(page.locator("#setup-token [data-invalid]")).toHaveCount(0);
    });
  });
}

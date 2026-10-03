import { expect, test } from "./fixtures";
import type { UiLocale } from "./helpers/messages";
import { eachFlowState, settle } from "./helpers/states";

// At 320 CSS pixels (WCAG 1.4.10 reflow) no state of the setup flow scrolls
// sideways, in English and in the longer German texts.

for (const locale of ["en", "de"] as const satisfies UiLocale[]) {
  test.describe(`320 px (${locale})`, () => {
    test.use({
      viewport: { width: 320, height: 640 },
      locale: locale === "de" ? "de-DE" : "en-US",
    });

    test("no horizontal overflow in any step", async ({ page, stack }) => {
      const overflowing: string[] = [];
      await eachFlowState(page, locale, stack.token, async (state) => {
        await settle(page);
        const width = await page.evaluate(() => ({
          page: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          viewport: window.innerWidth,
        }));
        if (Math.max(width.page, width.body) > width.viewport) {
          overflowing.push(`${state}: ${JSON.stringify(width)}`);
        }
      });
      expect(overflowing).toEqual([]);
    });
  });
}

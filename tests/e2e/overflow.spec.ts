import { expect, test } from "./fixtures";
import type { UiLocale } from "./helpers/messages";
import { eachFlowState, settle } from "./helpers/states";

// No state of the setup flow scrolls sideways, in English and in the longer
// German texts: at 320 CSS pixels (WCAG 1.4.10 reflow) and with the text
// alone enlarged to 200 % (WCAG 1.4.4) in a desktop window.

const CASES = [
  { name: "320 px", viewport: { width: 320, height: 640 }, textScale: false },
  { name: "200 % text", viewport: { width: 1280, height: 800 }, textScale: true },
] as const;

for (const locale of ["en", "de"] as const satisfies UiLocale[]) {
  for (const { name, viewport, textScale } of CASES) {
    test.describe(`${name} (${locale})`, () => {
      test.use({ viewport, locale: locale === "de" ? "de-DE" : "en-US" });

      test("no horizontal overflow in any step", async ({ page, stack }) => {
        if (textScale) {
          // Text size only: every rem inside the page doubles, the window
          // stays the same (as in auth-overflow.spec.ts).
          await page.addInitScript(() => {
            document.addEventListener("DOMContentLoaded", () => {
              document.documentElement.style.fontSize = "200%";
            });
          });
        }
        const overflowing: string[] = [];
        await eachFlowState(page, locale, stack, async (state) => {
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
}

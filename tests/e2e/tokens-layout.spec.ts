import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import type { UiLocale } from "./helpers/messages";
import { settle } from "./helpers/states";
import { eachTokenState } from "./helpers/token-states";

// The token page in every state (helpers/token-states.ts): no horizontal
// scrolling at 320 px, and no axe violations in light and dark, in English
// and German. Layers: tokens-layers.spec.ts.

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const browserLocale = (locale: UiLocale) => (locale === "de" ? "de-DE" : "en-US");

for (const locale of ["en", "de"] as const satisfies UiLocale[]) {
  test.describe(`overflow, 320 px (${locale})`, () => {
    test.use({ viewport: { width: 320, height: 640 }, locale: browserLocale(locale) });

    test("no horizontal overflow in any token page state", async ({ page, stack }) => {
      const overflowing: string[] = [];
      await eachTokenState(page, stack, locale, async (state) => {
        await settle(page);
        const width = await page.evaluate(() => ({
          page: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          viewport: window.innerWidth,
          dialog: (() => {
            const dialog = document.querySelector("dialog");
            return dialog ? dialog.scrollWidth - dialog.clientWidth : 0;
          })(),
        }));
        if (Math.max(width.page, width.body) > width.viewport || width.dialog > 0) {
          overflowing.push(`${state}: ${JSON.stringify(width)}`);
        }
      });
      expect(overflowing).toEqual([]);
    });
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`axe, ${colorScheme} (${locale})`, () => {
      test.use({ colorScheme, locale: browserLocale(locale) });

      test("no axe violations in any token page state", async ({ page, stack }) => {
        const found: string[] = [];
        await eachTokenState(page, stack, locale, async (state) => {
          await settle(page);
          const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
          for (const violation of result.violations) {
            const targets = violation.nodes.map((node) => node.target.join(" ")).join(", ");
            found.push(`${state}: ${violation.id} (${targets})`);
          }
        });
        expect(found).toEqual([]);
      });
    });
  }
}

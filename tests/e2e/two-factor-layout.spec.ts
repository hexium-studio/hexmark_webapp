import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import type { UiLocale } from "./helpers/messages";
import { settle } from "./helpers/states";
import { eachTwoFactorState } from "./helpers/two-factor-states";

// The second-factor pages (sign-in steps, account security page and its
// dialog, forced enrolment) in every state: no horizontal scrolling at
// 320 px and with 200 % text, and no axe violations in light and dark, in
// English and German. Layers: two-factor-layers.spec.ts.

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const browserLocale = (locale: UiLocale) => (locale === "de" ? "de-DE" : "en-US");

const SIZES = [
  { name: "320 px", viewport: { width: 320, height: 640 }, textScale: false },
  { name: "200 % text", viewport: { width: 1280, height: 800 }, textScale: true },
] as const;

for (const locale of ["en", "de"] as const satisfies UiLocale[]) {
  for (const { name, viewport, textScale } of SIZES) {
    test.describe(`overflow, ${name} (${locale})`, () => {
      test.use({ viewport, locale: browserLocale(locale) });

      test("no horizontal overflow in any second-factor state", async ({ page, stack }) => {
        if (textScale) {
          await page.addInitScript(() => {
            document.addEventListener("DOMContentLoaded", () => {
              document.documentElement.style.fontSize = "200%";
            });
          });
        }
        const overflowing: string[] = [];
        await eachTwoFactorState(page, stack, locale, async (state) => {
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
  }

  for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`axe, ${colorScheme} (${locale})`, () => {
      test.use({ colorScheme, locale: browserLocale(locale) });

      test("no axe violations in any second-factor state", async ({ page, stack }) => {
        const found: string[] = [];
        await eachTwoFactorState(page, stack, locale, async (state) => {
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

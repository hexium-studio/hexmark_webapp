import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { eachAuthState } from "./helpers/auth-states";
import { settle } from "./helpers/states";

// axe-core finds no WCAG 2.1 A/AA violations in any state of sign-in, home
// and the blocked page, light and dark, English and German.

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

for (const colorScheme of ["light", "dark"] as const) {
  for (const locale of ["en", "de"] as const) {
    test.describe(`${colorScheme} theme, ${locale}`, () => {
      test.use({ colorScheme, locale: locale === "de" ? "de-DE" : "en-US" });

      test("no axe violations in any sign-in state", async ({ page, stack }) => {
        const found: string[] = [];
        await eachAuthState(page, stack, locale, async (state) => {
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

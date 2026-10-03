import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { eachFlowState, settle } from "./helpers/states";

// axe-core finds no WCAG 2.1 A/AA violations in any state of the setup
// flow, in the light and the dark theme.

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("no axe violations in any step", async ({ page, stack }) => {
      const found: string[] = [];
      await eachFlowState(page, "en", stack.token, async (state) => {
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

test.describe("German texts", () => {
  test.use({ locale: "de-DE", colorScheme: "dark" });

  test("no axe violations in any step", async ({ page, stack }) => {
    const found: string[] = [];
    await eachFlowState(page, "de", stack.token, async (state) => {
      await settle(page);
      const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      found.push(...result.violations.map((violation) => `${state}: ${violation.id}`));
    });
    expect(found).toEqual([]);
  });
});

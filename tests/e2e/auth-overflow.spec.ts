import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { eachAuthState } from "./helpers/auth-states";
import type { UiLocale } from "./helpers/messages";
import { settle } from "./helpers/states";

// No state of sign-in, home or the blocked page scrolls sideways, in English
// and in the longer German texts: at 320 CSS pixels (WCAG 1.4.10 reflow) and
// with the text alone enlarged to 200 % (WCAG 1.4.4) in a desktop window.

async function overflowIn(page: Page): Promise<string | undefined> {
  const width = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    viewport: window.innerWidth,
  }));
  return Math.max(width.page, width.body) > width.viewport ? JSON.stringify(width) : undefined;
}

const CASES = [
  { name: "320 px", viewport: { width: 320, height: 640 }, textScale: false },
  { name: "200 % text", viewport: { width: 1280, height: 800 }, textScale: true },
] as const;

for (const locale of ["en", "de"] as const satisfies UiLocale[]) {
  for (const { name, viewport, textScale } of CASES) {
    test.describe(`${name} (${locale})`, () => {
      test.use({ viewport, locale: locale === "de" ? "de-DE" : "en-US" });

      test("no horizontal overflow in any sign-in state", async ({ page, stack }) => {
        if (textScale) {
          // Text size only: every rem inside the page doubles, the window
          // stays the same. Media queries keep the default rem here, so the
          // card tier stays while its content doubles (the harder case).
          await page.addInitScript(() => {
            document.addEventListener("DOMContentLoaded", () => {
              document.documentElement.style.fontSize = "200%";
            });
          });
        }
        const overflowing: string[] = [];
        await eachAuthState(page, stack, locale, async (state) => {
          await settle(page);
          const found = await overflowIn(page);
          if (found) overflowing.push(`${state}: ${found}`);
        });
        expect(overflowing).toEqual([]);
      });
    });
  }
}

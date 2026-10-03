import { RECOVERY_CODE_COUNT } from "@hexmark/shared";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { ADA, homeHeading, openSignIn, prepareSignIn, signInWith } from "./helpers/auth";
import { text } from "./helpers/messages";
import { manualKey, setRequireTwoFactor, typeTotp } from "./helpers/two-factor";

// The document keeps a title while server actions render the page again in
// place (sign-in steps, forced enrolment holding the session, home). Every
// change to the document is watched; a moment without a non-empty <title>
// is recorded. Streamed metadata used to leave such a gap of a few hundred
// milliseconds after an action that writes a cookie (apps/web/next.config.ts).

const t = (key: string) => text("en", key);

test.use({ locale: "en-US" });

declare global {
  interface Window {
    __untitled?: string[];
  }
}

function watchTitle(page: Page) {
  return page.addInitScript(() => {
    const untitled: string[] = [];
    window.__untitled = untitled;
    const check = () => {
      if (document.readyState === "loading") return;
      if (!document.querySelector("title") || document.title.trim() === "") {
        untitled.push(`${Math.round(performance.now())} ms: "${document.title}"`);
      }
    };
    new MutationObserver(check).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
}

const untitled = (page: Page) => page.evaluate(() => window.__untitled ?? []);

test("the page title stays through forced enrolment and sign-in", async ({ page, stack }) => {
  await watchTitle(page);
  await prepareSignIn(stack);
  await setRequireTwoFactor(stack, true);
  await openSignIn(page, "en");
  await expect(page).toHaveTitle(t("auth.metaTitle"));
  await signInWith(page, "en", ADA);
  const secret = await manualKey(page, "enrol-totp");
  await typeTotp(page, "enrol-totp-code", secret);
  await page.getByRole("button", { name: t("twoFactor.totp.confirm"), exact: true }).click();
  await expect(page.locator("main ol li")).toHaveCount(RECOVERY_CODE_COUNT);
  // The action held the session in a cookie, so the page was rendered
  // again; give a late metadata answer time to show up as a gap.
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveTitle(t("auth.metaTitle"));
  expect(await untitled(page)).toEqual([]);

  await page.getByRole("checkbox", { name: t("twoFactor.recovery.savedConfirm") }).check();
  await page.getByRole("button", { name: t("secondFactor.enrolment.finish") }).click();
  await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();
  await expect(page).toHaveTitle(t("home.metaTitle"));
  await page.waitForLoadState("networkidle");
  expect(await untitled(page)).toEqual([]);
});

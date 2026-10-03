import { expect, test } from "./fixtures";
import { text } from "./helpers/messages";
import { toasts, toTokenStep, typeToken, verifyButton, WRONG_TOKEN } from "./helpers/wizard";

// Toast timing: an error toast stays about 10 s and its time stops while
// the pointer rests on it. The only tests that depend on the wall clock;
// the bounds are generous so a slow machine does not make them fail.

const ERROR_MS = 10_000;

async function showErrorToast(page: import("@playwright/test").Page) {
  await toTokenStep(page, "en");
  await typeToken(page, "en", WRONG_TOKEN);
  await verifyButton(page, "en").click();
  const toast = toasts(page).first();
  await expect(toast).toBeVisible();
  return { toast, shownAt: Date.now() };
}

test("an error toast closes by itself after about 10 seconds", async ({ page }) => {
  test.setTimeout(60_000);
  const { toast, shownAt } = await showErrorToast(page);
  // Keep the pointer away from the toast.
  await page.mouse.move(5, 5);
  await expect(toast).toBeHidden({ timeout: ERROR_MS + 5_000 });
  const elapsed = Date.now() - shownAt;
  expect(elapsed).toBeGreaterThan(ERROR_MS - 1_500);
  expect(elapsed).toBeLessThan(ERROR_MS + 4_000);
});

test("hovering pauses the time, leaving resumes it", async ({ page }) => {
  test.setTimeout(90_000);
  const { toast } = await showErrorToast(page);
  await toast.hover();
  // Longer than the whole time of an error toast.
  await page.waitForTimeout(ERROR_MS + 2_000);
  await expect(toast).toBeVisible();

  await page.mouse.move(5, 5);
  const leftAt = Date.now();
  await expect(toast).toBeHidden({ timeout: ERROR_MS + 5_000 });
  // Most of its time was still left when the pointer moved away.
  expect(Date.now() - leftAt).toBeGreaterThan(ERROR_MS / 2);
});

test("the same error again is counted on the toast instead of stacking", async ({ page }) => {
  const { toast } = await showErrorToast(page);
  await toast.hover();
  await verifyButton(page, "en").click();
  await expect(toast).toContainText("2×");
  await expect(toasts(page)).toHaveCount(1);
});

test("the close button dismisses a toast at once", async ({ page }) => {
  const { toast } = await showErrorToast(page);
  await toast.getByRole("button", { name: text("en", "toast.dismiss") }).click();
  await expect(toasts(page)).toHaveCount(0);
});

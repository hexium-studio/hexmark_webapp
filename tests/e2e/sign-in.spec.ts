import { expect, test } from "./fixtures";
import {
  ADA,
  emailField,
  GRACE,
  homeHeading,
  localeCookie,
  openSignIn,
  passwordField,
  prepareSignIn,
  sessionCookie,
  signInButton,
  signInHeading,
  signInWith,
  signOutButton,
} from "./helpers/auth";
import { text } from "./helpers/messages";
import { toasts } from "./helpers/wizard";

// Sign-in, home and sign-out at `/`, with the session cookie the web server
// sets. Session lifetimes (rotation, idle timeout): session.spec.ts.

const DAY_S = 24 * 60 * 60;

test("without remember me: a browser-session cookie, home with name and role, sign out", async ({
  page,
  stack,
}) => {
  await prepareSignIn(stack);
  await openSignIn(page, "en");
  await signInWith(page, "en", ADA);

  await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();
  await expect(homeHeading(page, "en", ADA.displayName)).toBeFocused();
  await expect(page.getByText(text("en", "roles.admin"), { exact: true })).toBeVisible();
  const cookie = await sessionCookie(page);
  expect(cookie).toMatchObject({ path: "/", httpOnly: true, sameSite: "Lax", secure: false });
  // -1: no Expires/Max-Age, the cookie ends with the browser session.
  expect(cookie?.expires).toBe(-1);

  await page.reload();
  await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();

  await signOutButton(page, "en").click();
  await expect(signInHeading(page, "en")).toBeVisible();
  await expect(signInHeading(page, "en")).toBeFocused();
  await expect(toasts(page).first()).toContainText(text("en", "home.signedOut.title"));
  expect(await sessionCookie(page)).toBeUndefined();
  const [row] = await stack.db.sql`select revoked_at from sessions`;
  expect(row?.revoked_at).toBeInstanceOf(Date);

  await page.reload();
  await expect(signInHeading(page, "en")).toBeVisible();
});

test("with remember me: a persistent cookie that ends with the session", async ({
  page,
  stack,
}) => {
  await prepareSignIn(stack);
  await openSignIn(page, "en");
  await signInWith(page, "en", ADA, true);
  await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();

  const cookie = await sessionCookie(page);
  const [row] = await stack.db.sql`select remember, expires_at from sessions`;
  expect(row?.remember).toBe(true);
  // Max-Age = time left until expires_at (28 days by default).
  const expiresAt = new Date(row?.expires_at as Date).getTime() / 1000;
  expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000 + 27 * DAY_S);
  expect(Math.abs((cookie?.expires ?? 0) - expiresAt)).toBeLessThan(60);
});

test("wrong password: error toast, e-mail kept, password cleared and focused", async ({
  page,
  stack,
}) => {
  await prepareSignIn(stack);
  await openSignIn(page, "en");
  await signInWith(page, "en", { email: ADA.email, password: "not the password" });

  await expect(toasts(page).first()).toContainText(
    text("en", "auth.errors.invalid_credentials.title"),
  );
  await expect(emailField(page, "en")).toHaveValue(ADA.email);
  await expect(passwordField(page, "en")).toHaveValue("");
  await expect(passwordField(page, "en")).toBeFocused();
  // The cleared password is not flagged; the toast says what went wrong.
  await expect(page.locator("[aria-invalid=true]")).toHaveCount(0);
  await expect(signInButton(page, "en")).toBeDisabled();
  expect(await sessionCookie(page)).toBeUndefined();
});

test("sign in stays disabled until the e-mail is valid and a password is entered", async ({
  page,
  stack,
}) => {
  await prepareSignIn(stack);
  await openSignIn(page, "en");
  const button = signInButton(page, "en");
  await expect(button).toBeDisabled();
  // The reason is not shown, but read with the button.
  await expect(button).toHaveAccessibleDescription(text("en", "auth.submitDisabledReason"));

  await emailField(page, "en").fill("ada@");
  await emailField(page, "en").blur();
  await passwordField(page, "en").fill("something");
  await passwordField(page, "en").blur();
  await expect(button).toBeDisabled();
  // No field errors at all: neither on leaving a field nor while invalid.
  await expect(page.locator("[aria-invalid=true]")).toHaveCount(0);
  await expect(page.getByText(text("en", "errors.invalid_email"))).toHaveCount(0);
  await expect(emailField(page, "en")).toHaveAccessibleDescription("");

  await emailField(page, "en").fill(ADA.email);
  await expect(button).toBeEnabled();
  await expect(button).toHaveAccessibleDescription("");

  await passwordField(page, "en").fill("");
  await passwordField(page, "en").blur();
  await expect(button).toBeDisabled();
  await expect(button).toHaveAccessibleDescription(text("en", "auth.submitDisabledReason"));
  await expect(page.locator("[aria-invalid=true]")).toHaveCount(0);
  await expect(page.getByText(text("en", "errors.fields.password.required"))).toHaveCount(0);
});

test("the account's language: home, then the sign-in page after signing out", async ({
  page,
  stack,
}) => {
  await prepareSignIn(stack, [ADA, GRACE]);
  await openSignIn(page, "en");
  // No language picker on the sign-in page.
  await expect(page.getByRole("button", { name: "Deutsch" })).toHaveCount(0);
  await signInWith(page, "en", GRACE);
  // GRACE's saved locale (de) wins over the browser language (en-US).
  await expect(homeHeading(page, "de", GRACE.displayName)).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByText(text("de", "roles.user"), { exact: true })).toBeVisible();

  // Sign-in stored the account's language in the locale cookie, with the
  // options of the setup language step.
  const cookie = await localeCookie(page);
  expect(cookie).toMatchObject({ value: "de", path: "/", httpOnly: true, sameSite: "Lax" });
  expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000 + 360 * DAY_S);

  // Signed out, the cookie wins over the browser: the sign-in page stays German.
  await signOutButton(page, "de").click();
  await expect(signInHeading(page, "de")).toBeVisible();
  await page.reload();
  await expect(signInHeading(page, "de")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
});

test.describe("German browser", () => {
  test.use({ locale: "de-DE" });

  test("sign-in in German; an English account switches the device to English", async ({
    page,
    stack,
  }) => {
    await prepareSignIn(stack);
    await openSignIn(page, "de");
    await signInWith(page, "de", ADA);
    await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();
    await expect(page.getByText(text("en", "roles.admin"), { exact: true })).toBeVisible();
    await signOutButton(page, "en").click();
    await expect(signInHeading(page, "en")).toBeVisible();
  });
});

test("blocked while SETUP_TOKEN is set: steps instead of the form", async ({ page, stack }) => {
  await prepareSignIn(stack, [ADA], { setupToken: stack.token });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: text("en", "auth.signInBlocked.title") }),
  ).toBeVisible();
  await expect(page.getByText(text("en", "auth.signInBlocked.kicker"))).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(3);
  await expect(emailField(page, "en")).toHaveCount(0);
  const reload = page.getByRole("link", { name: text("en", "auth.signInBlocked.reload") });
  await expect(reload).toHaveAttribute("href", "/");

  // Token removed and server restarted: the reload leads to sign-in.
  await stack.restartServer({ setupToken: null });
  await reload.click();
  await expect(signInHeading(page, "en")).toBeVisible();
});

test("setup still open: / leads to the setup wizard", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
});

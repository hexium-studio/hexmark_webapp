import type { Browser, Page } from "@playwright/test";
import { startWebServer, type WebServer } from "../support/web-server";
import { expect, test } from "./fixtures";
import {
  ADA,
  homeHeading,
  openSignIn,
  passwordField,
  prepareSignIn,
  sessionCookie,
  signInButton,
  signInWith,
} from "./helpers/auth";
import { plain, text } from "./helpers/messages";
import { continueStep, openSetup, toasts } from "./helpers/wizard";

// The browser's address as the API server sees it, end to end: the web
// server reads the connection's peer, believes X-Forwarded-For and
// X-Forwarded-Proto only from TRUSTED_PROXIES, and forwards the address
// with INTERNAL_API_KEY. A second web server with this test runner
// (127.0.0.1) as trusted proxy simulates clients behind a reverse proxy.

const CLIENT_A = "203.0.113.10";
const CLIENT_B = "198.51.100.20";
const FAILURES_UNTIL_LOCKOUT = 10;

function errorToast(page: Page, code: string) {
  return toasts(page).filter({ hasText: text("en", `auth.errors.${code}.title`) });
}

async function clientPage(browser: Browser, baseURL: string, headers: Record<string, string>) {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: headers });
  return context.newPage();
}

// Fails sign-in until the per-address limit is reached; the form clears the
// password after each answer.
async function failUntilLocked(page: Page) {
  await openSignIn(page, "en");
  for (let i = 0; i < FAILURES_UNTIL_LOCKOUT; i++) {
    await signInWith(page, "en", { email: ADA.email, password: "wrong password" });
    await expect(passwordField(page, "en")).toHaveValue("");
  }
  await signInWith(page, "en", ADA);
  await expect(errorToast(page, "rate_limited")).toBeVisible();
}

let proxied: WebServer | undefined;

test.afterEach(async () => {
  await proxied?.stop();
  proxied = undefined;
});

test("behind a trusted proxy: one client's lockout does not lock out another", async ({
  browser,
  stack,
}) => {
  await prepareSignIn(stack);
  proxied = await startWebServer(stack.serverUrl, { TRUSTED_PROXIES: "127.0.0.1, ::1" });
  const a = await clientPage(browser, proxied.url, { "x-forwarded-for": CLIENT_A });
  await failUntilLocked(a);

  const b = await clientPage(browser, proxied.url, { "x-forwarded-for": CLIENT_B });
  await openSignIn(b, "en");
  await signInWith(b, "en", ADA);
  await expect(homeHeading(b, "en", ADA.displayName)).toBeVisible();
});

test("without a trusted proxy, X-Forwarded-For from the browser is ignored", async ({
  browser,
  stack,
}) => {
  await prepareSignIn(stack);
  // The worker's own web server: TRUSTED_PROXIES is empty.
  const a = await clientPage(browser, stack.webUrl, { "x-forwarded-for": CLIENT_A });
  await failUntilLocked(a);

  // A different forged address is the same client (127.0.0.1) to the server.
  const b = await clientPage(browser, stack.webUrl, { "x-forwarded-for": CLIENT_B });
  await openSignIn(b, "en");
  await signInWith(b, "en", ADA);
  await expect(errorToast(b, "rate_limited")).toBeVisible();
});

test("the Secure cookie flag follows X-Forwarded-Proto only from a trusted proxy", async ({
  browser,
  stack,
}) => {
  await prepareSignIn(stack);
  const https = { "x-forwarded-proto": "https" };
  proxied = await startWebServer(stack.serverUrl, { TRUSTED_PROXIES: "127.0.0.1, ::1" });
  const trusted = await clientPage(browser, proxied.url, https);
  await openSignIn(trusted, "en");
  await signInWith(trusted, "en", ADA);
  await expect(homeHeading(trusted, "en", ADA.displayName)).toBeVisible();
  expect(await sessionCookie(trusted)).toMatchObject({ secure: true });

  const forged = await clientPage(browser, stack.webUrl, https);
  await openSignIn(forged, "en");
  await signInWith(forged, "en", ADA);
  await expect(homeHeading(forged, "en", ADA.displayName)).toBeVisible();
  expect(await sessionCookie(forged)).toMatchObject({ secure: false });
});

test("missing instance keys: the connection check says so and sign-in is refused", async ({
  page,
  stack,
}) => {
  await stack.restartServer({ env: { ENCRYPTION_KEY: "" } });
  await openSetup(page, "en");
  await continueStep(page, "en", "connection");
  await expect(
    page.getByText(plain(text("en", "setup.connection.detail.configMissing"))),
  ).toBeVisible();
  await expect(page.getByText(text("en", "setup.connection.labels.config"))).toBeVisible();

  await prepareSignIn(stack, [ADA], { env: { ENCRYPTION_KEY: "" } });
  await openSignIn(page, "en");
  await signInWith(page, "en", ADA);
  await expect(errorToast(page, "server_not_configured")).toBeVisible();
  expect(await sessionCookie(page)).toBeUndefined();
  await expect(signInButton(page, "en")).toBeVisible();
});

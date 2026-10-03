import { createHash } from "node:crypto";
import { expect, test } from "./fixtures";
import {
  ADA,
  ageSession,
  homeHeading,
  openSignIn,
  prepareSignIn,
  SESSION_COOKIE,
  sessionCookie,
  signInHeading,
  signInWith,
} from "./helpers/auth";

// The session cookie over time, kept fresh by the web server's request
// proxy: token rotation, idle timeout, and that the token never reaches the
// page. Time passes by moving the session's timestamps back in the database.

test("rotation: the cookie gets a new token and the session stays valid", async ({
  page,
  stack,
}) => {
  await prepareSignIn(stack, [ADA], { env: { SESSION_ROTATION: "1m" } });
  await openSignIn(page, "en");
  await signInWith(page, "en", ADA);
  await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();
  const first = (await sessionCookie(page))?.value ?? "";

  // Not due yet: the same token.
  await page.reload();
  await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();
  expect((await sessionCookie(page))?.value).toBe(first);

  await ageSession(stack, first, "rotated_at", "2 minutes");
  await page.reload();
  await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();
  const second = await sessionCookie(page);
  expect(second?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(second?.value).not.toBe(first);
  // Still a browser-session cookie with the same attributes.
  expect(second).toMatchObject({ path: "/", httpOnly: true, sameSite: "Lax", expires: -1 });

  await page.reload();
  await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();
  expect((await sessionCookie(page))?.value).toBe(second?.value);
  const [row] = await stack.db.sql`select count(*)::int as n from sessions`;
  expect(row?.n).toBe(1);
});

test("rotation keeps a remembered session persistent", async ({ page, stack }) => {
  await prepareSignIn(stack, [ADA], { env: { SESSION_ROTATION: "1m" } });
  await openSignIn(page, "en");
  await signInWith(page, "en", ADA, true);
  await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();
  const first = await sessionCookie(page);
  await ageSession(stack, first?.value ?? "", "rotated_at", "2 minutes");
  await page.reload();
  await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();
  const second = await sessionCookie(page);
  expect(second?.value).not.toBe(first?.value);
  expect(Math.abs((second?.expires ?? 0) - (first?.expires ?? 0))).toBeLessThan(60);
});

test("idle timeout without remember me: back to sign-in, cookie deleted", async ({
  page,
  stack,
}) => {
  await prepareSignIn(stack);
  await openSignIn(page, "en");
  await signInWith(page, "en", ADA);
  await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();
  const token = (await sessionCookie(page))?.value ?? "";

  await ageSession(stack, token, "last_seen_at", "61 minutes");
  await page.reload();
  await expect(signInHeading(page, "en")).toBeVisible();
  expect(await sessionCookie(page)).toBeUndefined();
});

test("the token never appears in the page or its responses", async ({ page, stack }) => {
  await prepareSignIn(stack);
  await openSignIn(page, "en");
  const bodies: string[] = [];
  const headerValues: string[] = [];
  page.on("response", async (response) => {
    headerValues.push(
      ...Object.entries(await response.allHeaders())
        .filter(([name]) => name !== "set-cookie")
        .map(([name, value]) => `${name}: ${value}`),
    );
    if (response.request().resourceType() === "document" || response.url().endsWith("/")) {
      bodies.push(await response.text().catch(() => ""));
    }
  });
  await signInWith(page, "en", ADA);
  await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();
  await page.reload();
  await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();

  const token = (await sessionCookie(page))?.value ?? "";
  expect(token).not.toBe("");
  expect(bodies.length).toBeGreaterThan(0);
  for (const body of bodies) expect(body).not.toContain(token);
  expect(headerValues.filter((value) => value.includes(token))).toEqual([]);
  // The proxy's internal header stays on the server side.
  expect(headerValues.filter((value) => value.startsWith("x-hexmark-session"))).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).not.toContain(SESSION_COOKIE);
});

test("a session header sent by the browser is ignored", async ({ page, stack }) => {
  await prepareSignIn(stack);
  // A well-formed but unknown token, and a header that claims it belongs to
  // a signed-in user: the proxy replaces the header with what /me says.
  const token = "A".repeat(43);
  await page.context().addCookies([{ name: SESSION_COOKIE, value: token, url: stack.webUrl }]);
  const forged = Buffer.from(
    JSON.stringify({
      token: createHash("sha256").update(token).digest("hex"),
      session: {
        state: "signed-in",
        user: { id: "x", displayName: "Mallory", username: "m", role: "admin", locale: "en" },
      },
    }),
  ).toString("base64url");
  await page.setExtraHTTPHeaders({ "x-hexmark-session": forged });
  await page.goto("/");
  await expect(signInHeading(page, "en")).toBeVisible();
  await expect(page.getByText("Mallory")).toHaveCount(0);
  // The unknown token was refused, so the proxy deleted the cookie.
  expect(await sessionCookie(page)).toBeUndefined();
});

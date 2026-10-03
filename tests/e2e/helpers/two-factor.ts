import { expect, type Page } from "@playwright/test";
import { base32Decode, hotp, totpStep } from "../../../apps/server/src/services/totp";
import { newCredential, register } from "../../support/soft-authenticator";
import type { Stack, StackServerOptions } from "../fixtures";
import { ADA, prepareSignIn, type TestAccount } from "./auth";

// Second factors in the e2e tests: the web app opened at http://localhost
// (WebAuthn refuses IP addresses), the API server told so through
// PUBLIC_ORIGIN, Chrome's virtual authenticator (CDP WebAuthn domain) in
// place of a security key, and authenticator app codes computed from the
// key the page shows.

// The worker's web app under the host name WebAuthn needs.
export function localOrigin(stack: Stack): string {
  return stack.webUrl.replace("127.0.0.1", "localhost");
}

// Restarts the API server with security keys offered for localOrigin().
// `setupToken`: as in restartServer (undefined keeps the test token).
export async function offerSecurityKeys(stack: Stack, setupToken?: string | null): Promise<void> {
  await stack.restartServer({ setupToken, env: { PUBLIC_ORIGIN: localOrigin(stack) } });
}

// A USB security key with user verification that answers by itself
// (presence simulated), as Chrome's DevTools protocol offers it.
export async function addVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "usb",
      hasResidentKey: false,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return {
    async credentials() {
      const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
      return credentials;
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Waits (at most ~2 s) until the current 30-second step has 2 s left, so a
// code typed now is still accepted when it arrives.
export async function awayFromStepEdge(): Promise<void> {
  const left = 30_000 - (Date.now() % 30_000);
  if (left < 2_000) await sleep(left + 50);
}

export function totpCode(secret: string, offset = 0): string {
  const key = base32Decode(secret.replace(/\s+/g, ""));
  if (!key) throw new Error("not a base32 key");
  return hotp(key, totpStep(new Date()) + offset);
}

// The key shown for manual entry in a set-up (groups of four joined).
export async function manualKey(page: Page, id: string): Promise<string> {
  const key = page.locator(`#${id}-key`);
  await expect(key).not.toHaveText(/X{4}/);
  return (await key.innerText()).replace(/\s+/g, "");
}

// Types the app's current code into the code input with id prefix `id`.
export async function typeTotp(page: Page, id: string, secret: string, offset = 0) {
  await awayFromStepEdge();
  await page.locator(`#${id}-1`).click();
  await page.keyboard.type(totpCode(secret, offset));
}

// Lets the next code of the same step count again (replay protection), so a
// test need not wait 30 seconds before signing in once more.
export async function forgetLastTotpStep(stack: Stack, email: string): Promise<void> {
  await stack.db.sql`
    update totp_credentials set last_used_step = null
    where user_id = (select id from users where email = ${email})
  `;
}

export async function setRequireTwoFactor(stack: Stack, value: boolean): Promise<void> {
  await stack.db.sql`
    insert into instance_settings (id, require_two_factor) values (1, ${value})
    on conflict (id) do update set require_two_factor = ${value}
  `;
}

interface Api {
  session: string;
  call(method: string, path: string, body?: unknown): Promise<Record<string, unknown>>;
}

// Signs `account` in through the API (no browser) to prepare factors.
async function apiSession(stack: Stack, account: TestAccount): Promise<Api> {
  const call = async (method: string, path: string, body?: unknown, auth?: string) => {
    const response = await fetch(`${stack.serverUrl}/api${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(auth ? { authorization: auth } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (await response.json()) as Record<string, unknown>;
  };
  const { email, password } = account;
  const login = await call("POST", "/auth/v1/login", { email, password, remember: false });
  const session = (login.session as { token: string } | undefined)?.token;
  if (!session) throw new Error(`login: ${JSON.stringify(login)}`);
  return { session, call: (method, path, body) => call(method, path, body, `Session ${session}`) };
}

// Account `account` (seeded, server without SETUP_TOKEN) with an
// authenticator app; returns its key and recovery codes. `softKeyOrigin`:
// also registers a key of the software authenticator for that origin, so
// sign-in offers security keys (the key itself is never used in a browser).
export async function seedTotpAccount(
  stack: Stack,
  account: TestAccount = ADA,
  server: StackServerOptions = {},
  softKeyOrigin?: string,
) {
  await prepareSignIn(stack, [account], server);
  const api = await apiSession(stack, account);
  const start = await api.call("POST", "/account/v1/totp/start");
  const secret = start.secret as string;
  await awayFromStepEdge();
  const confirm = await api.call("POST", "/account/v1/totp/confirm", { code: totpCode(secret) });
  if (confirm.ok !== true) throw new Error(`confirm: ${JSON.stringify(confirm)}`);
  await forgetLastTotpStep(stack, account.email);
  if (softKeyOrigin) {
    const { options } = await api.call("POST", "/account/v1/webauthn/registration/options");
    const response = register(newCredential(), options as never, softKeyOrigin);
    const verify = await api.call("POST", "/account/v1/webauthn/registration/verify", {
      name: "Software key",
      response,
    });
    if (verify.ok !== true) throw new Error(`verify: ${JSON.stringify(verify)}`);
  }
  return { secret, recoveryCodes: confirm.recoveryCodes as string[] };
}

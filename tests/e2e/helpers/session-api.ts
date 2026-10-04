import { expect, type Page } from "@playwright/test";
import type { Stack } from "../fixtures";
import { ADA, ageSession, sessionCookie } from "./auth";

// Requests straight at the API server with the browser's session or an API
// token, for seeding what a page shows (notes, tokens, locks).

export async function api(
  stack: Stack,
  authorization: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${stack.serverUrl}${path}`, {
    method,
    headers: {
      authorization,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

export async function sessionAuth(page: Page): Promise<string> {
  return `Session ${(await sessionCookie(page))?.value ?? ""}`;
}

// A token made with the session (its password re-entered for it, and that
// confirmation moved out of its window again, so the page still asks).
export async function seedToken(page: Page, stack: Stack, input: Record<string, unknown>) {
  const auth = await sessionAuth(page);
  const reauth = await api(stack, auth, "POST", "/api/auth/v1/reauthenticate", {
    password: ADA.password,
  });
  expect(reauth.status).toBe(200);
  const created = await api(stack, auth, "POST", "/api/tokens/v1/tokens", input);
  expect(created.status).toBe(201);
  await ageSession(stack, auth.slice("Session ".length), "reauthenticated_at", "1 hour");
  return { token: created.body.token as string, id: (created.body.info as { id: string }).id };
}

export async function seedNote(page: Page, stack: Stack, folderId: string | null, title: string) {
  const created = await api(stack, await sessionAuth(page), "POST", "/api/notes/v1/notes", {
    folderId,
    title,
    body: `# ${title}\n`,
  });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

"use server";

import type { LockTargetKind } from "@hexmark/shared";
import { isRecord } from "@/lib/api-fields";
import { callServer } from "@/lib/server-api";
import { sessionAuthorization } from "@/lib/session/session-authorization";

// Unlocking and unhiding from /locked (POST
// /api/notes/v1/{notes|folders}/:id/unlock or /unhide, signed-in people
// only; unhiding also needs the password re-entered recently, which the
// server decides: reauthentication_required). Refusals are codes the page
// translates ("locked.errors.<code>").

export type UnlockResult = { ok: true } | { ok: false; error: string };

export async function unlockItem(kind: LockTargetKind, id: string): Promise<UnlockResult> {
  return lift(kind, id, "unlock");
}

export async function unhideItem(kind: LockTargetKind, id: string): Promise<UnlockResult> {
  return lift(kind, id, "unhide");
}

async function lift(
  kind: LockTargetKind,
  id: string,
  action: "unlock" | "unhide",
): Promise<UnlockResult> {
  const authorization = await sessionAuthorization();
  if (!authorization) return { ok: false, error: "unauthenticated" };
  if ((kind !== "note" && kind !== "folder") || !/^[0-9a-f-]{36}$/i.test(String(id))) {
    return { ok: false, error: "not_found" };
  }
  const response = await callServer(`/api/notes/v1/${kind}s/${id}/${action}`, {
    method: "POST",
    headers: { authorization },
  });
  if (!response.reachable) return { ok: false, error: "server_unreachable" };
  if (response.status === 200) return { ok: true };
  const body = isRecord(response.body) ? response.body : {};
  return { ok: false, error: typeof body.error === "string" ? body.error : "unexpected" };
}

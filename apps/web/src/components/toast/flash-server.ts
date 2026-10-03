import { cookies } from "next/headers";
import { FLASH_COOKIE, type FlashToastId } from "./flash";

// Server side of flash toasts (see flash.ts). Call from a server action
// before redirect(); only server code may import this file.
//
//   await queueFlashToast("adminCreated");
//   redirect("/setup/complete");

// Long enough for the redirect, short enough that an unread toast does not
// pop up on some later visit.
const FLASH_MAX_AGE_SECONDS = 60;

export async function queueFlashToast(id: FlashToastId): Promise<void> {
  (await cookies()).set(FLASH_COOKIE, id, {
    path: "/",
    maxAge: FLASH_MAX_AGE_SECONDS,
    sameSite: "lax",
    // The Toaster reads and deletes it in the browser; it holds only an id.
    httpOnly: false,
  });
}

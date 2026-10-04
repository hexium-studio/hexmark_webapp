import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { loadLockedPage } from "@/lib/locks/load";
import { currentSession } from "@/lib/session/current-session";
import { LockedPage } from "./_components/LockedPage";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("locked"))("metaTitle") };
}

// /locked: the notes and folders with a lock of their own, to unlock them,
// and those hidden from agents, to unhide them. Signed out (or the session
// ended), the sign-in page takes over. Loaded on every request; the page
// refreshes itself after each unlock or unhide.
export default async function LockedItemsPage() {
  await connection();
  const session = await currentSession();
  if (session.state !== "signed-in") redirect("/");
  const result = await loadLockedPage();
  if (result.kind === "unauthenticated") redirect("/");
  return <LockedPage data={result.kind === "ok" ? result.data : undefined} />;
}

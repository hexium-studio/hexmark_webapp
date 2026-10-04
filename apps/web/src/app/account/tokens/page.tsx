import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { loadTokensPage } from "@/lib/api-tokens/load";
import { currentSession } from "@/lib/session/current-session";
import { TokensPage } from "./_components/TokensPage";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("tokens"))("metaTitle") };
}

// /account/tokens: the signed-in user's API tokens for agents. Signed out
// (or the session ended), the sign-in page takes over. Loaded on every
// request; a new token itself is never part of what is loaded here.
export default async function AccountTokensPage() {
  await connection();
  const session = await currentSession();
  if (session.state !== "signed-in") redirect("/");
  const result = await loadTokensPage();
  if (result.kind === "unauthenticated") redirect("/");
  return <TokensPage user={session.user} data={result.kind === "ok" ? result.data : undefined} />;
}

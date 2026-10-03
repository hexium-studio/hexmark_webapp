import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { currentSession } from "@/lib/session/current-session";
import { loadAccountSecurity } from "@/lib/two-factor/account-security";
import { SecurityPage } from "./_components/SecurityPage";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("accountSecurity"))("metaTitle") };
}

// /account/security: the signed-in user's second factors and recovery
// codes. Signed out (or the session ended), the sign-in page takes over.
// The factors are loaded on every request; the page refreshes itself after
// each change.
export default async function AccountSecurityPage() {
  await connection();
  const session = await currentSession();
  if (session.state !== "signed-in") redirect("/");
  const result = await loadAccountSecurity();
  if (result.kind === "unauthenticated") redirect("/");
  return (
    <SecurityPage
      user={session.user}
      security={result.kind === "ok" ? result.security : undefined}
    />
  );
}

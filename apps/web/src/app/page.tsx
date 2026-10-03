import { factorCounts, hasAnyFactor } from "@hexmark/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { currentSession } from "@/lib/session/current-session";
import { loadSetupStatus } from "@/lib/setup-status";
import { loadAccountSecurity } from "@/lib/two-factor/account-security";
import { Home } from "./_components/Home";
import { SignIn } from "./_components/SignIn";
import { SignInBlocked } from "./_components/SignInBlocked";

// `/`: setup still open → the wizard; SETUP_TOKEN still set → the blocked
// state; signed in → home; otherwise the sign-in form (and its second
// steps, which stay on this page). The session comes
// from the request proxy (src/proxy.ts) without another API call.
const loadState = cache(async () => {
  const [status, session] = await Promise.all([loadSetupStatus(), currentSession()]);
  if (status.kind === "ok") {
    if (status.status.setupOpen) return { view: "setup" } as const;
    if (status.status.setupTokenPresent) return { view: "blocked" } as const;
  }
  if (session.state === "signed-in") {
    // Home points to the security page while the account has no second
    // factor; without an answer from the server, it says nothing.
    const security = await loadAccountSecurity();
    const twoFactorMissing =
      security.kind === "ok" && !hasAnyFactor(factorCounts(security.security));
    return { view: "home", user: session.user, twoFactorMissing } as const;
  }
  // Server or database not answering: sign-in is shown, with a note.
  const serverDown = status.kind !== "ok" || session.state === "unavailable";
  return { view: "sign-in", serverDown } as const;
});

export async function generateMetadata(): Promise<Metadata> {
  const state = await loadState();
  if (state.view === "home") return { title: (await getTranslations("home"))("metaTitle") };
  const t = await getTranslations("auth");
  return { title: t(state.view === "blocked" ? "signInBlocked.metaTitle" : "metaTitle") };
}

export default async function RootPage() {
  await connection();
  const state = await loadState();
  if (state.view === "setup") redirect("/setup");
  if (state.view === "home") {
    return <Home user={state.user} twoFactorMissing={state.twoFactorMissing} />;
  }
  if (state.view === "blocked") return <SignInBlocked />;
  return <SignIn serverDown={state.serverDown} />;
}

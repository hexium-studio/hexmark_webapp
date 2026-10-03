import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { pickerLocales } from "@/lib/locales/picker-locales";
import { loadSetupStatus } from "@/lib/setup-status";
import { loadSetupTicket, type SetupTicketState } from "@/lib/setup-ticket";
import { SetupWizard } from "./_components/SetupWizard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("setup");
  return { title: t("metaTitle") };
}

// Loads the setup status on every request and hands it to the wizard, with
// the languages its language step offers. When the server or database is
// down the wizard still renders and the connection check shows the failing
// check. Once the admin exists, setup is closed: the wizard's last steps
// (two-factor authentication, system settings) are shown only to the
// browser that holds the setup ticket; for everyone else the route no
// longer exists.
export default async function SetupPage() {
  await connection();
  const status = await loadSetupStatus();
  let ticket: SetupTicketState = { kind: "none" };
  if (status.kind === "ok" && !status.status.setupOpen) {
    ticket = await loadSetupTicket();
    if (ticket.kind === "none") notFound();
  }
  const { locales, blocks } = await pickerLocales();
  return <SetupWizard status={status} ticket={ticket} locales={locales} localeBlocks={blocks} />;
}

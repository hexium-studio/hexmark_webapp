import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { pickerLocales } from "@/lib/locales/picker-locales";
import { loadSetupStatus } from "@/lib/setup-status";
import { SetupWizard } from "./_components/SetupWizard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("setup");
  return { title: t("metaTitle") };
}

// Loads the setup status on every request and hands it to the wizard, with
// the languages its language step offers. When the server or database is
// down the wizard still renders and the connection check shows the failing
// check; once setup is done the route no longer exists.
export default async function SetupPage() {
  await connection();
  const status = await loadSetupStatus();
  if (status.kind === "ok" && !status.status.setupOpen) notFound();
  const { locales, blocks } = await pickerLocales();
  return <SetupWizard status={status} locales={locales} localeBlocks={blocks} />;
}

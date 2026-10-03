import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { pickerLocales } from "@/lib/locales/picker-locales";
import { loadSetupStatus } from "@/lib/setup-status";
import { SetupComplete } from "./_components/SetupComplete";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("setupComplete");
  return { title: t("metaTitle") };
}

// Shown after the first admin was created, until SETUP_TOKEN is removed.
// Setup still open → back to the wizard; token gone → setup is finished.
export default async function SetupCompletePage() {
  await connection();
  const status = await loadSetupStatus();
  if (status.kind === "ok") {
    if (status.status.setupOpen) redirect("/setup");
    if (!status.status.setupTokenPresent) redirect("/");
  }
  const { locales } = await pickerLocales();
  return <SetupComplete statusConfirmed={status.kind === "ok"} locales={locales} />;
}

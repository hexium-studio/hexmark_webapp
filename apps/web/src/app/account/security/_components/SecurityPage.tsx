"use client";

import { type AccountSecurityResponse, type AuthUser, factorCounts } from "@hexmark/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { CardShell } from "@/components/card-shell/CardShell";
import { FormAlert } from "@/components/form-alert/FormAlert";
import { toast } from "@/components/toast/toast-store";
import { AppSection } from "./AppSection";
import { CodesSection } from "./CodesSection";
import { ConfirmDialog } from "./ConfirmDialog";
import { KeysSection } from "./KeysSection";
import { NewCodes } from "./NewCodes";
import styles from "./Security.module.css";
import type { SensitiveRequest } from "./sensitive";

const TITLE_ID = "security-title";

export interface SecurityPageProps {
  user: AuthUser;
  // Undefined when the server gave no usable answer.
  security: AccountSecurityResponse | undefined;
}

// The account security page: authenticator app, security keys and recovery
// codes, each with what can be done about it. What the server would refuse
// is not offered: removing the last factor while the instance requires one,
// new recovery codes without a factor (rules from @hexmark/shared).
// Sensitive changes go through the confirmation dialog; new recovery codes
// replace the page content until they are saved.
export function SecurityPage({ user, security }: SecurityPageProps) {
  const t = useTranslations("accountSecurity");
  const router = useRouter();
  const [request, setRequest] = useState<SensitiveRequest | null>(null);
  const [codes, setCodes] = useState<{ list: string[]; first: boolean } | null>(null);
  const [confirmedUntil, setConfirmedUntil] = useState<string | null>(null);

  const home = (
    <div className={styles.links}>
      <a href="/" className={styles.homeLink}>
        {t("home")}
      </a>
      <a href="/account/tokens" className={styles.homeLink}>
        {t("tokensLink")}
      </a>
    </div>
  );

  if (!security) {
    return (
      <CardShell width="wide" title={t("title")}>
        <FormAlert title={t("unavailable.title")}>
          <p>{t("unavailable.detail")}</p>
        </FormAlert>
        {home}
      </CardShell>
    );
  }

  const counts = factorCounts(security);
  const until = confirmedUntil ?? security.reauthenticatedUntil;

  function factorAdded(kind: "app" | "key", recoveryCodes: string[] | null) {
    toast.success({ title: t(kind === "app" ? "app.added" : "keys.added") });
    if (recoveryCodes) setCodes({ list: recoveryCodes, first: true });
    router.refresh();
  }

  function sensitiveDone(done: SensitiveRequest, recoveryCodes?: string[]) {
    setRequest(null);
    if (done.kind === "regenerate" && recoveryCodes)
      setCodes({ list: recoveryCodes, first: false });
    toast.success({ title: t(`done.${done.kind}`) });
    router.refresh();
  }

  return (
    <CardShell
      width="wide"
      title={t("title")}
      titleId={TITLE_ID}
      lead={t("lead", { name: user.displayName })}
    >
      {codes ? (
        <NewCodes
          codes={codes.list}
          first={codes.first}
          account={user.username}
          timeZone={security.timezone}
          onDone={() => {
            setCodes(null);
            requestAnimationFrame(() => document.getElementById(TITLE_ID)?.focus());
          }}
        />
      ) : (
        <>
          {security.requireTwoFactor ? <FormAlert tone="info" title={t("required")} /> : null}
          <AppSection
            security={security}
            counts={counts}
            onAdded={factorAdded}
            onRemove={setRequest}
          />
          <KeysSection
            security={security}
            counts={counts}
            onAdded={factorAdded}
            onRemove={setRequest}
          />
          <CodesSection security={security} counts={counts} onRegenerate={setRequest} />
          {home}
        </>
      )}
      <ConfirmDialog
        request={request}
        reauthenticatedUntil={until}
        onReauthenticated={setConfirmedUntil}
        onClose={() => setRequest(null)}
        onDone={(done, result) => sensitiveDone(done, result.recoveryCodes)}
        onRefused={() => router.refresh()}
      />
    </CardShell>
  );
}

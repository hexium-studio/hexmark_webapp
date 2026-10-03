"use client";

import { factorCounts, hasAnyFactor } from "@hexmark/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/button/Button";
import { KeySupportSlot } from "@/components/two-factor/KeySupportSlot";
import { RecoveryCodes } from "@/components/two-factor/RecoveryCodes";
import { SecurityKeySetup } from "@/components/two-factor/SecurityKeySetup";
import { TotpSetup } from "@/components/two-factor/TotpSetup";
import type { FactorFailure } from "@/lib/two-factor/factor-result";
import { FactorCard } from "./FactorCard";
import { SkipConfirmation } from "./SkipConfirmation";
import styles from "./Step.module.css";
import { TicketProblem } from "./TicketProblem";
import type { StepProps } from "./wizard-types";

const CODES_HEADING_ID = "setup-codes-heading";

// Step 5: a second factor for the admin account – recommended, not
// required. The admin may add an authenticator app and any number of
// security keys; the first factor comes with the recovery codes, shown once
// before the step goes on. The step acts with the setup ticket (challenge
// cookie); the factors shown come from the server (page.tsx), so the page is
// refreshed after each one. Skipping asks for confirmation first.
export function TwoFactorStep({ wizard }: StepProps) {
  const t = useTranslations("setup.twoFactor");
  const router = useRouter();
  const [expired, setExpired] = useState(false);
  const [addingApp, setAddingApp] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const codesHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (codes) codesHeading.current?.focus();
  }, [codes]);

  const { ticket } = wizard;
  if (expired || ticket.kind === "expired") return <TicketProblem kind="expired" />;
  if (ticket.kind !== "active") return <TicketProblem kind="unavailable" />;
  const { overview } = ticket;
  const hasFactor = hasAnyFactor(factorCounts(overview));
  const keys = overview.webauthn.credentials;

  function onFailure(failure: FactorFailure): boolean {
    if (failure.error !== "challenge_invalid") return false;
    setExpired(true);
    return true;
  }

  function onAdded(newCodes: string[] | null) {
    setAddingApp(false);
    setConfirmSkip(false);
    if (newCodes) setCodes(newCodes);
    router.refresh();
  }

  if (codes) {
    return (
      <div className={styles.step}>
        <h3 id={CODES_HEADING_ID} ref={codesHeading} tabIndex={-1} className={styles.subheading}>
          {t("codesHeading")}
        </h3>
        <RecoveryCodes
          codes={codes}
          labelledBy={CODES_HEADING_ID}
          account={wizard.data.adminEmail}
          doneLabel={t("codesDone")}
          onDone={() => setCodes(null)}
        />
      </div>
    );
  }

  return (
    <div className={styles.step}>
      <FactorCard
        title={t("app.title")}
        description={t("app.description")}
        done={overview.totp.enabled}
        status={overview.totp.enabled ? t("app.enabled") : t("app.disabled")}
      >
        {overview.totp.enabled ? null : addingApp ? (
          <TotpSetup
            context="setup"
            id="setup-totp"
            onAdded={onAdded}
            onCancel={() => setAddingApp(false)}
            onFailure={onFailure}
          />
        ) : (
          <div>
            <Button variant="secondary" onClick={() => setAddingApp(true)}>
              {t("app.start")}
            </Button>
          </div>
        )}
      </FactorCard>
      <FactorCard
        title={t("keys.title")}
        description={t("keys.description")}
        done={keys.length > 0}
        status={keys.length > 0 ? t("keys.count", { count: keys.length }) : t("keys.none")}
      >
        {keys.length > 0 ? (
          <ul className={styles.keyNames}>
            {keys.map((key) => (
              <li key={key.id}>{key.name}</li>
            ))}
          </ul>
        ) : null}
        <KeySupportSlot offered={overview.webauthn.available}>
          <SecurityKeySetup
            context="setup"
            id="setup-key"
            onAdded={onAdded}
            onFailure={onFailure}
          />
        </KeySupportSlot>
      </FactorCard>
      {confirmSkip ? (
        <SkipConfirmation onSkip={wizard.next} onStay={() => setConfirmSkip(false)} />
      ) : (
        <div className={styles.actions}>
          {hasFactor ? (
            <Button onClick={wizard.next}>{t("continue")}</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setConfirmSkip(true)}>
                {t("skip")}
              </Button>
              <p className={styles.note}>{t("skipNote")}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

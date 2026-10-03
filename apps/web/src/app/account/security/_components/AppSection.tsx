"use client";

import { hasAnyFactor, mayRemoveFactor } from "@hexmark/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/button/Button";
import { TotpSetup } from "@/components/two-factor/TotpSetup";
import { SectionHead } from "./SectionHead";
import styles from "./Security.module.css";
import { type FactorSectionProps, sessionEnded } from "./section-props";
import { useFocusOnClose } from "./use-focus-on-close";

const HEADING_ID = "security-app";
const LAST_FACTOR_ID = "security-app-last";

// The authenticator app: set it up here, or remove it (confirmed with the
// password). Removal is not offered while it is the last factor of an
// account that must have one.
export function AppSection({ security, counts, onAdded, onRemove }: FactorSectionProps) {
  const t = useTranslations("accountSecurity");
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  useFocusOnClose(adding, HEADING_ID);
  const enabled = security.totp.enabled;
  const after = { ...counts, totp: false };
  const removable = mayRemoveFactor(security.requireTwoFactor, after);

  return (
    <section className={styles.section} aria-labelledby={HEADING_ID}>
      <SectionHead
        id={HEADING_ID}
        title={t("app.title")}
        status={enabled ? t("app.enabled") : t("app.disabled")}
        on={enabled}
      />
      <p className={styles.muted}>{enabled ? t("app.descriptionOn") : t("app.descriptionOff")}</p>
      {enabled ? (
        <div className={styles.actions}>
          <Button
            variant="secondary"
            disabled={!removable}
            aria-describedby={removable ? undefined : LAST_FACTOR_ID}
            onClick={() => onRemove({ kind: "removeTotp", removesLast: !hasAnyFactor(after) })}
          >
            {t("app.remove")}
          </Button>
          {removable ? null : (
            <p id={LAST_FACTOR_ID} className={styles.note}>
              {t("lastFactor")}
            </p>
          )}
        </div>
      ) : adding ? (
        <TotpSetup
          context="account"
          id="account-totp"
          onAdded={(codes) => {
            setAdding(false);
            onAdded("app", codes);
          }}
          onCancel={() => setAdding(false)}
          onFailure={(failure) => sessionEnded(failure, router.refresh)}
        />
      ) : (
        <div>
          <Button onClick={() => setAdding(true)}>{t("app.setUp")}</Button>
        </div>
      )}
    </section>
  );
}

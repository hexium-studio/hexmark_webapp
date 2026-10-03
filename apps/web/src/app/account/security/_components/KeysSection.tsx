"use client";

import { hasAnyFactor, mayRemoveFactor } from "@hexmark/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/button/Button";
import { KeySupportSlot } from "@/components/two-factor/KeySupportSlot";
import { SecurityKeySetup } from "@/components/two-factor/SecurityKeySetup";
import { KeyItem } from "./KeyItem";
import { SectionHead } from "./SectionHead";
import styles from "./Security.module.css";
import { type FactorSectionProps, sessionEnded } from "./section-props";
import { useFocusOnClose } from "./use-focus-on-close";

const HEADING_ID = "security-keys";

// Security keys: the list with name, when added and last used (in the
// account's time zone), renaming and removing; adding one where the server
// offers keys and the browser can use them. Listed keys can be renamed and
// removed even where new ones cannot be added.
export function KeysSection({ security, counts, onAdded, onRemove }: FactorSectionProps) {
  const t = useTranslations("accountSecurity.keys");
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  useFocusOnClose(adding, HEADING_ID);
  const keys = security.webauthn.credentials;
  const after = { ...counts, webauthn: counts.webauthn - 1 };
  const removable = mayRemoveFactor(security.requireTwoFactor, after);

  return (
    <section className={styles.section} aria-labelledby={HEADING_ID}>
      <SectionHead
        id={HEADING_ID}
        title={t("title")}
        status={keys.length > 0 ? t("count", { count: keys.length }) : t("noneShort")}
        on={keys.length > 0}
      />
      {keys.length > 0 ? (
        <ul className={styles.keys}>
          {keys.map((key) => (
            <KeyItem
              key={key.id}
              credential={key}
              timeZone={security.timezone}
              removable={removable}
              onRemove={() =>
                onRemove({
                  kind: "removeKey",
                  id: key.id,
                  name: key.name,
                  removesLast: !hasAnyFactor(after),
                })
              }
            />
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>{t("none")}</p>
      )}
      <KeySupportSlot offered={security.webauthn.available}>
        {adding ? (
          <SecurityKeySetup
            context="account"
            id="account-key"
            onAdded={(codes) => {
              setAdding(false);
              onAdded("key", codes);
            }}
            onFailure={(failure) => sessionEnded(failure, router.refresh)}
            secondaryAction={
              <Button variant="secondary" onClick={() => setAdding(false)}>
                {t("cancel")}
              </Button>
            }
          />
        ) : (
          <div>
            <Button variant="secondary" onClick={() => setAdding(true)}>
              {t("add")}
            </Button>
          </div>
        )}
      </KeySupportSlot>
    </section>
  );
}

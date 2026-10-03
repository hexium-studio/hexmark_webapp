"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useWebauthnSupport } from "@/lib/two-factor/webauthn-support";
import styles from "./KeySupportSlot.module.css";

export interface KeySupportSlotProps {
  // The server offers security keys (its PUBLIC_ORIGIN is set).
  offered: boolean;
  // What to show where security keys work, e.g. SecurityKeySetup.
  children: ReactNode;
}

// Security key controls where they work, else a short note why not. Whether
// the browser can use WebAuthn is only known after hydration, so while the
// server offers keys, controls and note share one grid cell: the one not
// shown keeps its room invisibly and inert, and nothing below moves when
// the answer arrives.
export function KeySupportSlot({ offered, children }: KeySupportSlotProps) {
  const t = useTranslations("twoFactor.key.unavailable");
  const support = useWebauthnSupport(offered);
  if (support === "server") return <p className={styles.note}>{t("server")}</p>;
  const usable = support === "usable";
  return (
    <div className={styles.slot}>
      <div className={usable ? undefined : styles.concealed} inert={!usable} aria-hidden={!usable}>
        {children}
      </div>
      <p
        className={`${styles.note} ${usable ? styles.concealed : ""}`}
        aria-hidden={usable || undefined}
      >
        {t("browser")}
      </p>
    </div>
  );
}

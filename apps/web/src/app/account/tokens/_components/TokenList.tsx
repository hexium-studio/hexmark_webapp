"use client";

import type { ApiTokenInfo } from "@hexmark/shared";
import { useTranslations } from "next-intl";
import { TokenItem } from "./TokenItem";
import styles from "./Tokens.module.css";

const HEADING_ID = "tokens-list";

export interface TokenListProps {
  tokens: ApiTokenInfo[];
  timeZone: string;
  onRevoke(token: ApiTokenInfo): void;
}

// The account's tokens that are not revoked, newest first (as the server
// lists them), each as a framed row.
export function TokenList({ tokens, timeZone, onRevoke }: TokenListProps) {
  const t = useTranslations("tokens.list");
  return (
    <section className={styles.section} aria-labelledby={HEADING_ID}>
      <div className={styles.sectionHead}>
        <h2 id={HEADING_ID} tabIndex={-1} className={styles.sectionTitle}>
          {t("title")}
        </h2>
        <p className={styles.state}>
          {tokens.length > 0 ? t("count", { count: tokens.length }) : t("noneShort")}
        </p>
      </div>
      {tokens.length > 0 ? (
        <ul className={styles.tokens}>
          {tokens.map((token) => (
            <TokenItem
              key={token.id}
              token={token}
              timeZone={timeZone}
              onRevoke={() => onRevoke(token)}
            />
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>{t("none")}</p>
      )}
    </section>
  );
}

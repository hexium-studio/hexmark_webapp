"use client";

import { type ApiTokenInfo, NOTE_PERMISSIONS } from "@hexmark/shared";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/button/Button";
import styles from "./Tokens.module.css";

export interface TokenItemProps {
  token: ApiTokenInfo;
  timeZone: string;
  onRevoke(): void;
}

// One token: its full name (wrapped, never cut off, so similar names stay
// distinguishable), the first characters of the token for recognising it,
// permissions, access, and when it was created, last used and expires (in
// the account's time zone). "Revoke" names the token for screen readers.
export function TokenItem({ token, timeZone, onRevoke }: TokenItemProps) {
  const t = useTranslations("tokens");
  const format = useFormatter();
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short", timeZone });
  const permissions = NOTE_PERMISSIONS.filter((permission) =>
    token.permissions.includes(permission),
  );
  const scope = token.folderScope
    ? token.folderScope.map((folder) => folder.path ?? t("list.deletedFolder")).join(", ")
    : t("list.wholeWiki");
  const expired = token.expiresAt !== null && Date.parse(token.expiresAt) <= Date.now();
  const expires = token.expiresAt
    ? expired
      ? t("list.expired", { date: when(token.expiresAt) })
      : when(token.expiresAt)
    : t("list.noExpiry");

  return (
    <li className={styles.token}>
      <p className={styles.tokenName}>{token.name}</p>
      <dl className={styles.facts}>
        <div>
          <dt>{t("list.token")}</dt>
          <dd>
            <code>{token.prefix}…</code>
          </dd>
        </div>
        <div>
          <dt>{t("list.permissions")}</dt>
          <dd>{permissions.map((permission) => t(`permissions.${permission}`)).join(", ")}</dd>
        </div>
        <div>
          <dt>{t("list.scope")}</dt>
          <dd>{scope}</dd>
        </div>
        <div>
          <dt>{t("list.created")}</dt>
          <dd>{when(token.createdAt)}</dd>
        </div>
        <div>
          <dt>{t("list.lastUsed")}</dt>
          <dd>{token.lastUsedAt ? when(token.lastUsedAt) : t("list.neverUsed")}</dd>
        </div>
        <div>
          <dt>{t("list.expires")}</dt>
          <dd>{expires}</dd>
        </div>
      </dl>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={onRevoke}>
          {t("list.revoke")}
          <span className="visually-hidden"> {token.name}</span>
        </Button>
      </div>
    </li>
  );
}

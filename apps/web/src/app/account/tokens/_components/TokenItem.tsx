"use client";

import { type ApiTokenInfo, NOTE_PERMISSIONS, type NotePermission } from "@hexmark/shared";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/button/Button";
import access from "./Access.module.css";
import styles from "./Tokens.module.css";

export interface TokenItemProps {
  token: ApiTokenInfo;
  timeZone: string;
  onEdit(): void;
  onRevoke(): void;
}

// One token: its full name (wrapped, never cut off, so similar names stay
// distinguishable), the first characters of the token for recognising it,
// its access (mode, permissions, targets), and when it was created, last
// used and expires (in the account's time zone). The buttons name the token
// for screen readers.
export function TokenItem({ token, timeZone, onEdit, onRevoke }: TokenItemProps) {
  const t = useTranslations("tokens");
  const format = useFormatter();
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short", timeZone });
  const names = (list: readonly NotePermission[] | null) =>
    NOTE_PERMISSIONS.filter((permission) => list?.includes(permission))
      .map((permission) => t(`permissions.${permission}`))
      .join(", ");
  const expired = token.expiresAt !== null && Date.parse(token.expiresAt) <= Date.now();
  const expires = token.expiresAt
    ? expired
      ? t("list.expired", { date: when(token.expiresAt) })
      : when(token.expiresAt)
    : t("list.noExpiry");
  const allow = token.mode === "allow_list";

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
          <dt>{t("list.mode")}</dt>
          <dd>{t(`form.access.${token.mode}.label`)}</dd>
        </div>
        {allow ? null : (
          <div>
            <dt>{t("list.permissions")}</dt>
            <dd>{names(token.basePermissions)}</dd>
          </div>
        )}
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
      <div className={styles.facts}>
        <p className={styles.legend}>{allow ? t("list.allowed") : t("list.excluded")}</p>
        {token.entries.length === 0 ? (
          <p className={styles.muted}>{allow ? t("list.noneAllowed") : t("list.wholeWiki")}</p>
        ) : (
          <ul className={access.entrySummary}>
            {token.entries.map((entry) => (
              <li key={entry.id}>
                <span className={access.entryKind}>{t(`kinds.${entry.kind}`)}</span>{" "}
                <span className={styles.folderPath}>{entry.path}</span>
                {entry.targetTrashed ? ` (${t("form.access.inTrash")})` : ""}
                {allow ? ` – ${names(entry.permissions)}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={onEdit}>
          {t("list.edit")}
          <span className="visually-hidden"> {token.name}</span>
        </Button>
        <Button variant="secondary" onClick={onRevoke}>
          {t("list.revoke")}
          <span className="visually-hidden"> {token.name}</span>
        </Button>
      </div>
    </li>
  );
}

"use client";

import type { ApiTokenInfo, AuthUser, McpServersConfig } from "@hexmark/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { CardShell } from "@/components/card-shell/CardShell";
import { FormAlert } from "@/components/form-alert/FormAlert";
import { toast } from "@/components/toast/toast-store";
import type { TokensPageData } from "@/lib/api-tokens/load";
import { CreatedToken } from "./CreatedToken";

import { RevokeDialog } from "./RevokeDialog";
import { TokenForm } from "./TokenForm";
import { TokenList } from "./TokenList";
import styles from "./Tokens.module.css";

const TITLE_ID = "tokens-title";

export interface TokensPageProps {
  user: AuthUser;
  // Undefined when the server gave no usable answer.
  data: TokensPageData | undefined;
}

interface Created {
  name: string;
  config: McpServersConfig;
}

// The token page: the list (revoke with a confirmation), the create form
// and, right after creating, the one-time view of the new token's MCP
// configuration in place of the rest; changing a token's access shows its
// form in place of the list. The token lives only in this
// component's state: "Done", leaving or reloading the page drops it, and
// nothing can fetch it again.
export function TokensPage({ user, data }: TokensPageProps) {
  const t = useTranslations("tokens");
  const router = useRouter();
  const [created, setCreated] = useState<Created | null>(null);
  const [revoking, setRevoking] = useState<ApiTokenInfo | null>(null);
  const [editing, setEditing] = useState<ApiTokenInfo | null>(null);
  const backToList = () => {
    setEditing(null);
    requestAnimationFrame(() => document.getElementById(TITLE_ID)?.focus());
  };
  const [confirmedUntil, setConfirmedUntil] = useState<string | null>(null);

  const links = (
    <div className={styles.links}>
      <a href="/" className={styles.link}>
        {t("home")}
      </a>
      <a href="/account/security" className={styles.link}>
        {t("securityLink")}
      </a>
    </div>
  );

  if (!data) {
    return (
      <CardShell width="wide" title={t("title")}>
        <FormAlert title={t("unavailable.title")}>
          <p>{t("unavailable.detail")}</p>
        </FormAlert>
        {links}
      </CardShell>
    );
  }

  return (
    <CardShell width="wide" title={t("title")} titleId={TITLE_ID} lead={t("lead")}>
      {created ? (
        <CreatedToken
          name={created.name}
          config={created.config}
          onDone={() => {
            setCreated(null);
            requestAnimationFrame(() => document.getElementById(TITLE_ID)?.focus());
          }}
        />
      ) : editing ? (
        <TokenForm
          key={editing.id}
          role={user.role}
          token={editing}
          tree={data.tree}
          timeZone={data.timezone}
          reauthenticatedUntil={confirmedUntil ?? data.reauthenticatedUntil}
          onReauthenticated={setConfirmedUntil}
          onCancel={backToList}
          onUpdated={() => {
            toast.success({ title: t("done.updated") });
            backToList();
            router.refresh();
          }}
        />
      ) : (
        <>
          <TokenList
            tokens={data.tokens}
            timeZone={data.timezone}
            onEdit={setEditing}
            onRevoke={setRevoking}
          />
          <TokenForm
            role={user.role}
            tree={data.tree}
            timeZone={data.timezone}
            reauthenticatedUntil={confirmedUntil ?? data.reauthenticatedUntil}
            onReauthenticated={setConfirmedUntil}
            onCreated={(info, config) => {
              setCreated({ name: info.name, config });
              toast.success({ title: t("done.created") });
              router.refresh();
            }}
          />
          {links}
        </>
      )}
      <RevokeDialog
        token={revoking}
        onClose={() => setRevoking(null)}
        onDone={() => {
          setRevoking(null);
          toast.success({ title: t("done.revoked") });
          router.refresh();
        }}
      />
    </CardShell>
  );
}

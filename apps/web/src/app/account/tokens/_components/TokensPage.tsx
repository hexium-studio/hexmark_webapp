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
import { CreateTokenForm } from "./CreateTokenForm";
import { RevokeDialog } from "./RevokeDialog";
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
// configuration in place of the rest. The token lives only in this
// component's state: "Done", leaving or reloading the page drops it, and
// nothing can fetch it again.
export function TokensPage({ user, data }: TokensPageProps) {
  const t = useTranslations("tokens");
  const router = useRouter();
  const [created, setCreated] = useState<Created | null>(null);
  const [revoking, setRevoking] = useState<ApiTokenInfo | null>(null);
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
      ) : (
        <>
          <TokenList tokens={data.tokens} timeZone={data.timezone} onRevoke={setRevoking} />
          <CreateTokenForm
            role={user.role}
            folders={data.folders}
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

"use client";

import {
  API_TOKEN_NAME_MAX_LENGTH,
  type ApiTokenInfo,
  type McpServersConfig,
  type UserRole,
} from "@hexmark/shared";
import { useTranslations } from "next-intl";
import { type FormEvent, useRef } from "react";
import { Button } from "@/components/button/Button";
import { FieldFrame, fieldA11yProps } from "@/components/field/FieldFrame";
import { TextField } from "@/components/field/TextField";
import selectStyles from "@/components/language-select/LanguageSelect.module.css";
import type { FolderChoice } from "@/lib/api-tokens/folders";
import { PermissionFields } from "./PermissionFields";
import { ReauthDialog } from "./ReauthDialog";
import { ScopeFields } from "./ScopeFields";
import styles from "./Tokens.module.css";
import { EXPIRY_DAYS, type ExpiryDays } from "./token-draft";
import { useCreateToken } from "./use-create-token";

const HEADING_ID = "tokens-new";

export interface CreateTokenFormProps {
  role: UserRole;
  folders: FolderChoice[];
  reauthenticatedUntil: string | null;
  onReauthenticated(until: string): void;
  onCreated(info: ApiTokenInfo, config: McpServersConfig): void;
}

// Name, permissions, access and expiry of a new token. Every message has
// its reserved slot under its field, so nothing moves when one appears.
export function CreateTokenForm(props: CreateTokenFormProps) {
  const t = useTranslations("tokens.form");
  const tErrors = useTranslations("errors.fields.tokenName");
  const form = useCreateToken(props);
  const { values, set, errors } = form;
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = form.submit();
    // Focus the first field the check refused.
    const first = found.name
      ? "#token-name"
      : found.permissions
        ? "#token-permissions input"
        : found.folders
          ? "#token-folders input"
          : null;
    if (first) formRef.current?.querySelector<HTMLElement>(first)?.focus();
  }

  const expiryHint = t("expiry.hint");
  return (
    <section className={styles.section} aria-labelledby={HEADING_ID}>
      <h2 id={HEADING_ID} className={styles.sectionTitle}>
        {t("title")}
      </h2>
      <form ref={formRef} className={styles.form} noValidate onSubmit={handleSubmit}>
        <TextField
          id="token-name"
          name="name"
          label={t("name.label")}
          hint={t("name.hint", { max: API_TOKEN_NAME_MAX_LENGTH })}
          error={errors.name}
          reserve={[tErrors("required"), tErrors("taken"), tErrors("invalid_format")]}
          value={values.name}
          maxLength={API_TOKEN_NAME_MAX_LENGTH}
          autoComplete="off"
          onChange={(event) => set.name(event.currentTarget.value)}
        />
        <PermissionFields
          role={props.role}
          value={values.permissions}
          error={errors.permissions}
          onChange={set.permissions}
        />
        <ScopeFields
          folders={props.folders}
          scoped={values.scoped}
          selected={values.folders}
          error={errors.folders}
          onScopedChange={set.scoped}
          onSelectedChange={set.folders}
        />
        <FieldFrame id="token-expiry" label={t("expiry.label")} hint={expiryHint}>
          <select
            className={selectStyles.select}
            value={values.expiryDays ?? ""}
            onChange={(event) => {
              const days = Number(event.currentTarget.value);
              set.expiryDays((EXPIRY_DAYS.find((value) => value === days) ?? null) as ExpiryDays);
            }}
            {...fieldA11yProps("token-expiry", expiryHint, undefined)}
          >
            <option value="">{t("expiry.never")}</option>
            {EXPIRY_DAYS.map((days) => (
              <option key={days} value={days}>
                {t("expiry.days", { count: days })}
              </option>
            ))}
          </select>
        </FieldFrame>
        <div>
          <Button type="submit" pending={form.isPending}>
            {form.isPending ? t("working") : t("submit")}
          </Button>
        </div>
      </form>
      <ReauthDialog
        open={form.confirming}
        onClose={form.closeConfirm}
        onConfirmed={(until) => {
          props.onReauthenticated(until);
          form.confirmed();
        }}
      />
    </section>
  );
}

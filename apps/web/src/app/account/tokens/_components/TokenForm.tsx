"use client";

import { API_TOKEN_NAME_MAX_LENGTH, type ApiTokenInfo } from "@hexmark/shared";
import { useFormatter, useTranslations } from "next-intl";
import { type FormEvent, useRef } from "react";
import { Button } from "@/components/button/Button";
import { FieldFrame, fieldA11yProps } from "@/components/field/FieldFrame";
import { TextField } from "@/components/field/TextField";
import selectStyles from "@/components/language-select/LanguageSelect.module.css";
import type { PickerTree } from "@/lib/api-tokens/tree";
import { AccessFields, BASE_ID } from "./AccessFields";
import { ENTRIES_ID } from "./EntryList";
import { MODE_ID } from "./ModeFields";
import { ReauthDialog } from "./ReauthDialog";
import styles from "./Tokens.module.css";
import { EXPIRY_DAYS, type ExpiryChoice } from "./token-draft";
import { type TokenFormOptions, useTokenForm } from "./use-token-form";

export interface TokenFormProps extends TokenFormOptions {
  tree: PickerTree;
  timeZone: string;
  onReauthenticated(until: string): void;
  onCancel?(): void;
}

// A new token (name, access, expiry) or the access and expiry of an
// existing one. Every message has its reserved slot under its field, so
// nothing moves when one appears; the first field refused gets the focus.
export function TokenForm(props: TokenFormProps) {
  const t = useTranslations("tokens.form");
  const tErrors = useTranslations("errors.fields.tokenName");
  const format = useFormatter();
  const form = useTokenForm(props);
  const { values, set, errors } = form;
  const formRef = useRef<HTMLFormElement>(null);
  const editing: ApiTokenInfo | undefined = props.token;
  const headingId = editing ? "tokens-edit" : "tokens-new";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = form.submit();
    const first = found.name
      ? "#token-name"
      : found.mode
        ? `#${MODE_ID} input`
        : found.basePermissions
          ? `#${BASE_ID} input`
          : found.entries
            ? `#${ENTRIES_ID} input, #token-tree input`
            : null;
    if (first) formRef.current?.querySelector<HTMLElement>(first)?.focus();
  }

  const expiryHint = t("expiry.hint");
  const current = editing?.expiresAt
    ? format.dateTime(new Date(editing.expiresAt), {
        dateStyle: "medium",
        timeZone: props.timeZone,
      })
    : t("expiry.never");
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} tabIndex={-1} className={styles.sectionTitle}>
        {editing ? t("editTitle", { name: editing.name }) : t("title")}
      </h2>
      <form ref={formRef} className={styles.form} noValidate onSubmit={handleSubmit}>
        {editing ? null : (
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
        )}
        <AccessFields
          role={props.role}
          tree={props.tree}
          access={values.access}
          errors={errors}
          set={set}
        />
        <FieldFrame id="token-expiry" label={t("expiry.label")} hint={expiryHint}>
          <select
            className={selectStyles.select}
            value={values.expiry ?? ""}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              const days = EXPIRY_DAYS.find((value) => value === Number(raw)) ?? null;
              set.expiry((raw === "keep" ? "keep" : days) as ExpiryChoice);
            }}
            {...fieldA11yProps("token-expiry", expiryHint, undefined)}
          >
            {editing ? <option value="keep">{t("expiry.keep", { current })}</option> : null}
            <option value="">{t("expiry.never")}</option>
            {EXPIRY_DAYS.map((days) => (
              <option key={days} value={days}>
                {t("expiry.days", { count: days })}
              </option>
            ))}
          </select>
        </FieldFrame>
        <div className={styles.actions}>
          <Button type="submit" pending={form.isPending}>
            {form.isPending ? t("working") : editing ? t("save") : t("submit")}
          </Button>
          {props.onCancel ? (
            <Button variant="secondary" onClick={props.onCancel}>
              {t("cancel")}
            </Button>
          ) : null}
        </div>
      </form>
      <ReauthDialog
        open={form.confirming}
        purpose={editing ? "update" : "create"}
        onClose={form.closeConfirm}
        onConfirmed={(until) => {
          props.onReauthenticated(until);
          form.confirmed();
        }}
      />
    </section>
  );
}

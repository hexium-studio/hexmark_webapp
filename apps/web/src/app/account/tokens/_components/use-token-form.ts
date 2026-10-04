"use client";

import {
  type ApiTokenAccessMode,
  type ApiTokenInfo,
  apiTokenNameSchema,
  type McpServersConfig,
  type NotePermission,
  type UserRole,
} from "@hexmark/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useFieldErrorText } from "@/components/field/use-field-error-text";
import { isRecentlyConfirmed } from "@/components/reauthentication/recent";
import { defaultPermissions } from "@/lib/api-tokens/offered-permissions";
import type { PickedTarget } from "./TargetTree";
import { createApiToken, updateApiToken } from "./token-actions";
import {
  type AccessDraft,
  accessProblems,
  type DraftEntry,
  draftOf,
  type ExpiryChoice,
} from "./token-draft";
import { useTokenToast } from "./use-token-toast";

export interface FormErrors {
  name?: string;
  mode?: string;
  basePermissions?: string;
  entries?: string;
}

export interface TokenFormOptions {
  role: UserRole;
  // Set when an existing token is changed; a new one otherwise.
  token?: ApiTokenInfo;
  reauthenticatedUntil: string | null;
  onCreated?(info: ApiTokenInfo, config: McpServersConfig): void;
  onUpdated?(info: ApiTokenInfo): void;
}

const EMPTY: AccessDraft = { mode: null, basePermissions: [], entries: [] };

// State and submit of the token form, for a new token and for changing one.
// Rules are checked on submit (the hints say them before); a password
// confirmation older than 10 minutes opens the confirmation dialog first.
// Field refusals from the server go to their field's slot, the rest become
// toasts. Choosing another mode starts an empty list: a target means the
// opposite in the other mode.
export function useTokenForm(options: TokenFormOptions) {
  const { role, token } = options;
  const t = useTranslations("tokens.form");
  const router = useRouter();
  const fieldText = useFieldErrorText();
  const showError = useTokenToast();
  const [name, setName] = useState("");
  const [access, setAccess] = useState<AccessDraft>(() => (token ? draftOf(token) : EMPTY));
  const [expiry, setExpiry] = useState<ExpiryChoice>(token ? "keep" : null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const clear = (field: keyof FormErrors) =>
    setErrors((current) => ({ ...current, [field]: undefined }));

  function check(): FormErrors {
    const found: FormErrors = {};
    if (!token) {
      const parsed = apiTokenNameSchema.safeParse(name);
      if (!parsed.success) {
        const code = parsed.error.issues[0]?.message ?? "invalid";
        found.name = fieldText("tokenName", { code: code as "invalid" });
      }
    }
    const problems = accessProblems(access);
    if (problems.mode) found.mode = t(`access.${problems.mode}`);
    if (problems.basePermissions) found.basePermissions = t(`access.${problems.basePermissions}`);
    if (problems.entries) found.entries = t(`access.${problems.entries}`);
    return found;
  }

  function send() {
    startTransition(async () => {
      const result = token
        ? await updateApiToken(token.id, { access, expiry })
        : await createApiToken({ name, access, expiry });
      if (result.ok) {
        if ("config" in result) {
          return options.onCreated?.(result.info, result.config as McpServersConfig);
        }
        return options.onUpdated?.(result.info);
      }
      if (result.error === "reauthentication_required") return setConfirming(true);
      const { name: nameError, mode, basePermissions, entries } = result.fields;
      if (nameError || mode || basePermissions || entries) {
        return setErrors({
          name: nameError && fieldText("tokenName", nameError),
          mode: mode && t("access.modeMissing"),
          basePermissions: basePermissions && t("access.permissionsMissing"),
          entries: entries && t("access.entriesRefused"),
        });
      }
      showError(result.error);
      if (result.error !== "validation") router.refresh();
    });
  }

  function submit(): FormErrors {
    if (isPending) return {};
    const found = check();
    setErrors(found);
    if (Object.values(found).some(Boolean)) return found;
    if (isRecentlyConfirmed(options.reauthenticatedUntil)) send();
    else setConfirming(true);
    return found;
  }

  const setEntries = (update: (entries: DraftEntry[]) => DraftEntry[]) => {
    setAccess((current) => ({ ...current, entries: update(current.entries) }));
    clear("entries");
  };

  return {
    values: { name, access, expiry },
    set: {
      name: (value: string) => {
        setName(value);
        clear("name");
      },
      mode: (mode: ApiTokenAccessMode) => {
        if (mode === access.mode) return;
        const base = mode === "deny_list" ? defaultPermissions(role) : [];
        setAccess({ mode, basePermissions: base, entries: [] });
        setErrors((current) => ({ ...current, mode: undefined, entries: undefined }));
      },
      basePermissions: (value: NotePermission[]) => {
        setAccess((current) => ({ ...current, basePermissions: value }));
        clear("basePermissions");
      },
      target: (target: PickedTarget, on: boolean) =>
        setEntries((entries) => {
          const rest = entries.filter((e) => e.kind !== target.kind || e.id !== target.id);
          if (!on) return rest;
          const permissions =
            access.mode === "allow_list" ? defaultPermissions(role, target.kind) : [];
          return [...rest, { ...target, permissions }];
        }),
      entryPermissions: (entry: DraftEntry, permissions: NotePermission[]) =>
        setEntries((entries) =>
          entries.map((e) =>
            e.kind === entry.kind && e.id === entry.id ? { ...e, permissions } : e,
          ),
        ),
      expiry: setExpiry,
    },
    errors,
    isPending,
    confirming,
    closeConfirm: () => setConfirming(false),
    // After the password was confirmed in the dialog.
    confirmed: () => {
      setConfirming(false);
      send();
    },
    submit,
  };
}

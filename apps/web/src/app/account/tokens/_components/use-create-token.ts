"use client";

import {
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
import { createApiToken } from "./token-actions";
import type { ExpiryDays, TokenDraft } from "./token-draft";
import { useTokenToast } from "./use-token-toast";

export interface FormErrors {
  name?: string;
  permissions?: string;
  folders?: string;
}

export interface CreateTokenOptions {
  role: UserRole;
  reauthenticatedUntil: string | null;
  onCreated(info: ApiTokenInfo, config: McpServersConfig): void;
}

// State and submit of the create form. Rules are checked on submit (the
// hints list them before); a password confirmation older than 10 minutes
// opens the confirmation dialog first, and the token is created once it
// succeeds. Field refusals from the server go to their field's slot, the
// rest become toasts.
export function useCreateToken({ role, reauthenticatedUntil, onCreated }: CreateTokenOptions) {
  const t = useTranslations("tokens.form");
  const router = useRouter();
  const fieldText = useFieldErrorText();
  const showError = useTokenToast();
  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState<NotePermission[]>(() => defaultPermissions(role));
  const [scoped, setScoped] = useState(false);
  const [folders, setFolders] = useState<string[]>([]);
  const [expiryDays, setExpiryDays] = useState<ExpiryDays>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  const draft = (): TokenDraft => ({
    name,
    permissions,
    folderScope: scoped ? folders : null,
    expiryDays,
  });

  function check(): FormErrors {
    const found: FormErrors = {};
    const parsed = apiTokenNameSchema.safeParse(name);
    if (!parsed.success) {
      const code = parsed.error.issues[0]?.message ?? "invalid";
      found.name = fieldText("tokenName", { code: code as "invalid" });
    }
    if (permissions.length === 0) found.permissions = t("permissions.missing");
    if (scoped && folders.length === 0) found.folders = t("scope.foldersMissing");
    return found;
  }

  function create() {
    startTransition(async () => {
      const result = await createApiToken(draft());
      if (result.ok) return onCreated(result.info, result.config);
      if (result.error === "reauthentication_required") return setConfirming(true);
      const { name: nameError, permissions: permissionsError, folderScope } = result.fields;
      if (nameError || permissionsError || folderScope) {
        return setErrors({
          name: nameError && fieldText("tokenName", nameError),
          permissions: permissionsError && fieldText("permissions", permissionsError),
          folders: folderScope && fieldText("folderScope", folderScope),
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
    if (Object.keys(found).length > 0) return found;
    if (isRecentlyConfirmed(reauthenticatedUntil)) create();
    else setConfirming(true);
    return found;
  }

  return {
    values: { name, permissions, scoped, folders, expiryDays },
    set: {
      name: (value: string) => {
        setName(value);
        setErrors((current) => ({ ...current, name: undefined }));
      },
      permissions: (value: NotePermission[]) => {
        setPermissions(value);
        setErrors((current) => ({ ...current, permissions: undefined }));
      },
      scoped: setScoped,
      folders: (value: string[]) => {
        setFolders(value);
        setErrors((current) => ({ ...current, folders: undefined }));
      },
      expiryDays: setExpiryDays,
    },
    errors,
    isPending,
    confirming,
    closeConfirm: () => setConfirming(false),
    // After the password was confirmed in the dialog.
    confirmed: () => {
      setConfirming(false);
      create();
    },
    submit,
  };
}

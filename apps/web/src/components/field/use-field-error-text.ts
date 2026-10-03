import type { FieldError } from "@hexmark/shared";
import { useTranslations } from "next-intl";
import type { Messages } from "@/lib/locales/registry";

// Text of a field error code (@hexmark/shared), with its params as
// placeholders. A field may word a code its own way ("errors.fields.<field>.<code>",
// e.g. "Enter a display name." for `required`); otherwise the generic
// "errors.<code>" applies.

type FieldMessages = Messages["errors"]["fields"];

// Every "fields.<field>.<code>" key that exists in the message files.
type FieldMessageKey = {
  [Field in keyof FieldMessages]: `fields.${Field}.${keyof FieldMessages[Field] & string}`;
}[keyof FieldMessages];

export function useFieldErrorText(): (field: string, error: FieldError) => string {
  const t = useTranslations("errors");
  return (field, error) => {
    // Field names arrive from the API at run time; t.has checks the key.
    const specific = `fields.${field}.${error.code}` as FieldMessageKey;
    return t.has(specific) ? t(specific, error.params) : t(error.code, error.params);
  };
}

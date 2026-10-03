import { useTranslations } from "next-intl";
import { ButtonLink } from "@/components/button/ButtonLink";
import { CardShell } from "@/components/card-shell/CardShell";
import { InstructionList } from "@/components/instruction-list/InstructionList";
import { RICH_TAGS } from "@/lib/rich-tags";
import styles from "./SignInBlocked.module.css";

// Shown instead of the sign-in form while SETUP_TOKEN is still set on the
// server (the API refuses every sign-in then): the steps to remove it, the
// same as on the setup completion page, and a reload. Like the sign-in form
// it has no language picker; the wider card leaves room for the commands.
export function SignInBlocked() {
  const t = useTranslations("auth.signInBlocked");
  return (
    <CardShell
      width="wide"
      kickerTone="danger"
      kicker={
        <>
          <svg className={styles.icon} viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M8 1.75 14.75 13.5H1.25Z M8 6v3.5 M8 11.25v.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
          <span>{t("kicker")}</span>
        </>
      }
      title={t("title")}
      lead={t.rich("lead", RICH_TAGS)}
    >
      <InstructionList
        items={[
          t.rich("steps.removeToken", RICH_TAGS),
          t.rich("steps.restart", RICH_TAGS),
          t.rich("steps.reload", RICH_TAGS),
        ]}
      />
      {/* A full page load: the server is asked again whether sign-in is open. */}
      <ButtonLink href="/" className={styles.reload}>
        {t("reload")}
      </ButtonLink>
    </CardShell>
  );
}

import { useTranslations } from "next-intl";
import { ButtonLink } from "@/components/button/ButtonLink";
import { FormAlert } from "@/components/form-alert/FormAlert";
import { LanguageSwitch } from "@/components/language-switch/LanguageSwitch";
import { PageHeading } from "@/components/page-heading/PageHeading";
import { PageShell } from "@/components/page-shell/PageShell";
import { StatusIcon } from "@/components/status-icon/StatusIcon";
import { StepList } from "@/components/step-list/StepList";
import type { LocaleInfo } from "@/lib/locales/locale-info";
import { RICH_TAGS } from "@/lib/rich-tags";
import { SETUP_STEP_IDS, setupProgress } from "@/lib/setup-steps";
import styles from "./SetupComplete.module.css";

export interface SetupCompleteProps {
  // False when the server or database did not answer, so it is unknown
  // whether SETUP_TOKEN has been removed yet.
  statusConfirmed: boolean;
  locales: readonly LocaleInfo[];
}

const HEADING_ID = "remove-token-heading";

export function SetupComplete({ statusConfirmed, locales }: SetupCompleteProps) {
  const t = useTranslations("setupComplete");
  const tSetup = useTranslations("setup");
  return (
    <PageShell
      title={t("title")}
      lead={t("lead")}
      progress={
        <StepList
          items={setupProgress(SETUP_STEP_IDS.length, (id) => tSetup(`steps.${id}.title`))}
          label={tSetup("progressLabel")}
        />
      }
      tools={<LanguageSwitch locales={locales} />}
    >
      <section className={styles.section} aria-labelledby={HEADING_ID}>
        <PageHeading
          id={HEADING_ID}
          kicker={
            <span className={styles.success}>
              <StatusIcon kind="pass" className={styles.successIcon} />
              <span className={styles.successText}>{t("created")}</span>
            </span>
          }
          title={t("heading")}
          intro={t.rich("intro", RICH_TAGS)}
        />
        {statusConfirmed ? null : (
          <FormAlert tone="info" title={t("serverDownTitle")}>
            <p>{t("serverDownDetail")}</p>
          </FormAlert>
        )}
        <ol className={styles.list}>
          <li>{t.rich("instructions.removeToken", RICH_TAGS)}</li>
          <li>{t.rich("instructions.restart", RICH_TAGS)}</li>
          <li>{t.rich("instructions.reload", RICH_TAGS)}</li>
        </ol>
        <div>
          <ButtonLink href="/setup/complete">{t("reload")}</ButtonLink>
        </div>
      </section>
    </PageShell>
  );
}

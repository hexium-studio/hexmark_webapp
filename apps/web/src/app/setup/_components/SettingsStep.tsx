"use client";

import { factorCounts, hasAnyFactor } from "@hexmark/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useSyncExternalStore, useTransition } from "react";
import { Button } from "@/components/button/Button";
import { useFieldErrorText } from "@/components/field/use-field-error-text";
import { Switch } from "@/components/switch/Switch";
import { useFactorToast } from "@/components/two-factor/use-factor-toast";
import { browserTimezone, UTC_ZONE } from "@/lib/timezones";
import styles from "./Settings.module.css";
import stepStyles from "./Step.module.css";
import { saveSystemSettings } from "./settings-actions";
import { TicketProblem } from "./TicketProblem";
import { TimezoneSelect } from "./TimezoneSelect";
import type { StepProps } from "./wizard-types";

const noSubscription = () => () => {};

// Step 6: the instance's default time zone (preselected: the browser's) and
// whether every account must have a second factor. Requiring one is offered
// only when the admin has one (the server refuses it otherwise, so the
// admin cannot lock themselves out); without, the switch is off and
// disabled, with the way back to step 5. "Finish setup" saves both, uses
// the setup ticket up and leads to the completion page.
export function SettingsStep({ wizard }: StepProps) {
  const t = useTranslations("setup.settings");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const fieldErrorText = useFieldErrorText();
  const showError = useFactorToast();
  const detected = useSyncExternalStore(noSubscription, browserTimezone, () => UTC_ZONE);
  const [chosen, setChosen] = useState<string>();
  const [requireTwoFactor, setRequireTwoFactor] = useState(false);
  const [timezoneError, setTimezoneError] = useState<string>();
  const [expired, setExpired] = useState(false);
  const [isPending, startTransition] = useTransition();
  const timezone = chosen ?? detected;

  const { ticket } = wizard;
  if (expired || ticket.kind === "expired") return <TicketProblem kind="expired" />;
  if (ticket.kind !== "active") return <TicketProblem kind="unavailable" />;
  const adminHasFactor = hasAnyFactor(factorCounts(ticket.overview));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    startTransition(async () => {
      // Resolves only on failure: success redirects to /setup/complete.
      const failure = await saveSystemSettings({
        timezone,
        requireTwoFactor: requireTwoFactor && adminHasFactor,
      });
      const field = failure.fields.timezone;
      if (field) return setTimezoneError(fieldErrorText("timezone", field));
      if (failure.error === "challenge_invalid") return setExpired(true);
      showError(failure.error);
      // The factors changed elsewhere: show the current state.
      if (failure.error === "second_factor_missing") router.refresh();
    });
  }

  return (
    <form className={stepStyles.form} noValidate onSubmit={handleSubmit}>
      <TimezoneSelect
        id="settings-timezone"
        value={timezone}
        error={timezoneError}
        onChange={(zone) => {
          setChosen(zone);
          setTimezoneError(undefined);
        }}
      />
      <div className={styles.requirement}>
        <Switch
          id="settings-require-two-factor"
          name="requireTwoFactor"
          label={t("require.label")}
          hint={adminHasFactor ? t("require.hint") : t("require.needsFactor")}
          checked={requireTwoFactor && adminHasFactor}
          disabled={!adminHasFactor}
          onChange={(event) => setRequireTwoFactor(event.currentTarget.checked)}
        />
        {adminHasFactor ? null : (
          <Button variant="secondary" onClick={wizard.back}>
            {t("require.backToStep")}
          </Button>
        )}
      </div>
      <div className={stepStyles.actions}>
        <Button variant="secondary" onClick={wizard.back}>
          {tCommon("back")}
        </Button>
        <Button type="submit" pending={isPending}>
          {isPending ? t("finishing") : t("finish")}
        </Button>
      </div>
    </form>
  );
}

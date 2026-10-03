"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/button/Button";
import { Checkbox } from "@/components/checkbox/Checkbox";
import { browserTimezone } from "@/lib/timezones";
import {
  downloadText,
  RECOVERY_CODES_FILENAME,
  recoveryCodesFile,
} from "@/lib/two-factor/recovery-file";
import { CopyButton } from "./CopyButton";
import styles from "./RecoveryCodes.module.css";

export interface RecoveryCodesProps {
  codes: readonly string[];
  // Id of the heading (an h2 or h3, rendered by the caller), which names the list.
  labelledBy: string;
  // Named in the downloaded file, e.g. the e-mail address.
  account?: string;
  // Time zone for the "Created" line of the file; the browser's by default.
  timeZone?: string;
  // Label of the button that leaves this view ("Continue", "Done").
  doneLabel: string;
  onDone(): void;
}

// New recovery codes, shown only this once: the list, "Copy all",
// "Download" (hexmark-recovery-codes.txt) and a confirmation that they are
// saved, which the button to go on waits for.

// Columns of the code list where there is room: a number that fills every
// row, so no cell stays empty (one column in narrow spaces).
function wideColumns(count: number): 1 | 2 | 3 {
  if (count % 3 === 0) return 3;
  if (count % 2 === 0) return 2;
  return 1;
}

export function RecoveryCodes(props: RecoveryCodesProps) {
  const { codes, labelledBy, account, timeZone, doneLabel, onDone } = props;
  const t = useTranslations("twoFactor.recovery");
  const format = useFormatter();
  const [saved, setSaved] = useState(false);
  const allCodes = codes.join("\n");

  function download() {
    const created = format.dateTime(new Date(), {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: timeZone ?? browserTimezone(),
    });
    const text = recoveryCodesFile(codes, {
      title: t("file.title"),
      account: account ? t("file.account", { account }) : undefined,
      created: t("file.created", { date: created }),
      notes: [t("file.singleUse"), t("file.keepSafe")],
    });
    downloadText(text, RECOVERY_CODES_FILENAME);
  }

  return (
    <div className={styles.view}>
      <p className={styles.notice}>
        <strong>{t("onceTitle")}</strong> {t("onceDetail")}
      </p>
      <ol
        className={styles.codes}
        data-columns={wideColumns(codes.length)}
        aria-labelledby={labelledBy}
      >
        {codes.map((code) => (
          <li key={code} className={styles.code}>
            <code>{code}</code>
          </li>
        ))}
      </ol>
      <div className={styles.actions}>
        <CopyButton text={allCodes} label={t("copyAll")} copiedTitle={t("copied")} />
        <Button variant="secondary" onClick={download}>
          {t("download")}
        </Button>
      </div>
      <Checkbox
        name="recovery-codes-saved"
        label={t("savedConfirm")}
        checked={saved}
        onChange={(event) => setSaved(event.currentTarget.checked)}
      />
      <div>
        <Button
          disabled={!saved}
          onClick={onDone}
          aria-describedby={saved ? undefined : `${labelledBy}-reason`}
        >
          {doneLabel}
        </Button>
        {saved ? null : (
          <span id={`${labelledBy}-reason`} className="visually-hidden">
            {t("savedFirst")}
          </span>
        )}
      </div>
    </div>
  );
}

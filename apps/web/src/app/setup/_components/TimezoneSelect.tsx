"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { FieldFrame, fieldA11yProps } from "@/components/field/FieldFrame";
import selectStyles from "@/components/language-select/LanguageSelect.module.css";
import { supportedTimezones, timezoneGroups } from "@/lib/timezones";
import styles from "./Settings.module.css";

export interface TimezoneSelectProps {
  id: string;
  value: string;
  onChange(zone: string): void;
  error?: string;
}

// Every time zone the browser knows plus "UTC", in groups by region
// (lib/timezones.ts). A native select: keyboard, type-ahead and mobile
// pickers work without extra code. Region names are translated where the
// messages have them; zone names stay as IANA spells them.
export function TimezoneSelect({ id, value, onChange, error }: TimezoneSelectProps) {
  const t = useTranslations("setup.settings.timezone");
  const groups = useMemo(() => timezoneGroups(supportedTimezones(), [value]), [value]);
  const regionLabel = (region: string) => {
    const key = `regions.${region}` as "regions.Europe";
    return t.has(key) ? t(key) : region;
  };
  return (
    <FieldFrame id={id} label={t("label")} hint={t("hint")} error={error}>
      <select
        className={`${selectStyles.select} ${styles.select}`}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        {...fieldA11yProps(id, t("hint"), error)}
      >
        {groups.map((group) => (
          <optgroup key={group.region} label={regionLabel(group.region)}>
            {group.zones.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </FieldFrame>
  );
}

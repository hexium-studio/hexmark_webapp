import { z } from "zod";
import { requiredOr } from "./field-errors";

// Time zones are IANA names such as "Europe/Berlin" or "UTC". Timestamps are
// stored in UTC; a time zone only decides how they are shown.
//
// Validation asks the runtime's Intl implementation, on the server and in the
// browser alike. Intl.supportedValuesOf("timeZone") is not used for checking:
// it lists canonical zones only and leaves out "UTC" itself.

// What can be an IANA name at all: letters, digits, "_", "+" and "-" in
// segments separated by "/", starting with a letter. Refuses the UTC offsets
// ("+01:00") that newer Intl versions accept as time zones as well. At most
// 64 characters, as the database allows.
const TIMEZONE_FORM = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;
export const TIMEZONE_MAX_LENGTH = 64;

// The zone's name as Intl spells it ("europe/berlin" -> "Europe/Berlin",
// "utc" -> "UTC"), or null when Intl does not know the zone.
export function canonicalTimezone(name: string): string | null {
  if (name.length > TIMEZONE_MAX_LENGTH || !TIMEZONE_FORM.test(name)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

// Trims, checks and returns the canonical spelling. The error code is
// "invalid_option": in the UI a time zone comes from a picker.
export const timezoneSchema = z
  .string({ error: requiredOr("invalid_option") })
  .trim()
  .transform((value, context) => {
    const canonical = canonicalTimezone(value);
    if (canonical === null) {
      context.addIssue({ code: "custom", message: "invalid_option" });
      return z.NEVER;
    }
    return canonical;
  });

import { headers } from "next/headers";
import { getLocale } from "next-intl/server";
import { arrangePickerLocales, type PickerLocales } from "./picker-order";
import { availableLocales } from "./registry";

// The languages a visible picker offers, in display order (picker-order.ts):
// the browser's language, languages added on this server, then all others.
// Done here on the server, so server and browser render the same order; a
// language change re-renders and sorts again.

export type { PickerLocales };

export async function pickerLocales(): Promise<PickerLocales> {
  const acceptLanguage = (await headers()).get("accept-language");
  return arrangePickerLocales(availableLocales(), acceptLanguage, await getLocale());
}

import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Toaster } from "@/components/toast/Toaster";
import { FALLBACK_LOCALE, findLocale } from "@/lib/locales/registry";
import { fontVariables } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hexmark",
};

// Every page renders its <main> with id="main", the target of the skip link.
// `lang` and `dir` follow the locale of the request (lib/locales/), so they
// change together with the texts when a language is picked.
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const info = findLocale(locale) ?? findLocale(FALLBACK_LOCALE);
  const t = await getTranslations("common");
  return (
    <html lang={locale} dir={info?.dir ?? "ltr"} className={fontVariables}>
      <body>
        <a className="skip-link" href="#main">
          {t("skipLink")}
        </a>
        {/* Passes locale and messages of the request on to client components. */}
        <NextIntlClientProvider>
          {children}
          {/* Here, not in a page: toasts outlive navigation and redirects. */}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

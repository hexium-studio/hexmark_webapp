import type { Locale } from "@hexmark/shared";
import { describe, expect, it } from "vitest";
import { matchAcceptLanguage } from "@/lib/locales/accept-language";
import type { LocaleInfo, LocaleSource } from "@/lib/locales/locale-info";
import { arrangePickerLocales } from "@/lib/locales/picker-order";

// Accept-Language matching and the order of the language pickers.

describe("matchAcceptLanguage", () => {
  const available = ["en", "de", "de-CH", "pt-BR"];

  it.each([
    ["de-DE,de;q=0.9,en;q=0.5", "de"],
    ["de-CH", "de-CH"],
    ["de-ch", "de-CH"],
    ["de-AT", "de"],
    ["fr-FR,fr;q=0.9", undefined],
    ["fr-FR,fr;q=0.9,en;q=0.1", "en"],
    ["en;q=0.5,de;q=0.8", "de"],
    ["en, de", "en"],
    ["de;q=0, en;q=0.1", "en"],
    ["*", undefined],
    ["de;q=abc,en", "en"],
    ["de;q=1.5,en", "en"],
    ["  DE ;Q=0.7 , en ; q=0.6", "de"],
    ["pt", undefined],
    ["pt-BR,pt", "pt-BR"],
    ["", undefined],
  ])("%j -> %s", (header, expected) => {
    expect(matchAcceptLanguage(header, available)).toBe(expected);
  });

  it("returns nothing without a header", () => {
    expect(matchAcceptLanguage(null, available)).toBeUndefined();
    expect(matchAcceptLanguage(undefined, available)).toBeUndefined();
  });
});

function locale(code: string, name: string, source: LocaleSource = "built-in"): LocaleInfo {
  return { code: code as Locale, name, dir: "ltr", source };
}

const builtIn = [locale("de", "Deutsch"), locale("en", "English")];
const withCustom = [
  ...builtIn,
  locale("ru", "Русский", "custom-new"),
  locale("uk", "Українська", "custom-new"),
  locale("de-CH", "Deutsch (Schweiz)", "custom-override"),
  locale("es", "Español", "custom-new"),
];

const order = (all: LocaleInfo[], header: string | null, ui = "en") => {
  const { blocks, locales } = arrangePickerLocales(all, header, ui);
  return {
    blocks: blocks.map((block) => `${block.id}: ${block.locales.map((l) => l.code).join(" ")}`),
    flat: locales.map((l) => l.code).join(" "),
  };
};

describe("arrangePickerLocales", () => {
  it("puts the browser language first", () => {
    expect(order(builtIn, "de-DE,de;q=0.9").blocks).toEqual(["browser: de", "other: en"]);
    expect(order(builtIn, "en-US").blocks).toEqual(["browser: en", "other: de"]);
  });

  it("leaves out the browser block without a match", () => {
    expect(order(builtIn, "fr-FR").blocks).toEqual(["other: de en"]);
    expect(order(builtIn, null).blocks).toEqual(["other: de en"]);
  });

  it("shows languages added on this server before the built-in ones", () => {
    expect(order(withCustom, "fr")).toEqual({
      blocks: ["added: es ru uk", "other: de de-CH en"],
      flat: "es ru uk de de-CH en",
    });
  });

  it("takes a custom-new browser language out of its block", () => {
    expect(order(withCustom, "ru-RU").blocks).toEqual([
      "browser: ru",
      "added: es uk",
      "other: de de-CH en",
    ]);
  });

  it("sorts by name with the collation of the UI language", () => {
    const names = [locale("sv", "Svenska"), locale("aa", "Ångström"), locale("zz", "Zulu")];
    expect(order(names, null, "en").flat).toBe("aa sv zz");
    expect(order(names, null, "sv").flat).toBe("sv zz aa");
  });
});

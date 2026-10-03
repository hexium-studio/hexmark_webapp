import type { Locale } from "@hexmark/shared";
import type { MessageTree } from "@hexmark/shared/translation-check";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCatalogue } from "@/lib/locales/catalogue";
import type { CatalogueFile } from "@/lib/locales/catalogue-files";

// How the web app turns built-in and custom catalogues into complete
// message sets: region overlays, custom overrides, unusable messages.

beforeEach(() => {
  // The catalogue logs what it does; keep the test output quiet.
  for (const level of ["info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation(() => {});
  }
});

const en = {
  _meta: { name: "English", dir: "ltr" },
  common: { back: "Back", continue: "Continue" },
  greeting: "Hello {name}",
};

function file(code: string, origin: "built-in" | "custom", data: MessageTree): CatalogueFile {
  return { code: code as Locale, origin, label: `${origin}/${code}`, data };
}

const builtIn = [
  file("en", "built-in", en),
  file("de", "built-in", {
    _meta: { name: "Deutsch", dir: "ltr" },
    common: { back: "Zurück", continue: "Weiter" },
    greeting: "Hallo {name}",
  }),
];

function messagesOf(custom: CatalogueFile[], code: string) {
  return buildCatalogue(builtIn, custom).messages.get(code as Locale);
}

describe("buildCatalogue", () => {
  it("fills a region overlay from its language, then English", () => {
    const overlay = file("de-CH", "custom", {
      _meta: { name: "Deutsch (Schweiz)" },
      common: { continue: "Weiter (CH)" },
    });
    expect(messagesOf([overlay], "de-CH")).toEqual({
      common: { back: "Zurück", continue: "Weiter (CH)" },
      greeting: "Hallo {name}",
    });
    const info = buildCatalogue(builtIn, [overlay]).locales.find((l) => l.code === "de-CH");
    expect(info).toEqual({
      code: "de-CH",
      name: "Deutsch (Schweiz)",
      dir: "ltr",
      source: "custom-override",
    });
  });

  it("lets a custom catalogue override a built-in one of the same code", () => {
    const custom = file("de", "custom", {
      _meta: { name: "Deutsch (eigen)" },
      common: { back: "Retour" },
    });
    const catalogue = buildCatalogue(builtIn, [custom]);
    expect(catalogue.messages.get("de" as Locale)).toMatchObject({
      common: { back: "Retour", continue: "Weiter" },
    });
    expect(catalogue.locales.find((l) => l.code === "de")).toMatchObject({
      name: "Deutsch (eigen)",
      source: "custom-override",
    });
  });

  it("adds a new language with English for what it lacks or gets wrong", () => {
    const ru = file("ru", "custom", {
      _meta: { name: "Русский", dir: "ltr" },
      common: { back: "Назад", continue: "{broken" },
      greeting: "Привет {user}",
      unknown: "ignored",
    });
    expect(messagesOf([ru], "ru")).toEqual({
      common: { back: "Назад", continue: "Continue" },
      greeting: "Hello {name}",
    });
    const info = buildCatalogue(builtIn, [ru]).locales.find((l) => l.code === "ru");
    expect(info?.source).toBe("custom-new");
  });

  it("skips a catalogue without a name and keeps the others", () => {
    const nameless = file("es", "custom", { _meta: { dir: "ltr" }, common: { back: "Atrás" } });
    const codes = buildCatalogue(builtIn, [nameless]).locales.map((l) => l.code);
    expect(codes).toEqual(["de", "en"]);
  });

  it("takes rtl from the overlay's language when the overlay does not say", () => {
    const ar = file("ar", "custom", { _meta: { name: "العربية", dir: "rtl" } });
    const arEg = file("ar-EG", "custom", { _meta: { name: "مصري" } });
    const info = buildCatalogue(builtIn, [ar, arEg]).locales.find((l) => l.code === "ar-EG");
    expect(info).toMatchObject({ dir: "rtl", source: "custom-new" });
  });

  it("cannot start without English", () => {
    expect(() => buildCatalogue([builtIn[1] as CatalogueFile], [])).toThrow(/English/);
  });
});

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { areaFileOf, catalogueEntry, readCatalogue } from "@hexmark/shared/translation-files";
import { describe, expect, it } from "vitest";

// Reading catalogues in both forms, and tools/check-translations.mjs in its
// report mode on the fixtures in tests/unit/fixtures/translations/custom.

const CUSTOM = fileURLToPath(new URL("../fixtures/translations/custom/", import.meta.url));
const TOOL = fileURLToPath(new URL("../../../tools/check-translations.mjs", import.meta.url));

describe("catalogueEntry", () => {
  it.each([
    ["ru.json", false, { code: "ru", form: "file", name: "ru.json" }],
    ["pt-BR.json", false, { code: "pt-BR", form: "file", name: "pt-BR.json" }],
    ["uk", true, { code: "uk", form: "folder", name: "uk" }],
    ["ru", false, undefined],
    ["pt-br.json", false, undefined],
    ["not a code.json", false, undefined],
    ["ru.json", true, undefined],
  ])("%s (folder: %s)", (name, folder, expected) => {
    expect(catalogueEntry(name, folder)).toEqual(expected);
  });
});

describe("readCatalogue", () => {
  it("reads the file form as one tree", () => {
    const read = readCatalogue(`${CUSTOM}ru.json`);
    expect(read.error).toBeUndefined();
    expect(read.data?._meta).toEqual({ name: "Русский", dir: "ltr" });
  });

  it("assembles the folder form, skipping unreadable areas and ignoring other files", () => {
    const read = readCatalogue(`${CUSTOM}uk`);
    expect(Object.keys(read.data ?? {}).sort()).toEqual(["_meta", "common"]);
    expect(read.skipped).toEqual([
      { file: "toast.json", reason: "the file must contain one JSON object" },
    ]);
    expect(read.ignored).toEqual(["README.txt"]);
  });

  it("refuses a folder without _meta.json and a file that is not JSON", () => {
    expect(readCatalogue(`${CUSTOM}xx`).error).toBe("_meta.json is missing; it names the language");
    expect(readCatalogue(`${CUSTOM}fr.json`).error).toMatch(/^not valid JSON/);
  });

  it("maps a key to its area file", () => {
    expect(areaFileOf("setup.steps.token.title")).toEqual({
      file: "setup.json",
      key: "steps.token.title",
    });
    expect(areaFileOf("common")).toEqual({ file: "common.json", key: "" });
  });
});

function runTool(...args: string[]) {
  const result = spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("tools/check-translations.mjs", () => {
  it("passes the built-in translations in strict mode", () => {
    const { status, output } = runTool();
    expect(status).toBe(0);
    expect(output).toMatch(/built-in translations checked, all passed/);
  });

  it("reports missing and unknown keys of a usable file without failing", () => {
    const { status, output } = runTool(`${CUSTOM}ru.json`);
    expect(status).toBe(0);
    expect(output).toContain("they will show in English");
    expect(output).toContain("common.unknownKey");
    expect(output).toContain("placeholder {total} is missing");
  });

  it("treats missing keys of a region overlay as taken from its language", () => {
    const { status, output } = runTool(`${CUSTOM}de-CH.json`);
    expect(status).toBe(0);
    expect(output).toContain("not in this overlay, taken from de (if available) or English");
    expect(output).toContain('"_meta.dir" not set, taken from the language');
  });

  it("names ICU errors and skipped area files of the folder form", () => {
    const { status, output } = runTool(`${CUSTOM}uk`);
    expect(status).toBe(0);
    expect(output).toContain("common.json: continue: invalid ICU message syntax");
    expect(output).toContain("toast.json: the file must contain one JSON object");
  });

  it.each([
    ["es.json", '"_meta.name" is missing or empty'],
    ["fr.json", "not valid JSON"],
    ["not a code.json", "file name must be <code>.json"],
  ])("fails for the unusable %s", (file, message) => {
    const { status, output } = runTool(`${CUSTOM}${file}`);
    expect(status).toBe(1);
    expect(output).toContain(message);
  });
});

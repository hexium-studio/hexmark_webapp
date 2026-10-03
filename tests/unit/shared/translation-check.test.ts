import {
  checkMeta,
  compareMessages,
  leafKeys,
  type MessageTree,
  UNUSABLE_MESSAGE,
} from "@hexmark/shared/translation-check";
import { describe, expect, it } from "vitest";

// The rules every translation is checked with (strictly at build time,
// tolerantly at run time): keys, shapes, ICU syntax, placeholders, _meta.

const reference: MessageTree = {
  common: { back: "Back", continue: "Continue" },
  greeting: "Hello {name}",
  count: "{n, plural, one {# note} other {# notes}}",
  role: "{role, select, admin {Admin} other {User}}",
  date: "Since {when, date, short}",
  rich: "Remove <code>SETUP_TOKEN</code>",
};

const kinds = (candidate: MessageTree) =>
  compareMessages(reference, candidate).map(({ kind, key }) => `${kind} ${key}`);

describe("compareMessages", () => {
  it("finds nothing in the reference itself", () => {
    expect(compareMessages(reference, reference)).toEqual([]);
  });

  it("reports missing keys, down to every leaf of a missing group", () => {
    const { common, greeting, ...rest } = reference;
    expect(kinds(rest)).toEqual([
      "missing common.back",
      "missing common.continue",
      "missing greeting",
    ]);
  });

  it("reports extra keys at any depth, but not _meta at the top", () => {
    const candidate = {
      ...reference,
      _meta: {},
      extra: "x",
      common: { back: "B", continue: "C", more: "M" },
    };
    expect(kinds(candidate)).toEqual(["extra common.more", "extra extra"]);
  });

  it("reports a group where a text belongs and the reverse", () => {
    expect(kinds({ ...reference, common: "flat", greeting: { name: "x" } })).toEqual([
      "shape common",
      "shape greeting",
    ]);
  });

  it("reports invalid ICU syntax with the text", () => {
    const [issue] = compareMessages(reference, { ...reference, greeting: "Hello {name" });
    expect(issue).toMatchObject({ kind: "syntax", key: "greeting" });
    expect(issue?.detail).toContain("invalid ICU message syntax");
    expect(issue?.detail).toContain('"Hello {name"');
  });

  it("reports missing and unknown placeholders and tags", () => {
    const issues = compareMessages(reference, {
      ...reference,
      greeting: "Hallo {user}",
      rich: "Entferne SETUP_TOKEN",
    });
    expect(issues.map((issue) => issue.detail)).toEqual([
      "unknown placeholder {user} (not in English)",
      "placeholder {name} is missing",
      "tag <code> is missing",
    ]);
    expect(issues.every((issue) => issue.kind === "arguments")).toBe(true);
  });

  it("accepts a plural for a plain placeholder and the reverse", () => {
    const issues = compareMessages(
      { a: "{n} notes", b: "{n, plural, other {# notes}}" },
      { a: "{n, plural, one {# Notiz} other {# Notizen}}", b: "{n} Notizen" },
    );
    expect(issues).toEqual([]);
  });

  it("refuses a value of another kind (number as date, select as plural)", () => {
    const issues = compareMessages(reference, {
      ...reference,
      date: "Seit {when, number}",
      role: "{role, plural, other {x}}",
    });
    expect(issues.map((issue) => `${issue.kind}: ${issue.detail}`)).toEqual([
      "structure: placeholder {role} is a plural here, a select in English",
      "structure: placeholder {when} is a number here, a date in English",
    ]);
  });

  it("checks select options and plural categories", () => {
    const issues = compareMessages(reference, {
      ...reference,
      role: "{role, select, admin {Admin} guest {Gast} other {Nutzer}}",
      count: "{n, plural, one {# Notiz} several {# Notizen} other {# Notizen}}",
    });
    expect(issues.map((issue) => issue.detail)).toEqual([
      '"several" is not a plural category (zero, one, two, few, many, other, =N)',
      "select {role} has unknown: guest",
    ]);
    const lacking = compareMessages(reference, { ...reference, role: "{role, select, other {X}}" });
    expect(lacking[0]?.detail).toBe("select {role} lacks: admin");
  });

  it("marks shape, syntax, argument and structure problems as unusable", () => {
    expect([...UNUSABLE_MESSAGE].sort()).toEqual(["arguments", "shape", "structure", "syntax"]);
  });
});

describe("leafKeys", () => {
  it("lists every message key below a value", () => {
    expect(leafKeys({ a: "x", b: { c: "y" } }, "root")).toEqual(["root.a", "root.b.c"]);
    expect(leafKeys("text", "key")).toEqual(["key"]);
  });
});

describe("checkMeta", () => {
  it("accepts a name and a direction", () => {
    expect(checkMeta({ _meta: { name: " Deutsch ", dir: "ltr" } })).toEqual({
      meta: { name: "Deutsch", dir: "ltr" },
      errors: [],
      warnings: [],
    });
  });

  it("refuses a catalogue without _meta or without a name", () => {
    expect(checkMeta({}).errors).toEqual(['"_meta" is missing or not an object']);
    expect(checkMeta({ _meta: "x" }).errors).toHaveLength(1);
    expect(checkMeta({ _meta: { name: "  " } }).errors).toEqual([
      '"_meta.name" is missing or empty',
    ]);
  });

  it("warns about a missing or wrong direction but keeps the catalogue", () => {
    expect(checkMeta({ _meta: { name: "X" } })).toEqual({
      meta: { name: "X", dir: undefined },
      errors: [],
      warnings: ['"_meta.dir" is missing ("ltr" or "rtl")'],
    });
    expect(checkMeta({ _meta: { name: "X", dir: "up" } }).warnings).toEqual([
      '"_meta.dir" must be "ltr" or "rtl", not "up"',
    ]);
  });
});

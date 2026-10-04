import { describe, expect, it } from "vitest";
import {
  queryWords,
  unmarkCompoundParts,
} from "../../../apps/server/src/services/notes/compound-marks";
import { finishSnippet } from "../../../apps/server/src/services/notes/snippets";

// The marks of a hyphenated query word's parts (compound-marks.ts):
// ts_headline marks every part on its own ("app-kasse" also marks "app"
// in "app-kalender"); once the whole word is marked, the parts elsewhere
// lose their marks unless the query asks for them as words of their own.
// The input strings are ts_headline's output for that text and query
// (checked against PostgreSQL 18).

const HEADLINE = "Jede «App» heißt «app»-«kasse», auch «app»-kalender und «kasse»-«app».";
const TEXT = "Jede App heißt app-kasse, auch app-kalender und kasse-app.";

describe("query words", () => {
  it("splits the query into hyphenated words and words, lower case", () => {
    expect(queryWords('App-Kasse "neue regeln" -alt')).toEqual({
      compounds: new Set(["app-kasse"]),
      words: new Set(["neue", "regeln", "alt"]),
    });
  });
});

describe("unmarking parts", () => {
  it("keeps the whole word marked and takes the marks off its parts elsewhere", () => {
    expect(unmarkCompoundParts(HEADLINE, "app-kasse")).toBe(
      "Jede App heißt «app»-«kasse», auch app-kalender und kasse-app.",
    );
  });

  it("gives the whole word one mark once the snippet is finished", () => {
    const finished = finishSnippet(unmarkCompoundParts(HEADLINE, "app-kasse"), TEXT, " … ");
    expect(finished).toBe("Jede App heißt «app-kasse», auch app-kalender und kasse-app.");
    expect(finished.match(/«/g)).toHaveLength(1);
  });

  it("matches case-insensitively", () => {
    expect(unmarkCompoundParts("«App»-«Kasse» und «APP»", "app-KASSE")).toBe(
      "«App»-«Kasse» und APP",
    );
  });

  it("keeps a part the query also asks for as a word of its own", () => {
    expect(unmarkCompoundParts(HEADLINE, "app app-kasse")).toBe(
      "Jede «App» heißt «app»-«kasse», auch «app»-kalender und kasse-«app».",
    );
  });

  it("changes nothing when the whole word is not marked in the snippet", () => {
    const partsOnly = "nur «app»-kalender und «kasse»";
    expect(unmarkCompoundParts(partsOnly, "app-kasse")).toBe(partsOnly);
  });

  it("changes nothing for a query without a hyphenated word", () => {
    expect(unmarkCompoundParts(HEADLINE, "app kasse")).toBe(HEADLINE);
  });

  it("keeps the whole word inside a longer hyphenated word", () => {
    expect(unmarkCompoundParts("«app»-«kasse»-neu und «kasse»", "app-kasse")).toBe(
      "«app»-«kasse»-neu und kasse",
    );
  });

  it("leaves other marked words alone", () => {
    expect(unmarkCompoundParts("«app»-«kasse» für «regeln»", "app-kasse regeln")).toBe(
      "«app»-«kasse» für «regeln»",
    );
  });
});

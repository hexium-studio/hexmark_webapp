import { describe, expect, it } from "vitest";
import {
  finishSnippet,
  mergeMarks,
  relativeRanks,
} from "../../../apps/server/src/services/notes/snippets";

// Search snippets as ts_headline cuts them, finished for the answer
// (snippets.ts): "…" where text is left out, punctuation of the first and
// last word kept, phrases as one mark, and ranks relative to the best hit.

const delimiter = " … ";

describe("cut marks", () => {
  it("mark text left out before and after", () => {
    const text = "First we wait. Then the zebra runs far away and later rests.\n";
    expect(finishSnippet("Then the «zebra» runs far", text, delimiter)).toBe(
      "… Then the «zebra» runs far …",
    );
  });

  it("leave a snippet that shows the whole text as it is, with its final period", () => {
    expect(finishSnippet("Only «zebra» here", "Only zebra here.", delimiter)).toBe(
      "Only «zebra» here.",
    );
  });

  it("mark only the side that was cut, across fragments and white space", () => {
    const text = "Alpha beta\n\ngamma delta epsilon.\nzeta eta theta";
    expect(finishSnippet("Alpha beta gamma «delta» … zeta eta theta", text, delimiter)).toBe(
      "Alpha beta gamma «delta» … zeta eta theta",
    );
    expect(finishSnippet("gamma «delta» epsilon", text, delimiter)).toBe(
      "… gamma «delta» epsilon. …",
    );
  });

  it("leave a snippet it cannot find in the text as it is", () => {
    expect(finishSnippet("something else", "Different text.", delimiter)).toBe("something else");
  });
});

describe("punctuation", () => {
  it("keeps sentence-final punctuation, also several characters and closing brackets", () => {
    const text = "Shared code lives in the «library» Quetschkommode.";
    expect(finishSnippet("in the library «Quetschkommode»", text, delimiter)).toBe(
      "… in the library «Quetschkommode».",
    );
    expect(finishSnippet("is «done»", "It is done!).", delimiter)).toBe("… is «done»!).");
  });

  it("keeps an opening bracket or quote before the first word", () => {
    const text = 'Rules: (ä becomes ae) and "quoted words" stay.';
    expect(finishSnippet("«ä» becomes ae", text, delimiter)).toBe("… («ä» becomes ae) …");
    expect(finishSnippet("«quoted» words", text, delimiter)).toBe('… "«quoted» words" …');
  });

  it("does not take punctuation that joins words", () => {
    const text = "Write it in kebab-case always";
    expect(finishSnippet("«case» always", text, delimiter)).toBe("… «case» always");
  });

  it("keeps punctuation at the end of every fragment", () => {
    const text = "One. Two «zebra». Three. Four «zebra», five.";
    expect(finishSnippet("Two «zebra» … Four «zebra»", text, delimiter)).toBe(
      "… Two «zebra». … Four «zebra», …",
    );
  });
});

describe("phrases", () => {
  it("merges marks of neighbouring words into one", () => {
    expect(mergeMarks("separated «by» «an» «underscore»")).toBe("separated «by an underscore»");
    expect(mergeMarks("«kebab»-«case»")).toBe("«kebab-case»");
    expect(mergeMarks("«kebab»-case")).toBe("«kebab»-case");
    const text = "Words are separated by an underscore.";
    expect(finishSnippet("Words are «separated» «by» an", text, delimiter)).toBe(
      "Words are «separated by» an …",
    );
  });
});

describe("relative ranks", () => {
  it("gives 1 to the best hit and the others their share, with three decimals", () => {
    expect(relativeRanks([0.0759, 0.038, 0.0001])).toEqual([1, 0.501, 0.001]);
  });

  it("keeps tiny ranks comparable instead of showing them raw", () => {
    expect(relativeRanks([2e-20, 1e-20])).toEqual([1, 0.5]);
  });

  it("gives 1 to all when no rank is above zero, and copes with no hits", () => {
    expect(relativeRanks([0, 0])).toEqual([1, 1]);
    expect(relativeRanks([])).toEqual([]);
  });
});

describe("the end of a short section", () => {
  it("keeps an emoji and a final period instead of dropping them, without …", () => {
    const text = "Jede App heißt app-kalender, die Länge spielt keine Rolle 🚀.";
    expect(finishSnippet("die Länge spielt keine «Rolle»", text, delimiter)).toBe(
      "… die Länge spielt keine «Rolle» 🚀.",
    );
  });

  it("keeps a short rest without words at either end, such as a code fence", () => {
    const text = "```\nlib-zeitzonen\n```\n";
    expect(finishSnippet("lib-«zeitzonen»", text, delimiter)).toBe("``` lib-«zeitzonen» ```");
  });

  it("cuts with … when the rest has words or is long", () => {
    const symbols = `${"=".repeat(30)}`;
    expect(finishSnippet("«alpha»", `alpha ${symbols}`, delimiter)).toBe("«alpha» …");
    expect(finishSnippet("«alpha»", "alpha 🚀 beta", delimiter)).toBe("«alpha» …");
  });
});

describe("hyphenated words", () => {
  it("are marked as one when both parts match, part by part otherwise", () => {
    const text = "Jede App heißt app-kalender.";
    expect(finishSnippet("Jede «App» heißt «app»-«kalender»", text, delimiter)).toBe(
      "Jede «App» heißt «app-kalender».",
    );
    expect(finishSnippet("heißt «app»-kalender", text, delimiter)).toBe("… heißt «app»-kalender.");
  });
});

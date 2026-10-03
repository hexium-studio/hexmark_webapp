import { describe, expect, it } from "vitest";
import { SETUP_TOKEN_RULES } from "@/app/setup/_components/setup-token-rules";
import {
  acceptedChars,
  clearCell,
  codeFromText,
  emptyCode,
  filledCount,
  insertChars,
  keyCommand,
  typedText,
} from "@/components/code-input/code-model";

// The pure model of the code input with the setup token's rules: what a
// cell accepts, typing, pasting and key handling.

const rules = SETUP_TOKEN_RULES;
const code = (text: string) => codeFromText(text, rules);
const cells = (text: string) => [...text].map((char) => (char === "_" ? "" : char));

describe("acceptedChars", () => {
  it("upper-cases and keeps only A-Z and 0-9", () => {
    expect(acceptedChars("ab-cd 12_3ä!", rules)).toEqual(["A", "B", "C", "D", "1", "2", "3"]);
  });

  it("drops characters that upper-case to more than one ('ß' -> 'SS')", () => {
    expect(acceptedChars("aßb", rules)).toEqual(["A", "B"]);
  });

  it("works with a regular expression rule as well", () => {
    expect(acceptedChars("1a2b", { length: 4, allowed: /[0-9]/g })).toEqual(["1", "2"]);
  });
});

describe("codeFromText and filledCount", () => {
  it("fills cells from a stored value and cuts what does not fit", () => {
    expect(code("abcd-efgh-ijk")).toEqual(cells("ABCDEFGH"));
    expect(codeFromText(undefined, rules)).toEqual(emptyCode(8));
    expect(filledCount(code("ab"))).toBe(2);
  });
});

describe("insertChars (typing and pasting)", () => {
  it("writes typed characters from the cell on and moves focus behind them", () => {
    expect(insertChars(emptyCode(8), 0, ["A"])).toEqual({ code: cells("A_______"), focusIndex: 1 });
    expect(insertChars(code("AB"), 2, ["C", "D"])).toEqual({
      code: cells("ABCD____"),
      focusIndex: 4,
    });
  });

  it("replaces all cells with a complete code wherever it is pasted", () => {
    const pasted = acceptedChars(" abcd-1234 ", rules);
    expect(insertChars(code("ZZ"), 5, pasted)).toEqual({ code: cells("ABCD1234"), focusIndex: 7 });
  });

  it("drops what does not fit and keeps focus on the last cell", () => {
    expect(insertChars(emptyCode(8), 6, ["A", "B", "C"])).toEqual({
      code: cells("______AB"),
      focusIndex: 7,
    });
  });
});

describe("typedText", () => {
  it.each([
    ["", "a", "a"],
    ["A", "Ab", "b"],
    ["A", "bA", "b"],
    ["A", "c", "c"],
  ])("cell showed %j, now holds %j -> typed %j", (shown, value, typed) => {
    expect(typedText(shown, value)).toBe(typed);
  });
});

describe("keyCommand (navigation and deletion)", () => {
  const full = code("ABCD1234");
  const key = (value: readonly string[], index: number, name: string, masked = true) =>
    keyCommand(value, index, name, rules, masked);

  it("moves with the arrow keys, Home and End, within the cells", () => {
    expect(key(full, 3, "ArrowLeft")).toEqual({ focus: 2 });
    expect(key(full, 3, "ArrowRight")).toEqual({ focus: 4 });
    expect(key(full, 0, "ArrowLeft")).toEqual({ focus: 0 });
    expect(key(full, 7, "ArrowRight")).toEqual({ focus: 7 });
    expect(key(full, 5, "Home")).toEqual({ focus: 0 });
    expect(key(full, 2, "End")).toEqual({ focus: 7 });
  });

  it("Backspace clears a filled cell and stays", () => {
    expect(key(full, 3, "Backspace")).toEqual({ code: cells("ABC_1234") });
  });

  it("Backspace in an empty cell clears the previous one and moves there", () => {
    expect(key(code("ABC"), 3, "Backspace")).toEqual({ code: cells("AB______"), focus: 2 });
  });

  it("Backspace in the first, empty cell does nothing but is handled", () => {
    expect(key(emptyCode(8), 0, "Backspace")).toEqual({});
  });

  it("Delete clears the cell", () => {
    expect(key(full, 0, "Delete")).toEqual({ code: cells("_BCD1234") });
  });

  it("typing the character a revealed cell shows moves on", () => {
    expect(key(full, 2, "c", false)).toEqual({ focus: 3 });
    expect(key(full, 7, "4", false)).toEqual({ focus: 7 });
  });

  it("leaves other keys and masked cells to the browser", () => {
    expect(key(full, 2, "c", true)).toBeNull();
    expect(key(full, 2, "x", false)).toBeNull();
    expect(key(full, 2, "Tab")).toBeNull();
    expect(key(full, 2, "Enter")).toBeNull();
  });

  it("clearCell copies instead of changing the value", () => {
    const before = code("AB");
    expect(clearCell(before, 0)).toEqual(cells("_B______"));
    expect(before).toEqual(cells("AB______"));
  });
});

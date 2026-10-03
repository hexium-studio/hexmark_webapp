import { describe, expect, it } from "vitest";
import { type LocaleSources, pickLocale } from "@/lib/locales/locale-order";

// The order of the UI language sources: user, cookie, browser, instance
// default, English. Later sources are not asked once one has answered.

type Answers = Partial<Record<keyof LocaleSources, string>>;

function sources(answers: Answers, asked: string[] = []): LocaleSources {
  const source = (name: keyof LocaleSources) => async () => {
    asked.push(name);
    return answers[name];
  };
  return {
    user: source("user"),
    cookie: source("cookie"),
    browser: source("browser"),
    instance: source("instance"),
  };
}

describe("pickLocale", () => {
  it.each([
    [{ user: "de", cookie: "fr", browser: "es", instance: "it" }, "de"],
    [{ cookie: "fr", browser: "es", instance: "it" }, "fr"],
    // The browser comes before the instance default.
    [{ browser: "es", instance: "it" }, "es"],
    [{ instance: "it" }, "it"],
    [{}, "en"],
  ] as const)("%j -> %s", async (answers, expected) => {
    expect(await pickLocale(sources(answers), "en")).toBe(expected);
  });

  it("asks the cookie before the browser", async () => {
    expect(await pickLocale(sources({ cookie: "de", browser: "en" }), "en")).toBe("de");
  });

  it("stops at the first answer: no call for the instance default", async () => {
    const asked: string[] = [];
    await pickLocale(sources({ browser: "de" }, asked), "en");
    expect(asked).toEqual(["user", "cookie", "browser"]);
  });

  it("asks every source in order when none answers", async () => {
    const asked: string[] = [];
    await pickLocale(sources({}, asked), "en");
    expect(asked).toEqual(["user", "cookie", "browser", "instance"]);
  });
});

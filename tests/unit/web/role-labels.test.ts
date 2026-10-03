import { readFileSync } from "node:fs";
import { join } from "node:path";
import { USER_ROLES } from "@hexmark/shared";
import { describe, expect, it } from "vitest";
import { roleLabelKey } from "@/lib/roles";
import { WEB_DIR } from "../../support/paths";

// Every role preset has a label in every built-in language.

function labels(locale: string): Record<string, string> {
  return JSON.parse(readFileSync(join(WEB_DIR, "messages", locale, "roles.json"), "utf8"));
}

describe("role labels", () => {
  it.each(["en", "de"])("%s has a label for each role", (locale) => {
    const messages = labels(locale);
    for (const role of USER_ROLES) {
      expect(messages[roleLabelKey(role)]?.trim()).toBeTruthy();
    }
  });

  it("maps each role to its own label", () => {
    const keys = USER_ROLES.map(roleLabelKey);
    expect(new Set(keys).size).toBe(USER_ROLES.length);
    expect(labels("de")[roleLabelKey("guest")]).toBe("Gast");
    expect(labels("en")[roleLabelKey("admin")]).toBe("Administrator");
  });
});

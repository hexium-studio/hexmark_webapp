import { describe, expect, it } from "vitest";
import { readDatabaseConfig, readPort } from "../../../apps/server/src/config/env";

// PORT: the port the API server listens on. 0 lets the operating system pick
// one (the tests start their servers that way and read the port from the
// start-up line); DB_PORT still needs a real port.

describe("PORT", () => {
  it("defaults to 3001 when blank", () => {
    expect(readPort(undefined)).toBe(3001);
    expect(readPort(" ")).toBe(3001);
  });

  it("accepts 0 to 65535", () => {
    expect(readPort("0")).toBe(0);
    expect(readPort("3001")).toBe(3001);
    expect(readPort("65535")).toBe(65535);
  });

  it("refuses anything else with the rule in the message", () => {
    for (const raw of ["-1", "65536", "30.5", "abc"]) {
      expect(() => readPort(raw)).toThrow(
        `PORT must be a whole number between 0 and 65535, got "${raw}".`,
      );
    }
  });
});

describe("DB_PORT", () => {
  const credentials = { POSTGRES_USER: "u", POSTGRES_PASSWORD: "p", POSTGRES_DB: "d" };

  it("does not accept 0", () => {
    expect(readDatabaseConfig({ ...credentials, DB_PORT: "0" })).toMatchObject({
      configured: false,
      reason: "database port is invalid",
    });
    expect(readDatabaseConfig({ ...credentials, DB_PORT: "1" })).toMatchObject({
      configured: true,
      connection: { port: 1 },
    });
  });
});

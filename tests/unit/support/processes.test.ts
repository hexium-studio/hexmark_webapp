import { afterEach, describe, expect, it } from "vitest";
import { type ManagedProcess, startProcess } from "../../support/processes";

// Started processes (support/processes.ts): waiting for a line of their
// output, e.g. the port a server reports after binding port 0.

const started: ManagedProcess[] = [];
afterEach(async () => {
  for (const proc of started.splice(0)) await proc.stop();
});

function node(script: string): ManagedProcess {
  const proc = startProcess({
    name: "unit-node",
    command: process.execPath,
    args: ["-e", script],
    cwd: process.cwd(),
    env: { PATH: process.env.PATH },
  });
  started.push(proc);
  return proc;
}

describe("waitForLine", () => {
  it("resolves with the first matching line, also when it arrives in pieces", async () => {
    const proc = node(`
      process.stdout.write("starting\\nlistening on po");
      setTimeout(() => process.stdout.write("rt 4242\\nlistening on port 1\\n"), 50);
      setTimeout(() => {}, 5000);
    `);
    const match = await proc.waitForLine("the port", /listening on port (\d+)/);
    expect(match[1]).toBe("4242");
  });

  it("fails with the output when the process exits without the line", async () => {
    const proc = node(`console.log("listen EADDRINUSE"); process.exit(1);`);
    await expect(proc.waitForLine("the port", /listening on port (\d+)/)).rejects.toThrow(
      /Waiting for the port failed: the process exited\.\n.*\nlisten EADDRINUSE/,
    );
    await proc.stop();
    expect(proc.tail()).toBe("listen EADDRINUSE");
  });

  it("fails when time runs out", async () => {
    const proc = node(`setTimeout(() => {}, 5000);`);
    await expect(proc.waitForLine("the port", /never/, 200)).rejects.toThrow(
      "Waiting for the port failed: no such output within 200 ms.",
    );
  });
});

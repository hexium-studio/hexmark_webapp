import { API_TOKEN_PATTERN } from "@hexmark/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, test } from "./fixtures";
import { ADA } from "./helpers/auth";
import { text } from "./helpers/messages";
import {
  confirmDialog,
  createButton,
  createFolder,
  nameField,
  shownConfig,
  signInToTokens,
  submitToken,
} from "./helpers/tokens";
import { toasts } from "./helpers/wizard";

// The API token page (/account/tokens): creating a token with the defaults
// (password confirmed in a dialog), the one-time MCP configuration (copied
// as JSON only, gone after "Done" and after a reload), using it over HTTP
// and MCP, revoking it, and a taken name at the field.

const t = (key: string, values?: Record<string, string | number>) => text("en", key, values);

test.use({ locale: "en-US" });

async function treeStatus(serverUrl: string, token: string) {
  const response = await fetch(`${serverUrl}/api/notes/v1/tree`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return response.status;
}

test("creates a token, shows it once, and revokes it", async ({ page, stack, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signInToTokens(page, stack, ADA);
  await expect(page.getByText(t("tokens.list.none"))).toBeVisible();

  // Defaults: read and search; no folders exist, so the whole wiki.
  const box = (key: string) => page.getByRole("checkbox", { name: t(`tokens.permissions.${key}`) });
  await expect(box("read")).toBeChecked();
  await expect(box("search")).toBeChecked();
  for (const key of ["create", "edit", "move", "delete"]) await expect(box(key)).not.toBeChecked();
  // No tool uses it yet: not offered (the server would still accept it).
  await expect(box("lock")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: t("tokens.form.scope.label") })).toHaveCount(0);

  // No recent password confirmation: the dialog asks for it first.
  await nameField(page, "en").fill("claude-code-laptop");
  await submitToken(page, "en", ADA.password);
  const heading = page.getByRole("heading", {
    name: t("tokens.created.heading", { name: "claude-code-laptop" }),
  });
  await expect(heading).toBeFocused();
  await expect(toasts(page).first()).toContainText(t("tokens.done.created"));
  await expect(page.getByText(t("tokens.created.hint"))).toBeVisible();

  const { raw, config } = await shownConfig(page);
  const entry = config.mcpServers.hexmark;
  expect(Object.keys(config.mcpServers)).toEqual(["hexmark"]);
  expect(entry.type).toBe("http");
  expect(entry.url).toBe(`${stack.serverUrl}/mcp`);
  const token = entry.headers.Authorization.replace(/^Bearer /, "");
  expect(token).toMatch(API_TOKEN_PATTERN);
  expect(raw).toBe(JSON.stringify(config, null, 2));

  // "Copy" copies the JSON and nothing else.
  await page.getByRole("button", { name: t("tokens.created.copy"), exact: true }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(raw);
  expect(copied).not.toContain(t("tokens.created.hint"));

  // The token works, over HTTP and over MCP with the copied configuration.
  expect(await treeStatus(stack.serverUrl, token)).toBe(200);
  const client = new Client({ name: "hexmark-e2e", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(entry.url), {
      requestInit: { headers: entry.headers },
    }),
  );
  const tools = await client.listTools();
  expect(tools.tools.map((tool) => tool.name)).toContain("get_overview");
  await client.close();

  // Nothing keeps the token in the browser.
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain(token);
  const cookies = await context.cookies();
  expect(cookies.some((cookie) => cookie.value.includes(token))).toBe(false);

  // "Done" drops it; a reload does not bring it back.
  await page.getByRole("button", { name: t("tokens.created.done") }).click();
  await expect(heading).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(token);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: t("tokens.title") })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(token);
  const item = page.getByRole("listitem").filter({ hasText: "claude-code-laptop" });
  await expect(item).toContainText(`${token.slice(0, 8)}…`);
  await expect(item).toContainText(
    `${t("tokens.permissions.read")}, ${t("tokens.permissions.search")}`,
  );
  await expect(item).toContainText(t("tokens.list.wholeWiki"));

  // Revoking: confirmed in a dialog, gone from the list, refused at once.
  await item.getByRole("button", { name: "Revoke claude-code-laptop" }).click();
  const dialog = page.getByRole("dialog", { name: t("tokens.revoke.title") });
  await expect(dialog).toContainText("claude-code-laptop");
  await dialog.getByRole("button", { name: t("tokens.revoke.action") }).click();
  await expect(dialog).toHaveCount(0);
  await expect(toasts(page).first()).toContainText(t("tokens.done.revoked"));
  await expect(page.getByRole("listitem").filter({ hasText: "claude-code-laptop" })).toHaveCount(0);
  expect(await treeStatus(stack.serverUrl, token)).toBe(401);
});

test("a taken name is shown at the field without moving the form", async ({ page, stack }) => {
  await signInToTokens(page, stack, ADA);
  await nameField(page, "en").fill("agent");
  await submitToken(page, "en", ADA.password);
  await page.getByRole("button", { name: t("tokens.created.done") }).click();

  const legend = page.locator("#token-permissions legend");
  // Position in the document (the viewport may scroll to the field).
  const top = () => legend.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  const before = await top();
  // Confirmed a moment ago: no dialog this time.
  await nameField(page, "en").fill("agent");
  await createButton(page, "en").click();
  await expect(nameField(page, "en")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(t("errors.fields.tokenName.taken"))).toBeVisible();
  await expect(confirmDialog(page, "en")).toHaveCount(0);
  expect(await top()).toBe(before);

  // Typing clears it.
  await nameField(page, "en").fill("agent 2");
  await expect(nameField(page, "en")).not.toHaveAttribute("aria-invalid", "true");
});

test("a guest can give read and search only", async ({ page, stack }) => {
  const guest = { ...ADA, email: "guest@example.com", username: "guest", role: "guest" as const };
  await signInToTokens(page, stack, guest);
  const boxes = page.getByRole("checkbox");
  await expect(boxes).toHaveCount(2);
  await expect(page.getByRole("checkbox", { name: t("tokens.permissions.read") })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: t("tokens.permissions.search") })).toBeChecked();
  await expect(page.getByText(t("tokens.form.permissions.guestHint"))).toBeVisible();
});

test("limits a token to chosen folders", async ({ page, stack }) => {
  await signInToTokens(page, stack, ADA);
  const projects = await createFolder(page, stack, "Projects");
  await createFolder(page, stack, "Web", projects);
  await page.reload();

  await nameField(page, "en").fill("web-agent");
  await page
    .getByRole("combobox", { name: t("tokens.form.scope.label") })
    .selectOption({ label: t("tokens.form.scope.folders") });
  await createButton(page, "en").click();
  await expect(page.getByText(t("tokens.form.scope.foldersMissing"))).toBeVisible();
  await expect(confirmDialog(page, "en")).toHaveCount(0);

  await page.getByRole("checkbox", { name: "Projects/Web" }).check();
  // Offered again since the trash tools use it.
  await page.getByRole("checkbox", { name: t("tokens.permissions.delete") }).check();
  await submitToken(page, "en", ADA.password);
  await page.getByRole("button", { name: t("tokens.created.done") }).click();
  const item = page.getByRole("listitem").filter({ hasText: "web-agent" });
  await expect(item).toContainText("Projects/Web");
  await expect(item).not.toContainText(t("tokens.list.wholeWiki"));
  await expect(item).toContainText(
    `${t("tokens.permissions.read")}, ${t("tokens.permissions.search")}, ` +
      t("tokens.permissions.delete"),
  );
});

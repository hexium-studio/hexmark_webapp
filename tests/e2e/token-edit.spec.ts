import { expect, test } from "./fixtures";
import { ADA } from "./helpers/auth";
import { text } from "./helpers/messages";
import { api, seedNote, seedToken, sessionAuth } from "./helpers/session-api";
import {
  confirmPassword,
  createFolder,
  modeRadio,
  openFolder,
  signInToTokens,
  treeBox,
} from "./helpers/tokens";
import { toasts } from "./helpers/wizard";

// Changing a token's access on /account/tokens: switching the mode (which
// starts an empty list), picking a folder and a single note deep in the
// tree, giving them permissions and saving with the password confirmed. The
// token has the new access with its next request.

const t = (key: string, values?: Record<string, string | number>) => text("en", key, values);

test.use({ locale: "en-US" });

test("changes a token from deny list to allow list with targets picked in the tree", async ({
  page,
  stack,
}) => {
  await signInToTokens(page, stack, ADA);
  const projects = await createFolder(page, stack, "Projects");
  const web = await createFolder(page, stack, "Web", projects);
  const deep = await createFolder(page, stack, "Deep", web);
  const plan = await seedNote(page, stack, deep, "Plan");
  const elsewhere = await seedNote(page, stack, projects, "Elsewhere");
  const { token, id } = await seedToken(page, stack, {
    name: "switcher",
    mode: "deny_list",
    basePermissions: ["read", "search"],
  });
  const bearer = `Bearer ${token}`;
  expect((await api(stack, bearer, "GET", `/api/notes/v1/notes/${elsewhere}`)).status).toBe(200);
  await page.reload();

  const item = page.getByRole("listitem").filter({ hasText: "switcher" });
  await item.getByRole("button", { name: `${t("tokens.list.edit")} switcher` }).click();
  const heading = page.getByRole("heading", {
    name: t("tokens.form.editTitle", { name: "switcher" }),
  });
  await expect(heading).toBeVisible();
  await expect(modeRadio(page, "en", "deny_list")).toBeChecked();

  // Switching the mode starts an empty list.
  await modeRadio(page, "en", "allow_list").check();
  await expect(page.getByText(t("tokens.form.access.noneAllowed"))).toBeVisible();
  await openFolder(page, "en", "Projects");
  await openFolder(page, "en", "Web");
  await openFolder(page, "en", "Deep");
  await treeBox(page, "en", "note", "Plan").check();
  const entry = page.locator("#token-entries li").filter({ hasText: "Projects/Web/Deep/Plan" });
  // A single note offers no create or search.
  await expect(entry.getByRole("checkbox", { name: t("tokens.permissions.search") })).toHaveCount(
    0,
  );
  await expect(entry.getByRole("checkbox", { name: t("tokens.permissions.read") })).toBeChecked();
  await entry.getByRole("checkbox", { name: t("tokens.permissions.edit") }).check();

  await page.getByRole("button", { name: t("tokens.form.save"), exact: true }).click();
  await confirmPassword(page, "en", ADA.password, "tokens.confirm.submitUpdate");
  await expect(toasts(page).first()).toContainText(t("tokens.done.updated"));
  await expect(heading).toHaveCount(0);
  await expect(item).toContainText(t("tokens.form.access.allow_list.label"));
  await expect(item).toContainText("Projects/Web/Deep/Plan");

  // Stored as chosen, and in effect at once.
  const list = await api(stack, await sessionAuth(page), "GET", "/api/tokens/v1/tokens");
  const stored = (list.body.tokens as { id: string }[]).find((entry) => entry.id === id);
  expect(stored).toMatchObject({
    mode: "allow_list",
    basePermissions: null,
    entries: [{ kind: "note", targetId: plan, permissions: ["read", "edit"] }],
  });
  expect((await api(stack, bearer, "GET", `/api/notes/v1/notes/${elsewhere}`)).status).toBe(404);
  expect((await api(stack, bearer, "GET", `/api/notes/v1/notes/${plan}`)).status).toBe(200);
});

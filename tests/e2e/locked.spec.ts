import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { ADA, homeHeading, prepareSignIn, signInWith } from "./helpers/auth";
import { text } from "./helpers/messages";
import { api, seedNote, seedToken } from "./helpers/session-api";
import { createFolder } from "./helpers/tokens";
import { toasts } from "./helpers/wizard";

// /locked: the notes and folders an agent locked, with who, when and why;
// a person unlocks them there, and the agent can change them again.

const t = (key: string, values?: Record<string, string | number>) => text("en", key, values);
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.use({ locale: "en-US" });

test("lists what an agent locked and unlocks it", async ({ page, stack }) => {
  await prepareSignIn(stack, [ADA]);
  await page.goto("/");
  await signInWith(page, "en", ADA);
  await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();
  const folder = await createFolder(page, stack, "Handbook");
  await seedNote(page, stack, folder, "Inside");
  const note = await seedNote(page, stack, null, "Policy");
  const { token } = await seedToken(page, stack, {
    name: "librarian",
    mode: "deny_list",
    basePermissions: ["read", "edit", "lock"],
  });
  const bearer = `Bearer ${token}`;
  for (const path of [`/api/notes/v1/notes/${note}/lock`, `/api/notes/v1/folders/${folder}/lock`]) {
    expect((await api(stack, bearer, "POST", path, { reason: "Approved" })).status).toBe(200);
  }
  const edit = () =>
    api(stack, bearer, "PATCH", `/api/notes/v1/notes/${note}`, { expectedVersion: 1, title: "P2" });
  expect((await edit()).status).toBe(423);

  await page.getByRole("link", { name: t("home.lockedLink") }).click();
  await expect(page.getByRole("heading", { level: 1, name: t("locked.title") })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: t("locked.listTitle", { count: 2 }) }),
  ).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: "Policy" });
  await expect(row).toContainText("librarian");
  await expect(row).toContainText("Approved");
  const folderRow = page.getByRole("listitem").filter({ hasText: "Handbook" });
  await expect(folderRow).toContainText(t("locked.covered", { folders: 0, notes: 1 }));
  const axe = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(axe.violations.map((violation) => violation.id)).toEqual([]);

  await row.getByRole("button", { name: `${t("locked.unlock")} Policy` }).click();
  await expect(toasts(page).first()).toContainText(t("locked.done", { path: "Policy" }));
  await expect(
    page.getByRole("heading", { name: t("locked.listTitle", { count: 1 }) }),
  ).toBeFocused();
  await expect(page.getByRole("listitem").filter({ hasText: "Policy" })).toHaveCount(0);
  expect((await edit()).status).toBe(200);
});

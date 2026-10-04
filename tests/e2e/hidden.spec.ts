import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { ADA, homeHeading, prepareSignIn, signInWith } from "./helpers/auth";
import { text } from "./helpers/messages";
import { api, seedNote, seedToken, sessionAuth } from "./helpers/session-api";
import { createFolder } from "./helpers/tokens";
import { toasts } from "./helpers/wizard";

// /locked lists what is hidden from agents next to what is locked: who hid
// it, when, why, and what a hidden folder covers. Unhiding asks for a
// confirmation naming the item and, unless entered in the last 10 minutes,
// the password (unhiding lets agents read it again); afterwards the agent
// can read it.

const t = (key: string, values?: Record<string, string | number>) => text("en", key, values);
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.use({ locale: "en-US" });

test("lists what is hidden and unhides it after the password", async ({ page, stack }) => {
  await prepareSignIn(stack, [ADA]);
  await page.goto("/");
  await signInWith(page, "en", ADA);
  await expect(homeHeading(page, "en", ADA.displayName)).toBeVisible();
  const vault = await createFolder(page, stack, "Vault");
  await seedNote(page, stack, vault, "Inside");
  const diary = await seedNote(page, stack, null, "Diary");
  const { token } = await seedToken(page, stack, {
    name: "librarian",
    mode: "deny_list",
    basePermissions: ["read", "edit", "hide"],
  });
  const bearer = `Bearer ${token}`;
  const hid = await api(stack, bearer, "POST", `/api/notes/v1/notes/${diary}/hide`, {
    reason: "Customer names",
  });
  expect(hid.status).toBe(200);
  const session = await sessionAuth(page);
  expect(
    (await api(stack, session, "POST", `/api/notes/v1/folders/${vault}/hide`, {})).status,
  ).toBe(200);
  const read = () => api(stack, bearer, "GET", `/api/notes/v1/notes/${diary}`);
  expect(await read()).toMatchObject({ status: 403, body: { error: "hidden" } });

  await page.getByRole("link", { name: t("home.lockedLink") }).click();
  await expect(page.getByRole("heading", { level: 1, name: t("locked.title") })).toBeVisible();
  const hiddenList = page.getByRole("region", { name: t("locked.hidden.listTitle", { count: 2 }) });
  await expect(hiddenList).toBeVisible();
  const row = hiddenList.getByRole("listitem").filter({ hasText: "Diary" });
  await expect(row).toContainText("librarian");
  await expect(row).toContainText("Customer names");
  const folderRow = hiddenList.getByRole("listitem").filter({ hasText: "Vault" });
  await expect(folderRow).toContainText(t("locked.covered", { folders: 0, notes: 1 }));
  const axe = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(axe.violations.map((violation) => violation.id)).toEqual([]);

  await row.getByRole("button", { name: `${t("locked.hidden.unhide")} Diary` }).click();
  const dialog = page.getByRole("dialog", { name: t("locked.hidden.confirm.title") });
  await expect(dialog).toContainText("Diary");
  await expect(dialog).toContainText(t("locked.hidden.confirm.detail"));
  const password = dialog.getByLabel(t("locked.hidden.confirm.passwordLabel"), { exact: true });
  await expect(password).toBeFocused();
  await password.fill("not the password");
  const submit = dialog.getByRole("button", {
    name: t("locked.hidden.confirm.submit"),
    exact: true,
  });
  await submit.click();
  await expect(dialog).toContainText(t("locked.hidden.confirm.passwordWrong"));
  // Nothing changed yet.
  expect((await read()).status).toBe(403);
  await password.fill(ADA.password);
  await submit.click();
  await expect(toasts(page).first()).toContainText(t("locked.hidden.done", { path: "Diary" }));
  await expect(
    page.getByRole("heading", { name: t("locked.hidden.listTitle", { count: 1 }) }),
  ).toBeFocused();
  await expect(page.getByRole("listitem").filter({ hasText: "Diary" })).toHaveCount(0);
  expect((await read()).status).toBe(200);

  // Confirmed a moment ago: the folder is unhidden without the password.
  // The list's name says how many there are now; the locked list is empty.
  const vaultRow = page.getByRole("listitem").filter({ hasText: "Vault" });
  await vaultRow.getByRole("button", { name: `${t("locked.hidden.unhide")} Vault` }).click();
  await expect(dialog).toContainText(t("locked.hidden.confirm.detailFolder"));
  await expect(dialog.getByLabel(t("locked.hidden.confirm.passwordLabel"))).toHaveCount(0);
  await submit.click();
  await expect(
    page.getByRole("heading", { name: t("locked.hidden.listTitle", { count: 0 }) }),
  ).toBeFocused();
  await expect(page.getByText(t("locked.hidden.none"))).toBeVisible();
  const listed = await api(stack, bearer, "GET", `/api/notes/v1/tree?folder=${vault}`);
  expect(listed.status).toBe(200);
});

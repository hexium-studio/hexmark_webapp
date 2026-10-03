import { expect, test } from "./fixtures";
import { clickAt, LayerProbe, until } from "./helpers/layers";

// No compositing layers beyond Chrome's 4 infrastructure layers (root,
// document, root scroller, viewport) in any state of the setup flow without
// toasts, light and dark, in a wide and a narrow window. Only page.evaluate
// and real input from here on.

const SIZES = [
  { width: 1440, height: 900 },
  { width: 375, height: 812 },
];
const BASE_LAYERS = 4;

for (const colorScheme of ["light", "dark"] as const) {
  for (const viewport of SIZES) {
    test.describe(`${colorScheme} ${viewport.width}x${viewport.height}`, () => {
      test.use({ colorScheme, viewport });

      test("only the 4 base layers in every step", async ({ page, stack }) => {
        const probe = new LayerProbe(page);
        const found: string[] = [];
        // Click an empty spot: removes focus (and the caret's own layer).
        const blank = () => page.mouse.click(viewport.width - 4, 4);
        async function check(state: string) {
          await blank();
          const { count, layers } = await probe.measure();
          if (count !== BASE_LAYERS) found.push(`${state}: ${count} layers ${layers.join("  ")}`);
        }

        await page.goto("/setup");
        await probe.attach();
        await until(page, "!!document.querySelector('main section form fieldset')");
        await check("language");

        await clickAt(page, "main section form button[type=submit]");
        await until(page, "!!document.querySelector('main section ul')");
        await check("connection");

        await clickAt(page, "main section div > button", "Continue");
        await until(page, "!!document.querySelector('fieldset#setup-token')");
        await clickAt(page, "#setup-token-1");
        await page.keyboard.type(stack.token.slice(0, 5));
        await check("token, masked, partly typed");

        await clickAt(page, "#setup-token button", "Show");
        await check("token, revealed");

        await clickAt(page, "#setup-token-6");
        await page.keyboard.type(stack.token.slice(5));
        await page.keyboard.press("Enter");
        await until(page, "!!document.querySelector('#account-username')");
        await check("account, empty");

        await clickAt(page, "#account-username");
        await page.keyboard.type("a");
        await page.keyboard.press("Tab");
        await page.keyboard.type("bad@");
        await page.keyboard.press("Tab");
        await until(page, "document.querySelectorAll('li[data-met]').length === 1");
        await check("account, rules partly met");

        // Each field's whole value, typed over what it holds (select all).
        // Not End to reach the end of the text: with the caret there already,
        // Chrome passes the key on to the page, which starts a smooth scroll
        // to the bottom, and the next click lands where the field has
        // already scrolled away from.
        for (const [id, value] of [
          ["#account-displayName", "Ada"],
          ["#account-username", "ada"],
          ["#account-email", "bad@example.com"],
          ["#account-password", "correct horse battery"],
          ["#account-passwordConfirm", "correct horse battery"],
        ]) {
          await clickAt(page, id as string);
          await page.keyboard.press("ControlOrMeta+A");
          await page.keyboard.type(value as string);
        }
        await page.keyboard.press("Enter");
        await until(page, "!!document.querySelector('main section section')");
        // The "Admin account created" toast is an accepted exception. It
        // pauses under the mouse, which may rest where it appears.
        await blank();
        await until(page, "!document.querySelector('[data-toast-id]')", 20_000);
        await check("two-factor step");

        await clickAt(page, "main section button", "Set up authenticator app");
        await until(page, "!!document.querySelector('main svg[role=img]')");
        await check("two-factor, app set-up with QR code");
        await clickAt(page, "main section button", "Cancel");
        await clickAt(page, "main section button", "Skip for now");
        await until(page, "!!document.querySelector('main [role=alert]')");
        await check("two-factor, skip confirmation");
        await clickAt(page, "main section button", "Skip anyway");
        await until(page, "!!document.querySelector('#settings-timezone')");
        await check("settings");

        await clickAt(page, "main section button[type=submit]");
        await until(page, "location.pathname === '/setup/complete'");
        // The success toast is an accepted exception while it is shown.
        await blank();
        await until(page, "!document.querySelector('[data-toast-id]')", 20_000);
        await check("complete, toast gone");

        expect(found).toEqual([]);
      });
    });
  }
}

// Counter-check of the measurement itself: an element with will-change and
// a visible toast must each show up as a layer of their own.
test("the probe sees extra layers", async ({ page }) => {
  const probe = new LayerProbe(page);
  await page.goto("/setup");
  await probe.attach();
  await until(page, "!!document.querySelector('main section form fieldset')");
  expect((await probe.measure()).count).toBe(BASE_LAYERS);

  await page.evaluate(() => {
    const box = document.createElement("div");
    box.id = "layer-check";
    box.style.cssText = "will-change: transform; width: 200px; height: 200px; background: red;";
    document.querySelector("main")?.append(box);
  });
  expect((await probe.measure()).count).toBe(BASE_LAYERS + 1);
  await page.evaluate(() => document.getElementById("layer-check")?.remove());

  // A queued success toast (the cookie a server action sets) shows on load.
  await page
    .context()
    .addCookies([{ name: "hexmark_flash", value: "adminCreated", url: page.url() }]);
  await page.reload();
  await probe.attach();
  await until(page, "!!document.querySelector('[data-toast-id]')");
  expect((await probe.measure()).count).toBeGreaterThan(BASE_LAYERS);
});

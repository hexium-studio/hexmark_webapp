import { expect, test } from "./fixtures";
import { ADA, prepareSignIn } from "./helpers/auth";
import { clickAt, LayerProbe, until } from "./helpers/layers";
import { seedTokenPage } from "./helpers/token-states";

// No compositing layers beyond Chrome's 4 infrastructure layers on the
// token page without toasts: the list and form, the one-time configuration
// and the page after "Done"; light and dark, wide and narrow. The password
// dialog sits in the top layer, an accepted exception while it is open
// (Farbversatz-Diagnose section 2). Only page.evaluate and real input from
// here on (see layers.spec.ts).

const SIZES = [
  { width: 1440, height: 900 },
  { width: 375, height: 812 },
];
const BASE_LAYERS = 4;
const NO_TOASTS = "document.querySelectorAll('[data-toast-id]').length === 0";

for (const colorScheme of ["light", "dark"] as const) {
  for (const viewport of SIZES) {
    test.describe(`${colorScheme} ${viewport.width}x${viewport.height}`, () => {
      test.use({ colorScheme, viewport, locale: "en-US" });

      test("only the 4 base layers in every token page state", async ({ page, stack }) => {
        await prepareSignIn(stack, [ADA]);
        const probe = new LayerProbe(page);
        const found: string[] = [];
        async function check(state: string) {
          await page.mouse.click(viewport.width - 4, 4);
          const { count, layers } = await probe.measure();
          if (count !== BASE_LAYERS) found.push(`${state}: ${count} layers ${layers.join("  ")}`);
        }
        async function type(selector: string, value: string) {
          await clickAt(page, selector);
          await page.keyboard.type(value);
        }

        await page.goto("/");
        await until(page, "!!document.querySelector('#sign-in-email')");
        await type("#sign-in-email", ADA.email);
        await type("#sign-in-password", ADA.password);
        await page.keyboard.press("Enter");
        await until(page, "!!document.querySelector('#home-title')");
        await seedTokenPage(page, stack);
        await page.goto("/account/tokens");
        await probe.attach();
        await until(page, "!!document.querySelector('#tokens-list')");
        await check("list and form");

        await type("#token-name", "layers");
        await clickAt(page, "input[name=mode][value=deny_list]");
        await clickAt(page, "main button[type=submit]");
        await until(page, "!!document.querySelector('dialog[open] #reauth-password')");
        const open = await probe.measure();
        if (open.count <= BASE_LAYERS) found.push(`dialog open: only ${open.count} layers`);
        await page.keyboard.type(ADA.password);
        await page.keyboard.press("Enter");
        await until(page, "!!document.querySelector('#tokens-created-config')");
        await until(page, NO_TOASTS);
        await check("one-time configuration");

        await clickAt(page, "main button", "Done");
        await until(page, "!document.querySelector('#tokens-created-config')");
        await check("after Done");

        expect(found).toEqual([]);
      });
    });
  }
}

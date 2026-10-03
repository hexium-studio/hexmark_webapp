import { expect, test } from "./fixtures";
import { ADA, prepareSignIn } from "./helpers/auth";
import { clickAt, LayerProbe, until } from "./helpers/layers";

// No compositing layers beyond Chrome's 4 infrastructure layers in any state
// of sign-in, home and the blocked page without toasts, light and dark, in a
// wide and a narrow window. Only page.evaluate and real input from here on
// (see layers.spec.ts).

const SIZES = [
  { width: 1440, height: 900 },
  { width: 375, height: 812 },
];
const BASE_LAYERS = 4;

for (const colorScheme of ["light", "dark"] as const) {
  for (const viewport of SIZES) {
    test.describe(`${colorScheme} ${viewport.width}x${viewport.height}`, () => {
      test.use({ colorScheme, viewport });

      test("only the 4 base layers in every sign-in state", async ({ page, stack }) => {
        await prepareSignIn(stack);
        const probe = new LayerProbe(page);
        const found: string[] = [];
        // Click an empty spot: removes focus (and the caret's own layer).
        const blank = () => page.mouse.click(viewport.width - 4, 4);
        async function check(state: string) {
          await blank();
          const { count, layers } = await probe.measure();
          if (count !== BASE_LAYERS) found.push(`${state}: ${count} layers ${layers.join("  ")}`);
        }
        // While typing, Chrome's 1 px caret layer is the only addition.
        async function checkTyping(state: string) {
          const { count, layers } = await probe.measure();
          const caret = layers.filter((layer) => layer.includes("[Caret]")).length;
          if (count !== BASE_LAYERS + caret || caret > 1) {
            found.push(`${state}: ${count} layers ${layers.join("  ")}`);
          }
        }
        async function type(selector: string, value: string) {
          await clickAt(page, selector);
          await page.keyboard.press("ControlOrMeta+A");
          await page.keyboard.type(value);
        }

        await page.goto("/");
        await probe.attach();
        await until(page, "!!document.querySelector('#sign-in-email')");
        await check("sign-in, empty");

        await type("#sign-in-email", "ada@");
        await type("#sign-in-password", "x");
        await until(page, "document.querySelector('main form button[type=submit]').disabled");
        await check("sign-in, invalid e-mail");

        await type("#sign-in-email", ADA.email);
        await checkTyping("typing the e-mail");
        await type("#sign-in-password", "y");
        await checkTyping("typing the password");
        await clickAt(page, "#sign-in-password + button");
        await type("#sign-in-password", "z");
        await checkTyping("typing the shown password");
        await clickAt(page, "input[name=remember]");
        await check("sign-in, filled, password shown, remembered");

        await type("#sign-in-password", "not the password");
        await page.keyboard.press("Enter");
        await until(page, "!!document.querySelector('[data-toast-id]')");
        // The error toast is an accepted exception while it is shown.
        await clickAt(page, "[data-toast-id] button");
        await until(page, "!document.querySelector('[data-toast-id]')");
        await check("sign-in, after the error toast");

        await type("#sign-in-password", ADA.password);
        await page.keyboard.press("Enter");
        await until(page, "!!document.querySelector('#home-title')");
        await check("home");

        await stack.restartServer({ setupToken: stack.token });
        await page.context().clearCookies();
        await page.goto("/");
        await probe.attach();
        await until(page, "!!document.querySelector('main ol')");
        await check("blocked");

        expect(found).toEqual([]);
      });
    });
  }
}

import { expect, test } from "./fixtures";
import { ADA } from "./helpers/auth";
import { clickAt, LayerProbe, until } from "./helpers/layers";
import { awayFromStepEdge, localOrigin, seedTotpAccount, totpCode } from "./helpers/two-factor";

// No compositing layers beyond Chrome's 4 infrastructure layers in the
// second-factor pages without toasts: the second step at sign-in (security
// key button, code cells), the recovery code, and the account security
// page; light and dark, wide and narrow. The confirmation dialog sits in
// the top layer, an accepted exception while it is open (like toasts,
// Farbversatz-Diagnose section 2): it must add layers only while open.
// Only page.evaluate and real input from here on (see layers.spec.ts).

const SIZES = [
  { width: 1440, height: 900 },
  { width: 375, height: 812 },
];
const BASE_LAYERS = 4;

for (const colorScheme of ["light", "dark"] as const) {
  for (const viewport of SIZES) {
    test.describe(`${colorScheme} ${viewport.width}x${viewport.height}`, () => {
      test.use({ colorScheme, viewport, locale: "en-US" });

      test("only the 4 base layers in every second-factor state", async ({ page, stack }) => {
        const origin = localOrigin(stack);
        const { secret } = await seedTotpAccount(
          stack,
          ADA,
          { env: { PUBLIC_ORIGIN: origin } },
          origin,
        );
        const probe = new LayerProbe(page);
        const found: string[] = [];
        const blank = () => page.mouse.click(viewport.width - 4, 4);
        async function check(state: string, expected = BASE_LAYERS) {
          await blank();
          const { count, layers } = await probe.measure();
          if (count !== expected) found.push(`${state}: ${count} layers ${layers.join("  ")}`);
        }
        async function type(selector: string, value: string) {
          await clickAt(page, selector);
          await page.keyboard.type(value);
        }

        await page.goto(origin);
        await probe.attach();
        await until(page, "!!document.querySelector('#sign-in-email')");
        await type("#sign-in-email", ADA.email);
        await type("#sign-in-password", ADA.password);
        await page.keyboard.press("Enter");
        await until(page, "!!document.querySelector('#second-factor-code-1')");
        await check("second factor: key button and code cells");

        await type("#second-factor-code-1", "12");
        await check("second factor: partly typed");

        await clickAt(page, "main button", "Use a recovery code instead");
        await until(page, "!!document.querySelector('#recovery-code-1')");
        await type("#recovery-code-1", "ABCD");
        await check("recovery code");

        await clickAt(page, "main button", "Back");
        await until(page, "!!document.querySelector('#second-factor-code-1')");
        await awayFromStepEdge();
        await type("#second-factor-code-1", totpCode(secret));
        await page.keyboard.press("Enter");
        await until(page, "!!document.querySelector('#home-title')");
        await page.goto(`${origin}/account/security`);
        await probe.attach();
        await until(page, "!!document.querySelector('#security-keys')");
        await check("account security page");

        await clickAt(page, "main button", "Generate new codes");
        await until(page, "!!document.querySelector('dialog[open]')");
        const open = await probe.measure();
        if (open.count <= BASE_LAYERS) found.push(`dialog open: only ${open.count} layers`);
        await page.keyboard.press("Escape");
        await until(page, "!document.querySelector('dialog')");
        await check("account page after the dialog");

        expect(found).toEqual([]);
      });
    });
  }
}

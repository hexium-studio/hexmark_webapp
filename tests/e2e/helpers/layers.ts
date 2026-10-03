import type { CDPSession, Page } from "@playwright/test";

// Compositing layer measurement through the Chrome DevTools Protocol
// (~/Projects/Farbversatz-Diagnose, section 2). While measuring, only
// page.evaluate and real mouse/keyboard input may touch the page: every
// Playwright locator and waitForFunction adds a viewport layer of its own.

export interface LayerInfo {
  count: number;
  // "<w>x<h>@<x>,<y>[reasons]" per layer, for failure messages.
  layers: string[];
}

export class LayerProbe {
  private layers: {
    layerId: string;
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
  }[] = [];
  private cdp: CDPSession | undefined;

  constructor(private readonly page: Page) {}

  // Call after every full page load: a navigation may swap the renderer,
  // which drops the enabled domains.
  async attach(): Promise<void> {
    if (!this.cdp) {
      this.cdp = await this.page.context().newCDPSession(this.page);
      this.cdp.on("LayerTree.layerTreeDidChange", (event) => {
        if (event.layers) this.layers = event.layers;
      });
    }
    await this.cdp.send("DOM.enable");
    await this.cdp.send("LayerTree.enable");
  }

  async measure(): Promise<LayerInfo> {
    // Chrome reports the tree only when a frame is drawn. A short colour
    // animation (painted on the main thread, never composited) forces a few
    // frames, so the report is current even on a page that did not change.
    await this.page.evaluate(() => {
      const color = getComputedStyle(document.body).color;
      document.body.animate([{ color }, { color: "rgb(1, 2, 3)" }, { color }], 100);
    });
    // Time for the compositor to settle and report.
    await this.page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 800)));
    const layers: string[] = [];
    for (const layer of this.layers) {
      let reasons: string[] = [];
      try {
        const result = await this.cdp?.send("LayerTree.compositingReasons", {
          layerId: layer.layerId,
        });
        reasons = result?.compositingReasonIds ?? [];
      } catch {
        // the layer is gone already
      }
      const size = `${Math.round(layer.width)}x${Math.round(layer.height)}`;
      layers.push(
        `${size}@${Math.round(layer.offsetX)},${Math.round(layer.offsetY)}[${reasons.join(",")}]`,
      );
    }
    return { count: this.layers.length, layers };
  }
}

// Polls a condition in the page with page.evaluate only.
export async function until(page: Page, condition: string, timeoutMs = 15_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await page.evaluate(condition)) return;
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  }
  throw new Error(`timed out waiting for: ${condition}`);
}

// A real mouse click in the middle of the last element matching `selector`
// (optionally containing `text`).
export async function clickAt(page: Page, selector: string, text?: string): Promise<void> {
  const point = await page.evaluate(
    ([sel, needle]) => {
      const element = [...document.querySelectorAll(sel)]
        .filter((candidate) => !needle || candidate.textContent?.includes(needle))
        .at(-1);
      if (!element) return null;
      element.scrollIntoView({ block: "center" });
      const rect = element.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    },
    [selector, text ?? ""] as const,
  );
  if (!point) throw new Error(`nothing to click: ${selector} ${text ?? ""}`);
  await page.mouse.click(point.x, point.y);
}

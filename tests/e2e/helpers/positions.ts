import type { Page } from "@playwright/test";

// Where the given elements sit on the page (top edge in document
// coordinates, CSS pixels), keyed by selector. Comparing two snapshots shows
// whether anything moved in between.
export async function topsOf(page: Page, selectors: readonly string[]) {
  return page.evaluate((list) => {
    const tops: Record<string, number | null> = {};
    for (const selector of list) {
      const element = document.querySelector(selector);
      tops[selector] = element ? element.getBoundingClientRect().top + window.scrollY : null;
    }
    return tops;
  }, selectors);
}

/**
 * The `__name` shim.
 *
 * tsx compiles this package with esbuild's `keepNames`, which rewrites a named
 * function into `__name(fn, "fn")` so `Function.prototype.name` survives
 * minification. Playwright serialises an `evaluate` callback to *source* and runs
 * it inside the page, where that helper does not exist — so any callback holding a
 * named inner function, or any source string produced by `fn.toString()`, dies with
 * `ReferenceError: __name is not defined`.
 *
 * It is a shim rather than a rule against naming functions because the failure is
 * invisible until a specific evaluate runs: the code typechecks, the tests pass,
 * and it breaks on a live page. Every place that opens a page installs this.
 */

import type { BrowserContext, Page } from 'playwright-core';

const SOURCE = 'globalThis.__name = globalThis.__name || function (f) { return f; };';

/**
 * Install on a context, so every page it opens has it before any script runs.
 * Prefer this over the per-page form: a navigation resets the page's global scope,
 * and an init script is re-applied where a one-off evaluate would be lost.
 */
export async function installNameShim(target: BrowserContext | Page): Promise<void> {
  await target.addInitScript({ content: SOURCE });
}

/**
 * Logo extraction — the hamburger regression.
 *
 * `extractBrand` runs in a real page, so this suite drives a real Chromium. The
 * fixture has the nav hamburger BEFORE the actual logo in DOM order, which is
 * exactly the case that used to ship a menu icon as the brand mark. jsdom has no
 * layout (getBoundingClientRect is all-zero), so this cannot live in the unit
 * suite.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';

import { extractBrand } from '../../src/browser/brand.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = pathToFileURL(join(here, 'fixtures', 'logo-page.html')).href;

describe('logo extraction', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('picks the brand logo, not the hamburger that precedes it in the DOM', async () => {
    const page = await browser.newPage();
    await page.goto(fixture, { waitUntil: 'load' });

    const brand = await extractBrand(page);
    await page.close();

    // The chosen mark must be the big "TestCo" logo, not the 18px menu icon.
    expect(brand.logoSvg).toBeTruthy();
    expect(brand.logoSvg).toContain('TestCo');
    expect(brand.logoSvg).not.toContain('M3 12h18');
  });
});

#!/usr/bin/env node
/**
 * postinstall — tell the user what is still missing.
 *
 * `playwright-core` deliberately ships without a browser, so a global install has
 * everything except the one binary a render cannot proceed without. Left to itself
 * the first run fails inside Chromium launch with a message about an executable
 * path, which reads like a bug in this tool rather than a missing download.
 *
 * It only ever *reports*. Downloading ~150MB unprompted during someone's install is
 * the kind of thing a package should ask for, not decide.
 *
 * Two things this file must never do, both learned by breaking a real install:
 *
 * 1. **Exit non-zero.** A failed postinstall aborts the whole install, and a missing
 *    browser is not a reason to refuse to be installed.
 * 2. **Be absent.** npm runs this from the *installed* package, so the file has to
 *    be listed in `files` — otherwise `npm i -g` dies with MODULE_NOT_FOUND before
 *    the package is usable at all.
 */

import { existsSync } from 'node:fs';

const CYAN = '[36m';
const DIM = '[2m';
const YELLOW = '[33m';
const RESET = '[0m';

async function chromiumPresent() {
  try {
    const { chromium } = await import('playwright-core');
    const path = chromium.executablePath();
    return Boolean(path) && existsSync(path);
  } catch {
    return false;
  }
}

async function main() {
  // A CI job or a nested install should stay quiet.
  if (process.env.CI || process.env.npm_config_loglevel === 'silent') return;

  const hasChromium = await chromiumPresent();

  console.log('');
  console.log(`${CYAN}urlume${RESET} installed.`);
  console.log('');

  if (!hasChromium) {
    console.log(`${YELLOW}One more step — the browser it renders with:${RESET}`);
    console.log('');
    console.log('  npx playwright-core install chromium');
    console.log('');
    console.log(`${DIM}  ~150MB, downloaded once. Films are rasterised frame by frame`);
    console.log(`  in a real Chromium, so there is no way around it.`);
    console.log('');
    console.log(`  Note the name: playwright-core, not playwright. Each version`);
    console.log(`  expects one specific browser revision, and this fetches the one`);
    console.log(`  urlume actually looks for.${RESET}`);
    console.log('');
  }

  console.log('Then:');
  console.log('');
  console.log(`  ${CYAN}urlume${RESET}              open the interactive interface`);
  console.log(`  ${CYAN}urlume doctor${RESET}       check everything is ready`);
  console.log('');
  console.log(`${DIM}Set an API key inside with /key, or export ANTHROPIC_API_KEY`);
  console.log(`(also OPENAI_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY).${RESET}`);
  console.log('');
}

// Never fail an install over a courtesy message.
main().catch(() => {});

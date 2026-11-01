/**
 * TUI entry point.
 *
 * Separate from `app.tsx` so `cli.ts` can import this without pulling React and Ink
 * into the cold start of every non-interactive subcommand. `urlume render` should
 * not pay for a UI it never draws.
 */

import { createElement } from 'react';
import { render } from 'ink';

import { App } from './app.js';

export { doctor } from './app.js';

export async function startTui(version: string): Promise<void> {
  // Ink needs a real TTY: without one it cannot read keys or position the cursor,
  // and it fails in ways that look like a hang rather than an error. A pipe or a CI
  // job should use the subcommands instead.
  if (!process.stdin.isTTY) {
    console.error(
      '\nThe interactive interface needs a terminal.\n\n' +
        'In a pipe or a CI job use the subcommands instead:\n' +
        '  urlume create <url> --prompt "..."\n'
    );
    process.exit(1);
  }

  const instance = render(createElement(App, { version }), {
    // Ink installs its own handler; ours in `useInput` decides between cancelling a
    // render and quitting, so the default must not pre-empt it.
    exitOnCtrlC: false,
  });

  await instance.waitUntilExit();
}

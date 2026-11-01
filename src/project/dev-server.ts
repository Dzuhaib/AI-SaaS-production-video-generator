/**
 * Dev server supervisor.
 *
 * Starting the project is the one place urlume runs code it did not write, so
 * three things matter here beyond "spawn a process":
 *
 * 1. **Permission.** The caller supplies an `approve` callback. No command runs
 *    without it returning true.
 * 2. **The real port.** Frameworks fall back to the next free port when the
 *    default is taken, and print the one they chose. Assuming 3000 sends the
 *    browser to whatever else is running there — which fails confusingly, or
 *    worse, succeeds against the wrong app.
 * 3. **Teardown.** A dev server spawns children (esbuild, a watcher, a worker).
 *    Killing only the parent leaves the port held and the next run fails.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export interface DevServerOptions {
  command: string;
  cwd: string;
  /** Hint only; the parsed port always wins. */
  expectedPort?: number;
  /** Must return true before anything is spawned. */
  approve: (command: string) => Promise<boolean>;
  /** Time to wait for the server to answer. */
  timeoutMs?: number;
  env?: Record<string, string>;
  onLog?: (line: string) => void;
}

export interface DevServer {
  url: string;
  port: number;
  stop(): Promise<void>;
}

export class DevServerError extends Error {
  readonly hints: readonly string[];
  readonly output: string;

  constructor(message: string, hints: readonly string[], output: string) {
    super(message);
    this.name = 'DevServerError';
    this.hints = hints;
    this.output = output;
  }

  format(): string {
    const lines = [this.message, ''];
    lines.push(...this.hints);
    const tail = this.output.trim().split('\n').slice(-12);
    if (tail.length) {
      lines.push('', 'Last output from the dev server:');
      lines.push(...tail.map((l) => `  ${l}`));
    }
    return lines.join('\n');
  }
}

/**
 * Pull a URL or port out of dev-server output.
 *
 * Every framework prints something different, so this matches shapes rather
 * than any one format:
 *   Next.js    - Local:  http://localhost:3000
 *   Vite       ➜  Local:   http://localhost:5173/
 *   SvelteKit  ➜  Local:   http://localhost:5173/
 *   Astro      ┃ Local    http://localhost:4321/
 */
export function parsePort(chunk: string): number | null {
  // A full URL is the strongest signal, and it also confirms the host.
  const url = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})/i.exec(chunk);
  if (url) return Number(url[1]);

  // Fall back to an explicit "port NNNN" phrasing.
  const port = /\bport[:\s]+(\d{2,5})\b/i.exec(chunk);
  if (port) {
    const n = Number(port[1]);
    if (n >= 1024 && n <= 65535) return n;
  }
  return null;
}

/** Poll until the server actually answers. A printed URL means the process
 *  decided on a port, not that it is ready to serve. */
async function waitForServer(
  url: string,
  timeoutMs: number,
  isAlive: () => boolean
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive()) return false;
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
        redirect: 'manual',
      });
      // Any HTTP response proves something is listening and speaking HTTP. A
      // 404 at `/` is fine — the film may only ever visit `/dashboard`.
      if (res.status > 0) return true;
    } catch {
      // Not up yet.
    }
    await delay(250);
  }
  return false;
}

/**
 * Kill the whole process tree.
 *
 * On Windows a spawned `npm.cmd` sits between us and node, and `child.kill()`
 * only reaches the shim — leaving the real server holding the port. `taskkill /T`
 * walks the tree. POSIX gets a process group kill via the negative pid, which
 * requires `detached: true` at spawn.
 */
async function killTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  if (!pid) return;

  if (process.platform === 'win32') {
    await new Promise<void>((resolvePromise) => {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.on('close', () => resolvePromise());
      killer.on('error', () => {
        child.kill('SIGKILL');
        resolvePromise();
      });
    });
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }

  // Give it a moment to exit cleanly, then insist.
  for (let i = 0; i < 20; i++) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await delay(100);
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

export async function startDevServer(opts: DevServerOptions): Promise<DevServer> {
  const approved = await opts.approve(opts.command);
  if (!approved) {
    throw new DevServerError(
      'Permission denied for the dev server command.',
      [`urlume needs to run \`${opts.command}\` to film the project.`],
      ''
    );
  }

  const [bin, ...args] = opts.command.split(/\s+/);
  if (!bin) throw new DevServerError('Empty dev command.', [], '');

  const child = spawn(bin, args, {
    cwd: opts.cwd,
    // A package-manager shim needs a shell on Windows to resolve `.cmd`.
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32',
    windowsHide: true,
    env: {
      ...process.env,
      ...opts.env,
      FORCE_COLOR: '0', // ANSI escapes would corrupt port parsing
      BROWSER: 'none', // stop CRA and friends opening a real browser
    },
  });

  let output = '';
  let port: number | null = null;
  let exited: { code: number | null; signal: string | null } | null = null;

  const onChunk = (buf: Buffer) => {
    const text = buf.toString();
    output += text;
    if (output.length > 96_000) output = output.slice(-48_000);
    for (const line of text.split('\n')) {
      if (line.trim()) opts.onLog?.(line.trimEnd());
    }
    if (port === null) port = parsePort(text);
  };

  child.stdout?.on('data', onChunk);
  child.stderr?.on('data', onChunk);
  child.on('exit', (code, signal) => {
    exited = { code, signal };
  });

  const timeoutMs = opts.timeoutMs ?? 90_000;
  const deadline = Date.now() + timeoutMs;

  // Wait for a port to be announced.
  while (port === null && Date.now() < deadline) {
    if (exited) {
      const e = exited as { code: number | null; signal: string | null };
      throw new DevServerError(
        `The dev server exited before it started listening (code ${e.code ?? e.signal}).`,
        [
          `Command: ${opts.command}`,
          `Run it yourself in ${opts.cwd} to see the full error.`,
          'A missing .env value or an unbuilt dependency is the usual cause.',
        ],
        output
      );
    }
    await delay(150);
  }

  if (port === null) {
    // Some servers print nothing useful. If a port was expected, probe it before
    // giving up — a silent-but-working server is better than a false failure.
    const guess = opts.expectedPort;
    if (guess) {
      const up = await waitForServer(`http://localhost:${guess}/`, 5_000, () => !exited);
      if (up) port = guess;
    }
  }

  if (port === null) {
    await killTree(child);
    throw new DevServerError(
      `The dev server did not report a port within ${Math.round(timeoutMs / 1000)}s.`,
      [
        `Command: ${opts.command}`,
        'urlume reads the port from the server\'s own output. If this project prints',
        'nothing on startup, set the port explicitly in .urlume/config.json.',
      ],
      output
    );
  }

  const url = `http://localhost:${port}/`;
  const remaining = Math.max(5_000, deadline - Date.now());
  const alive = await waitForServer(url, remaining, () => !exited);

  if (!alive) {
    await killTree(child);
    throw new DevServerError(
      `The dev server announced port ${port} but never answered a request.`,
      [
        `Tried: ${url}`,
        'The process is running but not serving. Check whether it is still compiling,',
        'or whether it bound to a different host than localhost.',
      ],
      output
    );
  }

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await killTree(child);
  };

  // A crash on Ctrl-C would otherwise leave the port held.
  const onSignal = () => {
    void stop();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  process.once('exit', () => {
    if (!stopped && child.pid) {
      try {
        process.platform === 'win32' ? child.kill() : process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Nothing useful to do during exit.
      }
    }
  });

  return { url, port, stop };
}

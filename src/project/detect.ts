/**
 * Framework detection.
 *
 * Adapters behind one interface, so adding a framework is additive: write a
 * detector, add it to the list, change nothing else. Order matters — the first
 * confident match wins, so more specific frameworks are checked before the
 * generic ones they are built on (Next.js before React, SvelteKit before Vite).
 *
 * Nothing here runs project code. Detection reads files only; starting the dev
 * server is a separate, permission-gated step.
 */

import { readFile, readdir, access } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface ProjectInfo {
  name: string;
  framework: string;
  /** How sure the detector is. Below 0.5 the caller should confirm with the user. */
  confidence: number;
  packageManager: PackageManager;
  /** Script name in package.json, not the full command. */
  devScript: string | null;
  /** Full command to run, e.g. `pnpm dev`. */
  devCommand: string | null;
  /** Port the framework uses when nothing overrides it. The supervisor still
   *  parses the real port from stdout — this is only a hint for the log. */
  defaultPort: number;
  /** Routes inferred from the filesystem. Not authoritative: a route may exist
   *  that no file describes, and a file may not be a route. */
  routes: string[];
  root: string;
  /** Directories that may hold logos, screenshots and fonts worth reusing. */
  assetDirs: string[];
}

interface DetectContext {
  root: string;
  entries: Set<string>;
  pkg: PackageJson | null;
  deps: Record<string, string>;
}

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  packageManager?: string;
}

interface Detector {
  framework: string;
  detect(ctx: DetectContext): Promise<Omit<ProjectInfo, 'root' | 'name' | 'packageManager' | 'assetDirs'> | null>;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Walk a routes directory, mapping files to URL paths. */
async function walkRoutes(
  dir: string,
  opts: { pageNames: string[]; extensions: string[]; base?: string; depth?: number }
): Promise<string[]> {
  const { pageNames, extensions, base = '', depth = 0 } = opts;
  if (depth > 5) return []; // deep nesting is almost always generated output

  // Annotated as Dirent[] rather than Awaited<ReturnType<typeof readdir>>: that
  // resolves to the *last* overload of readdir, which is the one returning
  // Dirent<Buffer>, so every `entry.name` below would be a Buffer and none of the
  // string comparisons would mean anything.
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const routes: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules' || entry.name === 'api') continue;

    if (entry.isDirectory()) {
      // Next.js route groups `(marketing)` do not appear in the URL.
      const segment = /^\(.+\)$/.test(entry.name) ? base : `${base}/${entry.name}`;
      routes.push(
        ...(await walkRoutes(join(dir, entry.name), {
          pageNames,
          extensions,
          base: segment,
          depth: depth + 1,
        }))
      );
      continue;
    }

    const dot = entry.name.lastIndexOf('.');
    if (dot === -1) continue;
    const stem = entry.name.slice(0, dot);
    const ext = entry.name.slice(dot);
    if (!extensions.includes(ext)) continue;

    if (pageNames.includes(stem)) {
      routes.push(base || '/');
    } else if (pageNames.length === 0) {
      // pages/-style routing: the filename itself is the segment.
      routes.push(stem === 'index' ? base || '/' : `${base}/${stem}`);
    }
  }
  return routes;
}

/** A dynamic segment cannot be visited without knowing a real id. */
const isStatic = (route: string) => !/[[\]:]/.test(route);

function dedupeRoutes(routes: string[]): string[] {
  return [...new Set(routes.filter(isStatic))].sort((a, b) => {
    if (a === '/') return -1;
    if (b === '/') return 1;
    return a.localeCompare(b);
  });
}

/* ------------------------------------------------------------------ *
 * Detectors, most specific first
 * ------------------------------------------------------------------ */

const nextjs: Detector = {
  framework: 'Next.js',
  async detect(ctx) {
    const hasConfig = [...ctx.entries].some((e) => /^next\.config\.(js|mjs|ts|cjs)$/.test(e));
    if (!hasConfig && !ctx.deps.next) return null;

    // App Router and Pages Router can coexist; collect both.
    const routes: string[] = [];
    for (const dir of ['app', 'src/app']) {
      if (await exists(join(ctx.root, dir))) {
        routes.push(
          ...(await walkRoutes(join(ctx.root, dir), {
            pageNames: ['page'],
            extensions: ['.tsx', '.jsx', '.ts', '.js'],
          }))
        );
      }
    }
    for (const dir of ['pages', 'src/pages']) {
      if (await exists(join(ctx.root, dir))) {
        routes.push(
          ...(await walkRoutes(join(ctx.root, dir), {
            pageNames: [],
            extensions: ['.tsx', '.jsx', '.ts', '.js'],
          }))
        );
      }
    }

    return {
      framework: 'Next.js',
      confidence: hasConfig && ctx.deps.next ? 1 : 0.8,
      devScript: 'dev',
      devCommand: null,
      defaultPort: 3000,
      routes: dedupeRoutes(routes.length ? routes : ['/']),
    };
  },
};

const sveltekit: Detector = {
  framework: 'SvelteKit',
  async detect(ctx) {
    if (!ctx.deps['@sveltejs/kit']) return null;
    const routes = await walkRoutes(join(ctx.root, 'src/routes'), {
      pageNames: ['+page'],
      extensions: ['.svelte'],
    });
    return {
      framework: 'SvelteKit',
      confidence: 1,
      devScript: 'dev',
      devCommand: null,
      defaultPort: 5173,
      routes: dedupeRoutes(routes.length ? routes : ['/']),
    };
  },
};

const astro: Detector = {
  framework: 'Astro',
  async detect(ctx) {
    const hasConfig = [...ctx.entries].some((e) => /^astro\.config\./.test(e));
    if (!hasConfig && !ctx.deps.astro) return null;
    const routes = await walkRoutes(join(ctx.root, 'src/pages'), {
      pageNames: [],
      extensions: ['.astro', '.md', '.mdx'],
    });
    return {
      framework: 'Astro',
      confidence: hasConfig ? 1 : 0.8,
      devScript: 'dev',
      devCommand: null,
      defaultPort: 4321,
      routes: dedupeRoutes(routes.length ? routes : ['/']),
    };
  },
};

const nuxt: Detector = {
  framework: 'Nuxt',
  async detect(ctx) {
    const hasConfig = [...ctx.entries].some((e) => /^nuxt\.config\./.test(e));
    if (!hasConfig && !ctx.deps.nuxt) return null;
    const routes = await walkRoutes(join(ctx.root, 'pages'), {
      pageNames: [],
      extensions: ['.vue'],
    });
    return {
      framework: 'Nuxt',
      confidence: hasConfig ? 1 : 0.8,
      devScript: 'dev',
      devCommand: null,
      defaultPort: 3000,
      routes: dedupeRoutes(routes.length ? routes : ['/']),
    };
  },
};

/**
 * Vite covers React, Vue, Svelte and Solid. The framework name is refined from
 * dependencies, because "Vite" alone does not tell the analyzer what the UI is
 * built from.
 */
const vite: Detector = {
  framework: 'Vite',
  async detect(ctx) {
    const hasConfig = [...ctx.entries].some((e) => /^vite\.config\./.test(e));
    if (!hasConfig && !ctx.deps.vite) return null;

    const ui = ctx.deps.react
      ? 'React'
      : ctx.deps.vue
        ? 'Vue'
        : ctx.deps.svelte
          ? 'Svelte'
          : ctx.deps['solid-js']
            ? 'Solid'
            : null;

    // A Vite SPA has one HTML entry; routes live in a client router that only
    // running the app would reveal. Report `/` and let the browser analyzer
    // discover the rest from in-page links.
    return {
      framework: ui ? `${ui} (Vite)` : 'Vite',
      confidence: hasConfig ? 0.9 : 0.7,
      devScript: 'dev',
      devCommand: null,
      defaultPort: 5173,
      routes: ['/'],
    };
  },
};

const cra: Detector = {
  framework: 'React (CRA)',
  async detect(ctx) {
    if (!ctx.deps['react-scripts']) return null;
    return {
      framework: 'React (CRA)',
      confidence: 0.9,
      devScript: 'start',
      devCommand: null,
      defaultPort: 3000,
      routes: ['/'],
    };
  },
};

/**
 * Static HTML. Last, because almost every project has an index.html somewhere;
 * this only fires when nothing else matched.
 */
const staticHtml: Detector = {
  framework: 'Static HTML',
  async detect(ctx) {
    const html = [...ctx.entries].filter((e) => e.endsWith('.html'));
    if (!html.length) return null;

    const routes = html.map((f) => (f === 'index.html' ? '/' : `/${f}`));
    return {
      framework: 'Static HTML',
      confidence: 0.6,
      devScript: null,
      // Served by urlume's own static server rather than a project dev command.
      devCommand: null,
      defaultPort: 0,
      routes: dedupeRoutes(routes),
    };
  },
};

const DETECTORS: readonly Detector[] = [
  nextjs,
  sveltekit,
  astro,
  nuxt,
  cra,
  vite,
  staticHtml,
];

/* ------------------------------------------------------------------ *
 * Package manager
 * ------------------------------------------------------------------ */

/**
 * From the lockfile, never hardcoded.
 *
 * Running `npm install` in a pnpm workspace produces a broken node_modules and
 * a very confusing error several steps later, so this is worth getting right.
 * `packageManager` in package.json (Corepack) is the strongest signal when
 * present, since it is an explicit declaration rather than an artefact.
 */
export function detectPackageManager(entries: Set<string>, pkg: PackageJson | null): PackageManager {
  const declared = pkg?.packageManager?.split('@')[0];
  if (declared === 'pnpm' || declared === 'yarn' || declared === 'bun' || declared === 'npm') {
    return declared;
  }
  if (entries.has('pnpm-lock.yaml')) return 'pnpm';
  if (entries.has('bun.lockb') || entries.has('bun.lock')) return 'bun';
  if (entries.has('yarn.lock')) return 'yarn';
  return 'npm';
}

/** `pnpm dev` / `npm run dev` — npm is the one that needs `run`. */
export function devCommandFor(pm: PackageManager, script: string): string {
  return pm === 'npm' ? `npm run ${script}` : `${pm} ${script}`;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export async function detectProject(root: string): Promise<ProjectInfo | null> {
  let entries: Set<string>;
  try {
    entries = new Set(await readdir(root));
  } catch {
    return null;
  }

  let pkg: PackageJson | null = null;
  if (entries.has('package.json')) {
    try {
      pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as PackageJson;
    } catch {
      // Malformed package.json is not fatal — a static site may still render.
    }
  }

  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const ctx: DetectContext = { root, entries, pkg, deps };

  for (const detector of DETECTORS) {
    const hit = await detector.detect(ctx);
    if (!hit) continue;

    const packageManager = detectPackageManager(entries, pkg);

    // Only claim a dev script that actually exists.
    let devScript = hit.devScript;
    if (devScript && !pkg?.scripts?.[devScript]) {
      devScript =
        (['dev', 'start', 'serve'] as const).find((s) => pkg?.scripts?.[s]) ?? null;
    }

    const assetDirs: string[] = [];
    for (const dir of ['public', 'static', 'assets', 'src/assets']) {
      if (await exists(join(root, dir))) assetDirs.push(dir);
    }

    return {
      name: pkg?.name ?? root.split(/[/\\]/).filter(Boolean).pop() ?? 'project',
      framework: hit.framework,
      confidence: hit.confidence,
      packageManager,
      devScript,
      devCommand: devScript ? devCommandFor(packageManager, devScript) : null,
      defaultPort: hit.defaultPort,
      routes: hit.routes,
      root,
      assetDirs,
    };
  }

  return null;
}

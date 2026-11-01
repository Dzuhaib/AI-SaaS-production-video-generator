/**
 * The agent tool registry.
 *
 * Every tool the model can call, with typed input, validated arguments, a
 * permission class, and an error path that returns a message rather than
 * throwing. A tool that throws kills the agent loop; a tool that returns
 * `{ ok: false, error }` lets the model read what went wrong and try something
 * else, which is almost always what should happen.
 *
 * Permission classes decide what needs asking:
 *
 *   read     inspect the project or the page. Never prompted.
 *   write    write inside `.urlume/`. Never prompted — it is our own directory.
 *   exec     run a project command. **Always** prompted.
 *   network  reach a provider or a URL. Prompted once per session.
 *
 * The class is on the tool, not decided at the call site, so a new tool cannot
 * quietly acquire dangerous reach.
 */

import { z } from 'zod';

export type Permission = 'read' | 'write' | 'exec' | 'network';

export interface ToolResult {
  ok: boolean;
  /** Rendered back to the model. Keep it short — this is context. */
  content: string;
  /** Structured payload for the orchestrator, not for the model. */
  data?: unknown;
}

export interface ToolContext {
  cwd: string;
  /** Called before any `exec` tool runs. Returning false aborts the call. */
  approve(action: string, detail: string): Promise<boolean>;
  /** Progress line for the TUI. */
  log(message: string): void;
  /** Shared mutable state across a run — project info, brand, storyboard. */
  state: Record<string, unknown>;
}

export interface Tool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  permission: Permission;
  schema: S;
  run(args: z.infer<S>, ctx: ToolContext): Promise<ToolResult>;
}

/** Helper so each tool declaration stays readable. */
function tool<S extends z.ZodTypeAny>(spec: Tool<S>): Tool<S> {
  return spec;
}

/* ------------------------------------------------------------------ *
 * Project inspection
 * ------------------------------------------------------------------ */

export const detectFramework = tool({
  name: 'detect_framework',
  description:
    'Detect the framework, package manager, dev command and candidate routes of ' +
    'the project in the working directory. Call this first.',
  permission: 'read',
  schema: z.object({}),
  async run(_args, ctx) {
    const { detectProject } = await import('../project/detect.js');
    const info = await detectProject(ctx.cwd);
    if (!info) {
      return {
        ok: false,
        content:
          `No recognised web project in ${ctx.cwd}. Supported: Next.js, Vite ` +
          `(React/Vue/Svelte/Solid), SvelteKit, Astro, Nuxt, CRA, static HTML.`,
      };
    }
    ctx.state.project = info;
    return {
      ok: true,
      content:
        `${info.framework} (confidence ${info.confidence}), package manager ` +
        `${info.packageManager}, dev command \`${info.devCommand ?? 'none'}\`. ` +
        `Routes found: ${info.routes.join(', ')}`,
      data: info,
    };
  },
});

export const listFiles = tool({
  name: 'list_files',
  description:
    'List files under a path relative to the project root. Use to find assets, ' +
    'logos or route files. Never leaves the project directory.',
  permission: 'read',
  schema: z.object({
    path: z.string().default('.'),
    /** Depth cap keeps a monorepo from filling the context. */
    depth: z.number().int().min(1).max(3).default(1),
  }),
  async run(args, ctx) {
    const { readdir } = await import('node:fs/promises');
    const { join, resolve, relative } = await import('node:path');

    const target = resolve(ctx.cwd, args.path);
    // Path traversal guard: a model asking for `../../.ssh` gets refused.
    if (relative(ctx.cwd, target).startsWith('..')) {
      return { ok: false, content: 'Refused: path is outside the project directory.' };
    }

    const skip = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.urlume']);
    const found: string[] = [];

    async function walk(dir: string, depth: number): Promise<void> {
      if (depth > args.depth || found.length > 300) return;
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (skip.has(entry.name) || entry.name.startsWith('.')) continue;
        const full = join(dir, entry.name);
        found.push(relative(ctx.cwd, full).replace(/\\/g, '/'));
        if (entry.isDirectory()) await walk(full, depth + 1);
      }
    }

    try {
      await walk(target, 1);
    } catch (err) {
      return { ok: false, content: `Could not read ${args.path}: ${(err as Error).message}` };
    }

    return { ok: true, content: found.slice(0, 300).join('\n'), data: found };
  },
});

export const readFileTool = tool({
  name: 'read_file',
  description:
    'Read a text file from the project. Use for package.json, a route file, or ' +
    'a config. Truncated at 24KB.',
  permission: 'read',
  schema: z.object({ path: z.string() }),
  async run(args, ctx) {
    const { readFile } = await import('node:fs/promises');
    const { resolve, relative } = await import('node:path');

    const target = resolve(ctx.cwd, args.path);
    if (relative(ctx.cwd, target).startsWith('..')) {
      return { ok: false, content: 'Refused: path is outside the project directory.' };
    }
    // Reading a project's .env would put its secrets into a provider request.
    if (/(^|[/\\])\.env/.test(args.path)) {
      return {
        ok: false,
        content:
          'Refused: .env files are not read. If the dev server needs an ' +
          'environment value, it inherits the shell environment.',
      };
    }

    try {
      const text = await readFile(target, 'utf8');
      return {
        ok: true,
        content: text.length > 24_000 ? `${text.slice(0, 24_000)}\n… truncated` : text,
      };
    } catch (err) {
      return { ok: false, content: `Could not read ${args.path}: ${(err as Error).message}` };
    }
  },
});

/* ------------------------------------------------------------------ *
 * Dev server and browser
 * ------------------------------------------------------------------ */

export const startDevServerTool = tool({
  name: 'start_dev_server',
  description:
    'Start the project dev server and wait until it answers. Requires user ' +
    'approval. Returns the URL, with the port read from the server output.',
  permission: 'exec',
  schema: z.object({
    command: z.string().optional().describe('Overrides the detected dev command.'),
  }),
  async run(args, ctx) {
    const { startDevServer } = await import('../project/dev-server.js');
    const project = ctx.state.project as { devCommand?: string; defaultPort?: number } | undefined;
    const command = args.command ?? project?.devCommand;

    if (!command) {
      return {
        ok: false,
        content: 'No dev command known. Call detect_framework first, or pass one.',
      };
    }

    try {
      const server = await startDevServer({
        command,
        cwd: ctx.cwd,
        ...(project?.defaultPort ? { expectedPort: project.defaultPort } : {}),
        approve: (cmd) => ctx.approve('run a command', cmd),
        onLog: (line) => ctx.log(line),
      });
      ctx.state.server = server;
      return { ok: true, content: `Dev server ready at ${server.url}`, data: { url: server.url } };
    } catch (err) {
      const e = err as { format?: () => string; message: string };
      return { ok: false, content: e.format ? e.format() : e.message };
    }
  },
});

export const analyzePage = tool({
  name: 'analyze_page',
  description:
    'Open a route in Chromium and return its ranked UI elements plus extracted ' +
    'brand (accent, typeface, radius, scheme, real labels and copy).',
  permission: 'read',
  schema: z.object({
    route: z.string().default('/'),
  }),
  async run(args, ctx) {
    const server = ctx.state.server as { url: string } | undefined;
    if (!server) {
      return { ok: false, content: 'No dev server running. Call start_dev_server first.' };
    }

    const { analyzeRoute } = await import('../browser/analyze.js');
    try {
      const result = await analyzeRoute(server.url, args.route);
      const brands = (ctx.state.brand ?? result.brand) as unknown;
      ctx.state.brand = brands;

      const analyses = (ctx.state.analyses as Record<string, unknown>) ?? {};
      analyses[args.route] = result;
      ctx.state.analyses = analyses;

      const top = result.elements
        .slice(0, 12)
        .map((e) => `  ${e.type} "${(e.text ?? '').slice(0, 48)}" (${e.importance.toFixed(2)})`)
        .join('\n');

      return {
        ok: true,
        content:
          `Route ${args.route}: ${result.elements.length} elements. Top by importance:\n${top}\n` +
          `Brand: accent ${result.brand.accent}, ${result.brand.scheme}, ` +
          `font ${result.brand.fontDisplay ?? 'unknown'}` +
          (result.brand.fontWarnings.length
            ? `\nFont warnings: ${result.brand.fontWarnings.join('; ')}`
            : ''),
        data: result,
      };
    } catch (err) {
      return { ok: false, content: `Analysis failed: ${(err as Error).message}` };
    }
  },
});

/* ------------------------------------------------------------------ *
 * Skills
 * ------------------------------------------------------------------ */

export const readSkillTool = tool({
  name: 'read_skill',
  description:
    'Read one section of a craft skill. Omit `section` to list a skill\'s ' +
    'sections. Never returns a whole file.',
  permission: 'read',
  schema: z.object({
    skill: z.string(),
    section: z.string().optional(),
  }),
  async run(args, ctx) {
    const { readSection } = await import('../skills/library.js');
    const lib = ctx.state.skills as Parameters<typeof readSection>[0] | undefined;
    if (!lib) return { ok: false, content: 'Skill library not loaded.' };

    const result = readSection(lib, args);
    if ('error' in result) return { ok: false, content: result.error };
    return { ok: true, content: `## ${result.title}\n\n${result.body}` };
  },
});

/* ------------------------------------------------------------------ *
 * Storyboard
 * ------------------------------------------------------------------ */

export const validateStoryboardTool = tool({
  name: 'validate_storyboard',
  description:
    'Validate a storyboard against the schema and the craft rules. Returns ' +
    'which rules it breaks and why. Call before rendering.',
  permission: 'read',
  schema: z.object({ storyboard: z.unknown() }),
  async run(args, ctx) {
    const { storyboardSchema } = await import('../storyboard/schema.js');
    const { repairCraft, formatForModel } = await import('../storyboard/craft-rules.js');

    const parsed = storyboardSchema.safeParse(args.storyboard);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 12)
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      return { ok: false, content: `Schema validation failed:\n${issues}` };
    }

    const { storyboard, repaired, remaining } = repairCraft(parsed.data);
    ctx.state.storyboard = storyboard;

    if (!remaining.length) {
      return {
        ok: true,
        content:
          `Valid.${repaired.length ? ` Auto-repaired ${repaired.length} issue(s): ` +
          repaired.map((r) => r.rule).join(', ') + '.' : ''}`,
        data: storyboard,
      };
    }

    return {
      ok: false,
      content:
        (repaired.length
          ? `Auto-repaired: ${repaired.map((r) => r.rule).join(', ')}.\n\n`
          : '') + formatForModel(remaining),
      data: storyboard,
    };
  },
});

export const renderVideoTool = tool({
  name: 'render_video',
  description:
    'Compile the validated storyboard into a film and render it to MP4. Slow — ' +
    'roughly one second per frame. Only call after validate_storyboard passes.',
  permission: 'write',
  schema: z.object({
    output: z.string().default('.urlume/renders/product-video.mp4'),
    quality: z.enum(['draft', 'high', 'master']).default('high'),
  }),
  async run(args, ctx) {
    const sb = ctx.state.storyboard;
    if (!sb) {
      return { ok: false, content: 'No validated storyboard. Call validate_storyboard first.' };
    }

    const { join, resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { compile } = await import('../compiler/index.js');
    const { render } = await import('../renderer/index.js');

    // runtime/ ships beside dist/, so resolve it relative to this module.
    const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const filmDir = join(ctx.cwd, '.urlume', 'film');

    try {
      ctx.log('Compiling film…');
      const built = await compile({
        storyboard: sb as never,
        outDir: filmDir,
        runtimeDir: join(pkgRoot, 'runtime'),
      });

      const output = resolve(ctx.cwd, args.output);
      ctx.log(`Rendering to ${output}…`);
      await render({
        film: join(built.outDir, 'index.html'),
        output,
        quality: args.quality,
        onEvent: (e) => {
          if (e.type === 'frame' && e.frame % 30 === 0) {
            ctx.log(`frame ${e.frame}/${e.total}`);
          }
          if (e.type === 'warn') ctx.log(`warning: ${e.message}`);
        },
      });

      return { ok: true, content: `Rendered to ${output}`, data: { output } };
    } catch (err) {
      const e = err as { format?: () => string; message: string };
      return { ok: false, content: e.format ? e.format() : e.message };
    }
  },
});

/* ------------------------------------------------------------------ *
 * Registry
 * ------------------------------------------------------------------ */

export const TOOLS: readonly Tool[] = [
  detectFramework,
  listFiles,
  readFileTool,
  startDevServerTool,
  analyzePage,
  readSkillTool,
  validateStoryboardTool,
  renderVideoTool,
];

export function toolByName(name: string): Tool | undefined {
  return TOOLS.find((t) => t.name === name);
}

/**
 * Run a tool by name with unvalidated arguments.
 *
 * Everything that can go wrong returns a `ToolResult` the model can read: an
 * unknown tool, bad arguments, a denied permission, or a thrown exception. The
 * loop never sees an exception from here.
 */
export async function callTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext
): Promise<ToolResult> {
  const found = toolByName(name);
  if (!found) {
    return {
      ok: false,
      content: `No tool named "${name}". Available: ${TOOLS.map((t) => t.name).join(', ')}`,
    };
  }

  const parsed = found.schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { ok: false, content: `Invalid arguments for ${name}: ${issues}` };
  }

  if (found.permission === 'exec') {
    const allowed = await ctx.approve(found.name, JSON.stringify(parsed.data));
    if (!allowed) return { ok: false, content: `User declined ${name}.` };
  }

  try {
    return await found.run(parsed.data, ctx);
  } catch (err) {
    const e = err as { format?: () => string; message: string };
    return { ok: false, content: `${name} failed: ${e.format ? e.format() : e.message}` };
  }
}

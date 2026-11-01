/**
 * The interactive interface (§4, §25).
 *
 * Ink rather than a readline loop, because a render is a long job that reports
 * progress: a readline REPL can print lines or read a line, not both, so a frame
 * counter would have to be `\r`-hacked and any prompt would fight it. Ink redraws a
 * region, so progress updates in place while the input stays live.
 *
 * Three rules shape everything here:
 *
 * 1. **`Static` for scrollback.** Ink re-renders its tree on every state change; a
 *    growing log inside the dynamic region would be repainted in full each frame and
 *    the terminal would flicker and eventually crawl. `Static` writes a line once
 *    and never touches it again.
 * 2. **Nothing long-running blocks input.** The pipeline is awaited off the render
 *    path and reports through `onEvent`, so ctrl-c stays responsive while Chromium is
 *    mid-render.
 * 3. **One overlay at a time.** Every prompt — the command menu, the provider list,
 *    the key input — replaces the input line rather than stacking, so there is never
 *    a question about which widget has the keyboard.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';

import { runPipeline, type PipelineEvent } from '../pipeline.js';
import { ASPECTS, type Aspect } from '../storyboard/schema.js';
import {
  listAllModels,
  listCredentials,
  setCredential,
  getCredential,
  createProvider,
  maskKey,
  storePath,
  PROVIDER_IDS,
  PROVIDER_NAMES,
  DEFAULT_MODELS,
  OFFICIAL_BASE_URLS,
  GATEWAYS,
  ProviderError,
  type Model,
} from '../providers/index.js';
import { banner } from './banner.js';
import { Ask, Select, type Choice } from './pickers.js';

/* ------------------------------------------------------------------ *
 * Log
 * ------------------------------------------------------------------ */

type Tone = 'info' | 'ok' | 'warn' | 'err' | 'dim' | 'you' | 'brand' | 'accent';

interface Line {
  id: number;
  tone: Tone;
  text: string;
}

const COLOUR: Record<Tone, string | undefined> = {
  info: undefined,
  ok: 'green',
  warn: 'yellow',
  err: 'red',
  dim: 'gray',
  you: 'cyan',
  brand: 'magenta',
  accent: 'cyan',
};

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

interface CommandSpec {
  name: string;
  args?: string;
  description: string;
}

/** The single source for the `/` menu, `/help`, and dispatch. */
const COMMANDS: CommandSpec[] = [
  { name: 'api', description: 'connect a provider — key, endpoint, model' },
  { name: 'model', description: 'choose a model from the connected provider' },
  { name: 'keys', description: 'show connected providers' },
  { name: 'url', args: '<url>', description: 'set the site to film' },
  { name: 'seconds', args: '<n>', description: 'target length' },
  { name: 'aspect', description: 'frame shape — 16:9, 9:16, 1:1, 4:5' },
  { name: 'quality', description: 'draft, high or master' },
  { name: 'save', args: '[path]', description: 'copy the last render' },
  { name: 'open', description: 'watch the last render' },
  { name: 'status', description: 'current settings' },
  { name: 'doctor', description: 'check Chromium, ffmpeg and keys' },
  { name: 'clear', description: 'clear the screen' },
  { name: 'help', description: 'list commands' },
  { name: 'exit', description: 'quit' },
];

/* ------------------------------------------------------------------ *
 * Overlays
 * ------------------------------------------------------------------ */

/**
 * Which prompt owns the keyboard.
 *
 * A discriminated union rather than a pile of booleans: the setup flow moves
 * provider -> key -> endpoint -> model, and each step needs the answers from the
 * previous ones. Carrying those in the state itself makes an impossible combination
 * unrepresentable instead of merely unlikely.
 */
type Overlay =
  | { kind: 'none' }
  | { kind: 'commands' }
  | { kind: 'api-provider' }
  | { kind: 'api-key'; provider: string }
  | { kind: 'api-endpoint'; provider: string; key: string }
  | { kind: 'api-base-url'; provider: string; key: string }
  | {
      kind: 'api-model';
      provider: string;
      key: string;
      baseUrl?: string;
      headers?: Record<string, string>;
      models: Model[];
    }
  | { kind: 'model'; models: Model[] }
  | { kind: 'aspect' }
  | { kind: 'quality' };

interface Settings {
  url: string | null;
  seconds: number;
  aspect: Aspect;
  quality: 'draft' | 'high' | 'master';
  provider: string | null;
  model: string | null;
  lastOutput: string | null;
}

const URL_RE = /\bhttps?:\/\/[^\s]+/i;

export function App({ version }: { version: string }): JSX.Element {
  const { exit } = useApp();

  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' });
  const [settings, setSettings] = useState<Settings>({
    url: null,
    seconds: 24,
    aspect: '16:9',
    quality: 'high',
    provider: null,
    model: null,
    lastOutput: null,
  });

  const nextId = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const quitArmed = useRef(false);

  const say = useCallback((text: string, tone: Tone = 'info') => {
    setLines((prev) => [...prev, { id: nextId.current++, tone, text }]);
  }, []);

  const close = useCallback(() => setOverlay({ kind: 'none' }), []);

  /* ---------------- startup ---------------- */

  useEffect(() => {
    void (async () => {
      for (const line of banner()) say(line.text, line.tone);
      say('');

      const configured = await listCredentials();
      if (!configured.length) {
        say('No provider connected yet — type /api to set one up.', 'warn');
      } else {
        const first = configured[0]!;
        const credential = await getCredential(first.provider);
        setSettings((s) => ({
          ...s,
          provider: first.provider,
          model: credential?.defaultModel ?? DEFAULT_MODELS[first.provider] ?? null,
        }));
        say(
          `Connected: ${PROVIDER_NAMES[first.provider as keyof typeof PROVIDER_NAMES] ?? first.provider}` +
            ` · ${credential?.defaultModel ?? DEFAULT_MODELS[first.provider] ?? 'default model'}`,
          'ok'
        );
      }

      say('');
      say('Paste a website URL to make a film, or press / for commands.', 'dim');
      say('');
    })();
  }, [say]);

  /* ---------------- pipeline ---------------- */

  const reporter = useCallback(
    (e: PipelineEvent): void => {
      switch (e.type) {
        case 'stage':
          setProgress(e.detail ? `${e.name}: ${e.detail}` : e.name);
          if (!e.detail) say(`▸ ${e.name}`, 'dim');
          break;
        case 'provider':
          say(`  ${e.provider} / ${e.model}`, 'dim');
          break;
        case 'routes':
          say(`  ${e.routes.length} route(s): ${e.routes.slice(0, 5).join(', ')}`, 'dim');
          break;
        case 'analysed':
          say(`  ${e.route} — ${e.elements} elements ranked`, 'dim');
          break;
        case 'generate': {
          const g = e.event;
          if (g.type === 'attempt' && g.n > 1) say(`  attempt ${g.n} of ${g.of}`, 'warn');
          if (g.type === 'repaired') say(`  repaired ${g.violations.length} craft violation(s)`, 'dim');
          if (g.type === 'reask') {
            say(`  asking the model to fix ${g.violations.length} issue(s)`, 'warn');
            for (const v of g.violations) say(`    ${v.rule}`, 'dim');
          }
          break;
        }
        case 'storyboard': {
          const sb = e.storyboard;
          say('');
          say(`  ${sb.product} — ${sb.scenes.length} scenes, ${(sb.duration / 1000).toFixed(0)}s`, 'ok');
          for (const scene of sb.scenes) {
            say(
              `    ${scene.beat.padEnd(7)} ${scene.type.padEnd(10)} ${(scene.copy?.headline ?? scene.id).slice(0, 44)}`,
              'dim'
            );
          }
          say('');
          break;
        }
        case 'render': {
          const r = e.event;
          if (r.type === 'ready') say(`  ${r.film.width}×${r.film.height}, ${r.film.frames} frames`, 'dim');
          if (r.type === 'frame') {
            setProgress(`rendering ${Math.round((r.frame / r.total) * 100)}%  ${r.frame}/${r.total}`);
          }
          if (r.type === 'encode') setProgress('encoding with ffmpeg');
          if (r.type === 'warn') say(`  ${r.message}`, 'warn');
          break;
        }
        case 'done':
          setSettings((s) => ({ ...s, lastOutput: e.output }));
          break;
      }
    },
    [say]
  );

  const make = useCallback(
    async (url: string, prompt: string): Promise<void> => {
      const controller = new AbortController();
      abort.current = controller;
      setBusy('making your film');
      setProgress('starting');

      try {
        const result = await runPipeline({
          url,
          prompt: prompt || undefined,
          durationMs: settings.seconds * 1000,
          aspect: settings.aspect,
          quality: settings.quality,
          ...(settings.provider ? { provider: settings.provider } : {}),
          ...(settings.model ? { model: settings.model } : {}),
          signal: controller.signal,
          onEvent: reporter,
        });
        if (result.output) {
          say('');
          say(`Done — ${result.output}`, 'ok');
          say('  /open to watch it · /save <path> to copy it', 'dim');
        }
      } catch (err) {
        say('');
        if (err instanceof ProviderError) say(err.format(), 'err');
        else {
          const message = err instanceof Error ? err.message : String(err);
          const cancelled = controller.signal.aborted;
          say(cancelled ? 'Cancelled.' : message, cancelled ? 'warn' : 'err');
        }
      } finally {
        abort.current = null;
        setBusy(null);
        setProgress('');
      }
    },
    [reporter, say, settings]
  );

  /* ---------------- the /api flow ---------------- */

  /**
   * Finish setup: store the credential, then read the catalogue back.
   *
   * Listing models with the key that was just saved doubles as the connection test —
   * a 401 surfaces here, while the user is still in the setup they can correct,
   * rather than two minutes into their first render.
   */
  const connect = useCallback(
    async (
      provider: string,
      key: string,
      baseUrl: string | undefined,
      headers: Record<string, string> | undefined,
      presetModel: string | undefined
    ): Promise<void> => {
      setOverlay({ kind: 'none' });
      setBusy('connecting');

      try {
        await setCredential({
          provider,
          key,
          ...(baseUrl !== undefined ? { baseUrl } : {}),
          ...(headers !== undefined ? { headers } : {}),
          ...(presetModel !== undefined ? { defaultModel: presetModel } : {}),
        });

        const client = createProvider(provider, key, {
          ...(baseUrl !== undefined ? { baseUrl } : {}),
          ...(headers !== undefined ? { headers } : {}),
        });

        let models: Model[] = [];
        try {
          models = await client.listModels();
        } catch (err) {
          say(
            `Stored the key, but could not list models: ${err instanceof Error ? err.message : String(err)}`,
            'warn'
          );
        }

        say(`Connected ${PROVIDER_NAMES[provider as keyof typeof PROVIDER_NAMES] ?? provider} (${maskKey(key)}).`, 'ok');
        if (baseUrl) say(`  endpoint ${baseUrl}`, 'dim');
        say(`  ${storePath()} — readable by anyone who can read your profile.`, 'dim');

        const fallback = presetModel ?? DEFAULT_MODELS[provider] ?? models[0]?.id ?? null;
        setSettings((s) => ({ ...s, provider, model: fallback }));

        if (models.length > 1) {
          setBusy(null);
          setOverlay({
            kind: 'api-model',
            provider,
            key,
            ...(baseUrl !== undefined ? { baseUrl } : {}),
            ...(headers !== undefined ? { headers } : {}),
            models,
          });
          return;
        }

        if (fallback) say(`  model ${fallback}`, 'dim');
        say('');
        say('Ready. Paste a website URL to make a film.', 'ok');
      } catch (err) {
        say(err instanceof ProviderError ? err.format() : String(err), 'err');
      } finally {
        setBusy(null);
      }
    },
    [say]
  );

  /* ---------------- commands ---------------- */

  const openModelPicker = useCallback(async (): Promise<void> => {
    if (!settings.provider) {
      say('No provider connected. Type /api first.', 'warn');
      return;
    }
    setBusy('reading the model catalogue');
    try {
      const credential = await getCredential(settings.provider);
      if (!credential) {
        say(`No key stored for ${settings.provider}. Type /api.`, 'warn');
        return;
      }
      const client = createProvider(settings.provider, credential.key, {
        ...(credential.baseUrl !== undefined ? { baseUrl: credential.baseUrl } : {}),
        ...(credential.headers !== undefined ? { headers: credential.headers } : {}),
      });
      const models = await client.listModels();
      if (!models.length) {
        say('That endpoint returned no models. Set one by name: /model <id>', 'warn');
        return;
      }
      setOverlay({ kind: 'model', models });
    } catch (err) {
      say(err instanceof ProviderError ? err.format() : String(err), 'err');
    } finally {
      setBusy(null);
    }
  }, [say, settings.provider]);

  const run = useCallback(
    async (raw: string): Promise<void> => {
      const trimmed = raw.trim();
      if (!trimmed) return;

      say(`❯ ${trimmed}`, 'you');

      if (!trimmed.startsWith('/')) {
        const found = URL_RE.exec(trimmed);
        const url = found?.[0] ?? settings.url;
        if (!url) {
          say('I need a URL. Paste one, or set it with /url', 'warn');
          return;
        }
        const prompt = found ? trimmed.replace(found[0], '').trim() : trimmed;
        setSettings((s) => ({ ...s, url }));
        await make(url, prompt);
        return;
      }

      const [command, ...rest] = trimmed.slice(1).split(/\s+/);
      const arg = rest.join(' ');

      switch ((command ?? '').toLowerCase()) {
        case '':
          setOverlay({ kind: 'commands' });
          break;

        case 'help':
        case '?':
          for (const c of COMMANDS) {
            say(`  /${(c.name + (c.args ? ` ${c.args}` : '')).padEnd(18)} ${c.description}`, 'dim');
          }
          say('  paste a URL          make a film', 'dim');
          break;

        case 'api':
        case 'provider':
        case 'key':
          setOverlay({ kind: 'api-provider' });
          break;

        case 'model':
          if (arg) {
            setSettings((s) => ({ ...s, model: arg }));
            say(`Model set to ${arg}.`, 'ok');
            break;
          }
          await openModelPicker();
          break;

        case 'models':
          await openModelPicker();
          break;

        case 'keys': {
          const configured = await listCredentials();
          if (!configured.length) {
            say('Nothing connected. Type /api.', 'warn');
            break;
          }
          for (const c of configured) {
            const credential = await getCredential(c.provider);
            say(
              `  ${c.provider.padEnd(10)} ${maskKey(credential?.key ?? '')}  ` +
                `${credential?.defaultModel ?? DEFAULT_MODELS[c.provider] ?? ''}` +
                `${credential?.baseUrl ? `  ${credential.baseUrl}` : ''}`,
              'dim'
            );
          }
          break;
        }

        case 'url':
          if (!URL_RE.test(arg)) {
            say('Usage: /url https://example.com', 'warn');
            break;
          }
          setSettings((s) => ({ ...s, url: arg }));
          say(`Target set to ${arg}.`, 'ok');
          break;

        case 'seconds':
        case 'length': {
          const n = Number(arg);
          if (!Number.isFinite(n) || n < 5 || n > 120) {
            say('Usage: /seconds <5-120>', 'warn');
            break;
          }
          setSettings((s) => ({ ...s, seconds: Math.round(n) }));
          say(`Length set to ${Math.round(n)}s.`, 'ok');
          break;
        }

        case 'aspect':
          if (ASPECTS.includes(arg as Aspect)) {
            setSettings((s) => ({ ...s, aspect: arg as Aspect }));
            say(`Aspect set to ${arg}.`, 'ok');
          } else {
            setOverlay({ kind: 'aspect' });
          }
          break;

        case 'quality':
          if (['draft', 'high', 'master'].includes(arg)) {
            setSettings((s) => ({ ...s, quality: arg as Settings['quality'] }));
            say(`Quality set to ${arg}.`, 'ok');
          } else {
            setOverlay({ kind: 'quality' });
          }
          break;

        case 'draft':
          setSettings((s) => ({ ...s, quality: 'draft' }));
          say('Quality set to draft.', 'ok');
          break;

        case 'status':
          say(`  provider  ${settings.provider ?? '(none)'}`, 'dim');
          say(`  model     ${settings.model ?? '(default)'}`, 'dim');
          say(`  url       ${settings.url ?? '(not set)'}`, 'dim');
          say(`  length    ${settings.seconds}s`, 'dim');
          say(`  aspect    ${settings.aspect}`, 'dim');
          say(`  quality   ${settings.quality}`, 'dim');
          say(`  last film ${settings.lastOutput ?? '(none yet)'}`, 'dim');
          break;

        case 'save': {
          if (!settings.lastOutput) {
            say('Nothing rendered yet.', 'warn');
            break;
          }
          const { copyFile, mkdir } = await import('node:fs/promises');
          const { basename, dirname, resolve } = await import('node:path');
          const target = resolve(arg || basename(settings.lastOutput));
          await mkdir(dirname(target), { recursive: true });
          await copyFile(settings.lastOutput, target);
          say(`Saved to ${target}`, 'ok');
          break;
        }

        case 'open': {
          if (!settings.lastOutput) {
            say('Nothing rendered yet.', 'warn');
            break;
          }
          const { spawn } = await import('node:child_process');
          const opener =
            process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
          spawn(opener, [settings.lastOutput], {
            detached: true,
            stdio: 'ignore',
            shell: process.platform === 'win32',
          }).unref();
          say(`Opening ${settings.lastOutput}`, 'dim');
          break;
        }

        case 'cancel':
          if (abort.current) {
            abort.current.abort();
            say('Cancelling…', 'warn');
          } else say('Nothing running.', 'dim');
          break;

        case 'doctor':
          setBusy('checking');
          try {
            for (const line of await doctor()) say(line.text, line.tone);
          } finally {
            setBusy(null);
          }
          break;

        case 'clear':
          setLines([]);
          break;

        case 'exit':
        case 'quit':
        case 'q':
          exit();
          break;

        default:
          say(`Unknown command /${command}. Press / to see the list.`, 'err');
      }
    },
    [exit, make, openModelPicker, say, settings]
  );

  /* ---------------- keys ---------------- */

  useInput(
    (char, key) => {
      if (!key.ctrl) return;
      if (char === 'c') {
        if (abort.current) {
          abort.current.abort();
          say('Cancelling…', 'warn');
          return;
        }
        if (quitArmed.current) {
          exit();
          return;
        }
        quitArmed.current = true;
        say('Press ctrl-c again to quit.', 'dim');
        setTimeout(() => {
          quitArmed.current = false;
        }, 2000);
      }
    },
    // Overlays own the keyboard while open, and a busy render has no input line.
    { isActive: overlay.kind === 'none' && busy === null }
  );

  const spinner = useSpinner(busy !== null);
  const shown = useMemo(() => lines, [lines]);

  /* ---------------- overlays ---------------- */

  function renderOverlay(): JSX.Element | null {
    switch (overlay.kind) {
      case 'none':
        return null;

      case 'commands':
        return (
          <Select
            title="Commands"
            filterable
            height={10}
            choices={COMMANDS.map((c) => ({
              value: c.name,
              label: `/${c.name}${c.args ? ` ${c.args}` : ''}`,
              hint: c.description,
            }))}
            onSelect={(value) => {
              close();
              const spec = COMMANDS.find((c) => c.name === value);
              // A command that needs a value is written into the input rather than
              // run, so the user types the argument instead of hitting an error.
              if (spec?.args) {
                setInput(`/${value} `);
                return;
              }
              void run(`/${value}`);
            }}
            onCancel={close}
          />
        );

      case 'api-provider':
        return (
          <Select
            title="Which provider would you like to use?"
            height={7}
            choices={[
              { value: 'anthropic', label: 'Claude (Anthropic)', hint: 'claude-opus-5, sonnet' },
              { value: 'openai', label: 'OpenAI', hint: 'gpt-5, o4-mini' },
              { value: 'gemini', label: 'Google Gemini', hint: 'gemini-2.5-pro' },
              { value: 'mistral', label: 'Mistral', hint: 'mistral-large' },
              { value: 'custom', label: 'Other / gateway', hint: 'AgentRouter, OpenRouter, Ollama…' },
            ]}
            onSelect={(provider) => setOverlay({ kind: 'api-key', provider })}
            onCancel={close}
          />
        );

      case 'api-key': {
        const label = PROVIDER_NAMES[overlay.provider as keyof typeof PROVIDER_NAMES] ?? overlay.provider;
        return (
          <Ask
            title={`Paste your ${label} API key`}
            placeholder="sk-…"
            mask
            onSubmit={(key) => setOverlay({ kind: 'api-endpoint', provider: overlay.provider, key })}
            onCancel={close}
            footer="  the key is masked here and stored at 0600 · esc cancel"
          />
        );
      }

      case 'api-endpoint': {
        const official = OFFICIAL_BASE_URLS[overlay.provider];
        const choices: Choice[] = [];
        if (official) {
          choices.push({
            value: '__official__',
            label: `${PROVIDER_NAMES[overlay.provider as keyof typeof PROVIDER_NAMES] ?? overlay.provider} (default)`,
            hint: official,
          });
        }
        for (const gateway of GATEWAYS) {
          choices.push({
            value: gateway.id,
            label: gateway.name,
            hint: gateway.note ?? gateway.baseUrl,
          });
        }
        choices.push({ value: '__custom__', label: 'Custom URL…', hint: 'paste your own endpoint' });

        return (
          <Select
            title="Which endpoint should it call?"
            height={8}
            choices={choices}
            onSelect={(value) => {
              if (value === '__official__') {
                // The official API of a first-party provider needs no baseUrl: the
                // adapter already knows it, and storing one would pin a URL that
                // could change under us.
                void connect(overlay.provider, overlay.key, undefined, undefined, undefined);
                return;
              }
              if (value === '__custom__') {
                setOverlay({ kind: 'api-base-url', provider: overlay.provider, key: overlay.key });
                return;
              }
              const gateway = GATEWAYS.find((g) => g.id === value);
              if (!gateway) return;
              // A gateway speaks the OpenAI wire format whichever vendor's models it
              // resells, so it is stored under the id whose adapter can talk to it.
              const id = overlay.provider === 'openai' ? 'openai' : 'custom';
              void connect(id, overlay.key, gateway.baseUrl, gateway.headers, gateway.model);
            }}
            onCancel={close}
          />
        );
      }

      case 'api-base-url':
        return (
          <Ask
            title="Base URL of the endpoint"
            placeholder="https://host/v1"
            onSubmit={(baseUrl) => {
              const id = overlay.provider === 'openai' ? 'openai' : 'custom';
              void connect(id, overlay.key, baseUrl.replace(/\/+$/, ''), undefined, undefined);
            }}
            onCancel={close}
            footer="  must speak the OpenAI /chat/completions API · esc cancel"
          />
        );

      case 'api-model':
      case 'model': {
        const models = overlay.models;
        return (
          <Select
            title="Choose a model"
            filterable={models.length > 8}
            height={10}
            choices={models.map((m) => ({
              value: m.id,
              label: m.id,
              hint: [
                m.vision ? 'vision' : '',
                m.contextWindow ? `${Math.round(m.contextWindow / 1000)}k` : '',
              ]
                .filter(Boolean)
                .join(' · '),
              keywords: m.name,
            }))}
            onSelect={(id) => {
              close();
              setSettings((s) => ({ ...s, model: id }));
              say(`Model set to ${id}.`, 'ok');
              // Remembered, so the next session starts where this one left off.
              void (async () => {
                const provider = overlay.kind === 'api-model' ? overlay.provider : settings.provider;
                if (!provider) return;
                const existing = await getCredential(provider);
                if (!existing) return;
                await setCredential({ ...existing, provider, defaultModel: id });
              })();
              if (overlay.kind === 'api-model') {
                say('');
                say('Ready. Paste a website URL to make a film.', 'ok');
              }
            }}
            onCancel={() => {
              close();
              if (overlay.kind === 'api-model') say('Keeping the default model.', 'dim');
            }}
          />
        );
      }

      case 'aspect':
        return (
          <Select
            title="Frame shape"
            height={5}
            choices={[
              { value: '16:9', label: '16:9', hint: 'landscape — site, YouTube' },
              { value: '9:16', label: '9:16', hint: 'vertical — Reels, TikTok, Shorts' },
              { value: '1:1', label: '1:1', hint: 'square — feed' },
              { value: '4:5', label: '4:5', hint: 'portrait — feed' },
            ]}
            onSelect={(value) => {
              close();
              setSettings((s) => ({ ...s, aspect: value as Aspect }));
              say(`Aspect set to ${value}.`, 'ok');
            }}
            onCancel={close}
          />
        );

      case 'quality':
        return (
          <Select
            title="Render quality"
            height={4}
            choices={[
              { value: 'draft', label: 'draft', hint: 'fast, softer — for iterating' },
              { value: 'high', label: 'high', hint: 'the default' },
              { value: 'master', label: 'master', hint: 'slowest, archival' },
            ]}
            onSelect={(value) => {
              close();
              setSettings((s) => ({ ...s, quality: value as Settings['quality'] }));
              say(`Quality set to ${value}.`, 'ok');
            }}
            onCancel={close}
          />
        );
    }
  }

  const active = renderOverlay();

  return (
    <Box flexDirection="column">
      <Static items={shown}>
        {(line) => {
          const colour = COLOUR[line.tone];
          return (
            <Text key={line.id} {...(colour ? { color: colour } : {})}>
              {line.text}
            </Text>
          );
        }}
      </Static>

      {busy ? (
        <Box>
          <Text color="cyan">{spinner} </Text>
          <Text>{busy}</Text>
          {progress ? <Text color="gray">{`  ${progress}`}</Text> : null}
        </Box>
      ) : active ? (
        active
      ) : (
        <Box>
          <Text color="cyan">❯ </Text>
          <TextInput
            value={input}
            onChange={(value) => {
              // A lone `/` opens the menu, which is what makes the commands
              // discoverable without reading any docs. Handled here rather than in a
              // sibling `useInput`: TextInput has its own handler on the same
              // keypress, so an intercept outside it fires *and* leaves the slash in
              // the buffer.
              if (value === '/') {
                setOverlay({ kind: 'commands' });
                return;
              }
              setInput(value);
            }}
            onSubmit={(value) => {
              setInput('');
              void run(value);
            }}
            placeholder="paste a URL, or / for commands"
          />
        </Box>
      )}
    </Box>
  );
}

function useSpinner(active: boolean): string {
  const frames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setI((n) => (n + 1) % frames.length), 80);
    return () => clearInterval(timer);
  }, [active, frames.length]);
  return frames[i] ?? '⠋';
}

/* ------------------------------------------------------------------ *
 * doctor
 * ------------------------------------------------------------------ */

/**
 * Preflight.
 *
 * A global install brings no browser: `playwright-core` deliberately ships without
 * one, so the first render fails deep inside Chromium launch with a message about an
 * executable path. Checking here turns that into one actionable line.
 *
 * The install command names `playwright-core` rather than `playwright`, and that
 * matters: each Playwright version expects one specific Chromium revision, so
 * `npx playwright install` fetches whatever the *latest* release wants and leaves
 * this one still looking for a revision that was never downloaded.
 */
export async function doctor(): Promise<{ text: string; tone: Tone }[]> {
  const out: { text: string; tone: Tone }[] = [];
  const installHint = '             npx playwright-core install chromium';

  out.push({ text: `  node       ${process.version}`, tone: 'dim' });

  try {
    const { chromium } = await import('playwright-core');
    const path = chromium.executablePath();
    const { existsSync } = await import('node:fs');
    if (path && existsSync(path)) {
      out.push({ text: '  chromium   found', tone: 'ok' });
    } else {
      out.push({ text: '  chromium   MISSING', tone: 'err' });
      out.push({ text: installHint, tone: 'dim' });
      if (path) out.push({ text: `             expected: ${path}`, tone: 'dim' });
    }
  } catch {
    out.push({ text: '  chromium   MISSING', tone: 'err' });
    out.push({ text: installHint, tone: 'dim' });
  }

  try {
    const mod = (await import('ffmpeg-static')) as unknown as { default: string | null };
    const { existsSync } = await import('node:fs');
    out.push(
      mod.default && existsSync(mod.default)
        ? { text: '  ffmpeg     bundled', tone: 'ok' }
        : { text: '  ffmpeg     MISSING — npm rebuild ffmpeg-static', tone: 'err' }
    );
  } catch {
    out.push({ text: '  ffmpeg     MISSING — npm rebuild ffmpeg-static', tone: 'err' });
  }

  const configured = await listCredentials();
  out.push(
    configured.length
      ? { text: `  provider   ${configured.map((c) => c.provider).join(', ')}`, tone: 'ok' }
      : { text: '  provider   none — type /api', tone: 'err' }
  );

  return out;
}

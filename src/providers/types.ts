/**
 * The AI provider interface.
 *
 * Nothing outside `src/providers/` imports a vendor SDK. Every other subsystem
 * — the agent loop, storyboard generation, conversational editing — depends on
 * this file and nothing else, so swapping OpenAI for a local model is an
 * adapter, not a refactor.
 *
 * The interface is deliberately small. Providers differ enormously in their
 * streaming, tool-calling and multimodal APIs, and modelling that surface here
 * would leak every vendor's design into the rest of the codebase. urlume needs
 * two things from a model: structured JSON, and a stream of text.
 */

export interface Model {
  id: string;
  name: string;
  /** Provider that owns it, e.g. `anthropic`. */
  provider: string;
  contextWindow?: number;
  /** Can accept images — required for the vision-based re-ranking pass. */
  vision?: boolean;
  /** Supports a JSON/structured-output mode, which raises the odds a storyboard
   *  parses first time. Validation still runs regardless. */
  structuredOutput?: boolean;
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** base64 PNG/JPEG, for vision-capable models. */
  images?: string[];
}

export interface GenerateRequest {
  model: string;
  messages: Message[];
  maxTokens?: number;
  /** Storyboard work uses a low temperature; it is a structured document, not
   *  a creative writing exercise. The *film* is creative; the JSON is not. */
  temperature?: number;
  /** Ask for JSON. Providers honour this differently, and none guarantee a
   *  schema match, so the caller always validates. */
  json?: boolean;
  signal?: AbortSignal;
  onToken?: (chunk: string) => void;
}

export interface GenerateResponse {
  text: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
  /** Why generation ended. `length` usually means a truncated, unparseable
   *  JSON document — worth distinguishing from a refusal. */
  stopReason?: 'stop' | 'length' | 'refusal' | 'error';
}

export interface AIProvider {
  readonly id: string;
  readonly name: string;
  /** Env vars checked for a key, in order. */
  readonly envVars: readonly string[];
  listModels(): Promise<Model[]>;
  generate(request: GenerateRequest): Promise<GenerateResponse>;
}

/**
 * A provider failure a user can act on.
 *
 * Every field here exists because it appears in the error message: which
 * provider, which model, what the HTTP status was, what it probably means, and
 * what to do. `401` on its own does not tell someone their key is stale.
 */
export class ProviderError extends Error {
  readonly provider: string;
  readonly model: string | undefined;
  readonly status: number | undefined;
  readonly hints: readonly string[];

  constructor(opts: {
    provider: string;
    model?: string;
    status?: number;
    message: string;
    hints?: readonly string[];
  }) {
    super(opts.message);
    this.name = 'ProviderError';
    this.provider = opts.provider;
    this.model = opts.model;
    this.status = opts.status;
    this.hints = opts.hints ?? [];
  }

  format(): string {
    const lines = [
      `${this.provider}${this.model ? ` (${this.model})` : ''}: ${this.message}`,
    ];
    if (this.status) lines.push(`HTTP ${this.status}`);
    if (this.hints.length) {
      lines.push('');
      lines.push(...this.hints);
    }
    return lines.join('\n');
  }
}

/** Map an HTTP status to something actionable. The hint is the part that
 *  matters; the status alone sends people to a search engine. */
export function explainStatus(
  status: number,
  provider: string
): { message: string; hints: string[] } {
  switch (status) {
    case 401:
    case 403:
      return {
        message: 'Authentication failed.',
        hints: [
          `The API key for ${provider} was rejected.`,
          `Check it with: urlume doctor`,
          `Replace it with: urlume config --provider ${provider}`,
        ],
      };
    case 404:
      return {
        message: 'Model not found.',
        hints: [
          'The model id may be misspelled, or unavailable to this account.',
          'List what this key can reach: urlume models',
        ],
      };
    case 429:
      return {
        message: 'Rate limited.',
        hints: [
          'Too many requests, or the account is out of quota.',
          'urlume retries with backoff; a persistent 429 usually means quota.',
        ],
      };
    case 400:
      return {
        message: 'The request was rejected as malformed.',
        hints: [
          'Usually the context is too long for this model.',
          'A smaller analysis (fewer routes) or a larger-context model will fix it.',
        ],
      };
    default:
      if (status >= 500) {
        return {
          message: 'The provider had a server error.',
          hints: ['This is on their side. urlume retries automatically.'],
        };
      }
      return { message: `Unexpected HTTP ${status}.`, hints: [] };
  }
}

/**
 * Retry with exponential backoff and jitter.
 *
 * Only transient failures are retried. A 401 will never succeed on a second
 * attempt, and retrying it just delays a clear error by several seconds.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number; signal?: AbortSignal } = {}
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = err instanceof ProviderError ? err.status : undefined;
      const transient = status === 429 || (status !== undefined && status >= 500);
      if (!transient || i === attempts - 1) throw err;

      // Jitter stops parallel scene generations from retrying in lockstep.
      const wait = (opts.baseMs ?? 1000) * 2 ** i + Math.random() * 400;
      await new Promise((r) => setTimeout(r, wait));
      if (opts.signal?.aborted) throw err;
    }
  }
  throw lastError;
}

/**
 * Pull a JSON object out of a model response.
 *
 * Models wrap JSON in prose and fences no matter how firmly they are asked not
 * to, so extraction is required even with a JSON mode enabled. Brace matching
 * rather than a regex, because a regex cannot handle nesting — and string-aware,
 * because a `}` inside a copy string would otherwise end the object early.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to extraction.
  }

  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/.exec(trimmed);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // Fenced but still malformed; try brace matching below.
    }
  }

  const start = trimmed.indexOf('{');
  if (start === -1) {
    throw new ProviderError({
      provider: 'parse',
      message: 'The model returned no JSON object.',
      hints: [
        'First 200 characters of the response:',
        `  ${trimmed.slice(0, 200)}`,
      ],
    });
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = trimmed.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch (err) {
          throw new ProviderError({
            provider: 'parse',
            message: `Found a JSON object but could not parse it: ${(err as Error).message}`,
            hints: [`  ${candidate.slice(0, 200)}`],
          });
        }
      }
    }
  }

  throw new ProviderError({
    provider: 'parse',
    message: 'The JSON object was never closed — the response was probably truncated.',
    hints: [
      'Raise maxTokens, or ask for a shorter storyboard (fewer scenes).',
    ],
  });
}

/**
 * The provider registry — the only place that knows which adapters exist.
 *
 * Everything above this depends on `AIProvider`, so adding a provider means adding
 * a factory here and nothing else. This is also the boundary §6 draws: no vendor
 * SDK, and no vendor-shaped assumption, escapes `src/providers/`.
 */

import { getCredential, listCredentials, knownSecrets } from './credentials.js';
import { createAnthropicProvider } from './anthropic.js';
import { createGeminiProvider } from './gemini.js';
import {
  createMistralProvider,
  createOpenAIProvider,
  createOpenAICompatibleProvider,
} from './openai.js';
import { ProviderError, type AIProvider, type Model } from './types.js';
import { registerSecretSource } from '../renderer/errors.js';

export * from './types.js';
export {
  getCredential,
  listCredentials,
  setCredential,
  removeCredential,
  maskKey,
  storePath,
  storageNotice,
  STORAGE_NOTICE,
  rememberSecret,
  knownSecrets,
} from './credentials.js';

/**
 * Wire the credential store into `redact` as soon as any provider code loads.
 *
 * `redact` is called from the CLI's top-level catch and from the TUI, neither of
 * which knows which keys are in play. Registering the getter (not the values)
 * means a key loaded later is still redacted.
 */
registerSecretSource(knownSecrets);

/** Providers with a built-in adapter, in the order they are offered. */
export const PROVIDER_IDS = ['anthropic', 'openai', 'gemini', 'mistral', 'custom'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  mistral: 'Mistral',
  custom: 'OpenAI-compatible endpoint',
};

/** Where each provider's own API lives, for the setup flow to offer as the default. */
export const OFFICIAL_BASE_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  mistral: 'https://api.mistral.ai/v1',
};

/**
 * Gateways that re-expose several vendors' models behind one key.
 *
 * Offered by name during setup because the alternative is a user pasting a URL they
 * half-remember. AgentRouter carries the extra `user-agent` requirement: it
 * authenticates the *client* as well as the key, and rejects an unrecognised agent
 * with a 401 that reads exactly like a stale credential — so the header ships with
 * the preset rather than being something the user has to discover.
 */
export interface GatewayPreset {
  id: string;
  name: string;
  baseUrl: string;
  /** Sensible default model id, since a gateway's catalogue is its own. */
  model?: string;
  headers?: Record<string, string>;
  note?: string;
}

export const GATEWAYS: readonly GatewayPreset[] = [
  {
    id: 'agentrouter',
    name: 'AgentRouter',
    baseUrl: 'https://agentrouter.org/v1',
    model: 'claude-opus-5',
    headers: { 'user-agent': 'claude-cli/1.0.0 (external, cli)' },
    note: 'one key, many models',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4.5',
    note: 'one key, many models',
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    note: 'fast open models',
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    note: 'no key needed',
  },
];

/**
 * A sensible default model per provider.
 *
 * Storyboard generation is the hard call in this pipeline — it holds the skill
 * policy, the page analysis and the whole schema in one context and has to emit a
 * document that validates. So the default is the strongest model rather than the
 * cheapest; a failed generation costs a retry and the user's patience.
 */
export const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-opus-4-6',
  openai: 'gpt-5',
  gemini: 'gemini-2.5-pro',
  mistral: 'mistral-large-latest',
};

export function createProvider(
  id: string,
  apiKey: string,
  opts: { baseUrl?: string; headers?: Record<string, string> } = {}
): AIProvider {
  const extra = opts.headers !== undefined ? { headers: opts.headers } : {};

  switch (id) {
    case 'anthropic':
      return createAnthropicProvider(apiKey);
    case 'openai':
      // A baseUrl against the `openai` id points the OpenAI shape at a proxy or a
      // gateway, which is a legitimate and common setup.
      return opts.baseUrl
        ? createOpenAICompatibleProvider({
            id: 'openai',
            name: 'OpenAI-compatible',
            apiKey,
            baseUrl: opts.baseUrl,
            ...extra,
          })
        : createOpenAIProvider(apiKey);
    case 'gemini':
      return createGeminiProvider(apiKey);
    case 'mistral':
      return createMistralProvider(apiKey);
    case 'custom': {
      if (!opts.baseUrl) {
        throw new ProviderError({
          provider: 'custom',
          message: 'A custom provider needs a base URL.',
          hints: [
            'Set one with: urlume config --provider custom --base-url <url>',
            'It must speak the OpenAI /chat/completions API.',
          ],
        });
      }
      return createOpenAICompatibleProvider({
        id: 'custom',
        name: 'OpenAI-compatible',
        apiKey,
        baseUrl: opts.baseUrl,
        ...extra,
      });
    }
    default:
      throw new ProviderError({
        provider: id,
        message: `Unknown provider "${id}".`,
        hints: [`Known providers: ${PROVIDER_IDS.join(', ')}`],
      });
  }
}

export interface ResolvedProvider {
  provider: AIProvider;
  model: string;
  /** Where the key came from, for the "using X via Y" line. */
  origin: 'env' | 'file';
}

/**
 * Find a usable provider.
 *
 * Resolution order, in decreasing specificity: an explicitly named provider, then
 * the configured preference, then whichever credential exists. The last step is
 * what makes the first run work without a config file — a user who exported
 * `ANTHROPIC_API_KEY` should not have to also tell us about it.
 */
export async function resolveProvider(opts: {
  provider?: string | undefined;
  model?: string | undefined;
} = {}): Promise<ResolvedProvider> {
  const available = await listCredentials();

  if (opts.provider) {
    const credential = await getCredential(opts.provider);
    if (!credential) {
      const envVars = opts.provider === 'gemini' ? 'GEMINI_API_KEY' : `${opts.provider.toUpperCase()}_API_KEY`;
      throw new ProviderError({
        provider: opts.provider,
        message: `No API key found for ${opts.provider}.`,
        hints: [
          `Set the environment variable ${envVars}, or run:`,
          `  urlume config --provider ${opts.provider} --key <key>`,
        ],
      });
    }
    return build(credential, opts.model, available);
  }

  // No preference: take the first provider that has a key, in PROVIDER_IDS order,
  // so the choice is deterministic rather than dependent on object iteration.
  for (const id of PROVIDER_IDS) {
    const credential = await getCredential(id);
    if (credential) return build(credential, opts.model, available);
  }

  throw new ProviderError({
    provider: 'none',
    message: 'No AI provider is configured.',
    hints: [
      'urlume needs one API key. Either export an environment variable:',
      '  ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY',
      'or store one:',
      '  urlume config --provider anthropic --key <key>',
    ],
  });
}

function build(
  credential: Awaited<ReturnType<typeof getCredential>> & object,
  requestedModel: string | undefined,
  available: Awaited<ReturnType<typeof listCredentials>>
): ResolvedProvider {
  const provider = createProvider(credential.provider, credential.key, {
    ...(credential.baseUrl !== undefined ? { baseUrl: credential.baseUrl } : {}),
    ...(credential.headers !== undefined ? { headers: credential.headers } : {}),
  });

  const model =
    requestedModel ??
    credential.defaultModel ??
    DEFAULT_MODELS[credential.provider] ??
    '';

  if (!model) {
    throw new ProviderError({
      provider: credential.provider,
      message: `No model specified for ${credential.provider}.`,
      hints: [
        'A custom endpoint has no default model. Name one:',
        `  urlume config --provider ${credential.provider} --model <id>`,
        '  urlume models        # what this key can reach',
      ],
    });
  }

  return {
    provider,
    model,
    origin: available.find((a) => a.provider === credential.provider)?.origin ?? 'file',
  };
}

/** Every model reachable with the configured keys. For `urlume models`. */
export async function listAllModels(): Promise<{ provider: string; models: Model[]; error?: string }[]> {
  const out: { provider: string; models: Model[]; error?: string }[] = [];

  for (const id of PROVIDER_IDS) {
    const credential = await getCredential(id);
    if (!credential) continue;
    try {
      const provider = createProvider(id, credential.key, {
        ...(credential.baseUrl !== undefined ? { baseUrl: credential.baseUrl } : {}),
        ...(credential.headers !== undefined ? { headers: credential.headers } : {}),
      });
      out.push({ provider: id, models: await provider.listModels() });
    } catch (err) {
      // One unreachable provider should not hide the others.
      out.push({
        provider: id,
        models: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return out;
}

/**
 * OpenAI adapter — and, by configuration, every OpenAI-compatible endpoint.
 *
 * Mistral, Groq, Together, OpenRouter, vLLM, LM Studio and Ollama all speak
 * `/chat/completions` with a bearer token. So this is one adapter with a
 * `baseUrl`, not five near-identical files: §6 lists "OpenAI-compatible APIs" and
 * "local models where practical" as separate providers, but the wire format is the
 * same and duplicating it would mean fixing every bug five times.
 *
 * What differs from Anthropic: the system prompt is an ordinary message, images are
 * data URLs inside a content array, and there is a real `response_format`.
 */

import {
  ProviderError,
  explainStatus,
  withRetry,
  type AIProvider,
  type GenerateRequest,
  type GenerateResponse,
  type Message,
  type Model,
} from './types.js';

export interface OpenAICompatibleOptions {
  /** Provider id, e.g. `openai`, `mistral`, `ollama`. */
  id: string;
  name: string;
  apiKey: string;
  /** Without a trailing slash. Defaults to OpenAI's own. */
  baseUrl?: string;
  envVars?: readonly string[];
  /** Returned by `listModels()` when the endpoint has no `/models`, or when its
   *  listing carries no capability information worth trusting. */
  fallbackModels?: readonly Model[];
  /**
   * Extra request headers.
   *
   * Some gateways authenticate the *client* as well as the key and reject an
   * unrecognised `user-agent` with a 401 that reads exactly like a bad key — which
   * sends a user to rotate a credential that was never the problem. Being able to
   * set one is the difference between "works" and "unusable" for those endpoints.
   */
  headers?: Readonly<Record<string, string>>;
}

const OPENAI_MODELS: readonly Model[] = [
  { id: 'gpt-5', name: 'GPT-5', provider: 'openai', contextWindow: 400_000, vision: true, structuredOutput: true },
  { id: 'gpt-5-mini', name: 'GPT-5 mini', provider: 'openai', contextWindow: 400_000, vision: true, structuredOutput: true },
  { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'openai', contextWindow: 1_047_576, vision: true, structuredOutput: true },
  { id: 'o4-mini', name: 'o4-mini', provider: 'openai', contextWindow: 200_000, vision: true, structuredOutput: true },
];

const MISTRAL_MODELS: readonly Model[] = [
  { id: 'mistral-large-latest', name: 'Mistral Large', provider: 'mistral', contextWindow: 128_000, vision: false, structuredOutput: true },
  { id: 'pixtral-large-latest', name: 'Pixtral Large', provider: 'mistral', contextWindow: 128_000, vision: true, structuredOutput: true },
];

interface ChatContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

interface ChatResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

/** A message with images becomes a content array; plain text stays a string,
 *  because some compatible servers reject the array form for text-only turns. */
function toChatMessage(message: Message): {
  role: string;
  content: string | ChatContent[];
} {
  if (!message.images?.length) {
    return { role: message.role, content: message.content };
  }

  const content: ChatContent[] = message.images.map((image) => ({
    type: 'image_url',
    // Inline data URL rather than a hosted URL: a screenshot of the user's own
    // site is not uploaded anywhere (§30.1).
    image_url: { url: `data:image/png;base64,${image}` },
  }));
  if (message.content) content.push({ type: 'text', text: message.content });
  return { role: message.role, content };
}

/** Always returns a value — an absent reason means a normal stop. */
function mapFinishReason(reason: string | undefined): NonNullable<GenerateResponse['stopReason']> {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'refusal';
    default:
      return reason ? 'error' : 'stop';
  }
}

export function createOpenAICompatibleProvider(opts: OpenAICompatibleOptions): AIProvider {
  const baseUrl = (opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const fallback = opts.fallbackModels ?? [];
  const extraHeaders = opts.headers ?? {};

  return {
    id: opts.id,
    name: opts.name,
    envVars: opts.envVars ?? ['OPENAI_API_KEY'],

    async listModels(): Promise<Model[]> {
      // `/models` returns ids but no capabilities, so a listed id is merged with
      // the static table where one exists. Reporting `vision: false` for a model
      // that has it would silently disable the vision re-rank.
      try {
        const response = await fetch(`${baseUrl}/models`, {
          headers: { authorization: `Bearer ${opts.apiKey}`, ...extraHeaders },
        });
        if (!response.ok) return [...fallback];

        const parsed = (await response.json()) as { data?: { id?: string }[] };
        const ids = (parsed.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
        if (!ids.length) return [...fallback];

        const known = new Map(fallback.map((m) => [m.id, m]));
        return ids.map(
          (id) => known.get(id) ?? { id, name: id, provider: opts.id }
        );
      } catch {
        // A local server that is not running should not crash `urlume models`.
        return [...fallback];
      }
    },

    async generate(request: GenerateRequest): Promise<GenerateResponse> {
      const body = {
        model: request.model,
        messages: request.messages.map(toChatMessage),
        ...(request.maxTokens !== undefined ? { max_completion_tokens: request.maxTokens } : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        // `json_object` rather than a full JSON schema: the storyboard schema is
        // large, deeply nested and uses unions that several compatible servers
        // reject outright. Zod validates regardless (§6.2), so the schema buys
        // little and costs portability.
        ...(request.json ? { response_format: { type: 'json_object' } } : {}),
      };

      return withRetry(
        async () => {
          let response: Response;
          try {
            response = await fetch(`${baseUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${opts.apiKey}`,
                ...extraHeaders,
              },
              body: JSON.stringify(body),
              ...(request.signal ? { signal: request.signal } : {}),
            });
          } catch (err) {
            throw new ProviderError({
              provider: opts.id,
              model: request.model,
              message: `Could not reach ${baseUrl}: ${(err as Error).message}`,
              hints:
                baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')
                  ? ['A local model server does not appear to be running.']
                  : ['Check network access and any proxy configuration.'],
            });
          }

          if (!response.ok) {
            const { message, hints } = explainStatus(response.status, opts.id);
            let detail = '';
            try {
              const parsed = (await response.json()) as ChatResponse;
              detail = parsed.error?.message ?? '';
            } catch {
              detail = await response.text().catch(() => '');
            }

            // A gateway that rejects the *client* returns the same 401 as a bad
            // key, so the default hint sends the user to rotate a credential that
            // was never the problem. Say so when the body hints at it.
            const clientRejected =
              response.status === 401 && /client|unauthorized client|user-?agent/i.test(detail);

            throw new ProviderError({
              provider: opts.id,
              model: request.model,
              status: response.status,
              message: detail ? `${message} ${detail}` : message,
              hints: clientRejected
                ? [
                    'This endpoint rejected the client, not necessarily the key.',
                    'Some gateways only accept requests from specific tools and check',
                    'the `user-agent` header to decide.',
                    '',
                    'Set one with:',
                    `  urlume config --provider ${opts.id} --header "user-agent: <value>"`,
                  ]
                : hints,
            });
          }

          const parsed = (await response.json()) as ChatResponse;
          const choice = parsed.choices?.[0];
          const text = choice?.message?.content ?? '';

          if (!text) {
            // `length` with empty content is its own failure and not a refusal: a
            // reasoning model spends output budget on internal thinking before it
            // emits anything, so a maxTokens sized to the expected answer is
            // consumed before the answer starts. Saying "refusal" here sends the
            // user to rewrite a prompt that was fine.
            const truncated = choice?.finish_reason === 'length';
            throw new ProviderError({
              provider: opts.id,
              model: request.model,
              message: truncated
                ? 'The model used its entire output budget before writing any answer.'
                : 'The model returned an empty response.',
              hints: truncated
                ? [
                    'This is a reasoning model spending its budget on internal',
                    'thinking. Raise maxTokens, or ask for a shorter film.',
                  ]
                : [
                    'A refusal or a filtered completion usually looks like this.',
                    `finish_reason: ${choice?.finish_reason ?? 'absent'}`,
                  ],
            });
          }

          request.onToken?.(text);

          return {
            text,
            model: parsed.model ?? request.model,
            stopReason: mapFinishReason(choice?.finish_reason),
            ...(parsed.usage
              ? {
                  usage: {
                    inputTokens: parsed.usage.prompt_tokens ?? 0,
                    outputTokens: parsed.usage.completion_tokens ?? 0,
                  },
                }
              : {}),
          };
        },
        { ...(request.signal ? { signal: request.signal } : {}) }
      );
    },
  };
}

export function createOpenAIProvider(apiKey: string): AIProvider {
  return createOpenAICompatibleProvider({
    id: 'openai',
    name: 'OpenAI',
    apiKey,
    envVars: ['OPENAI_API_KEY'],
    fallbackModels: OPENAI_MODELS,
  });
}

export function createMistralProvider(apiKey: string): AIProvider {
  return createOpenAICompatibleProvider({
    id: 'mistral',
    name: 'Mistral',
    apiKey,
    baseUrl: 'https://api.mistral.ai/v1',
    envVars: ['MISTRAL_API_KEY'],
    fallbackModels: MISTRAL_MODELS,
  });
}

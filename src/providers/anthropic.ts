/**
 * Anthropic adapter.
 *
 * Talks to the Messages API over `fetch` rather than through `@anthropic-ai/sdk`.
 * The interface needs two things — text and JSON — and the SDK's value is in the
 * surface this deliberately does not expose (streaming helpers, tool runners,
 * beta features). A direct call keeps the dependency surface small and the failure
 * modes visible.
 *
 * Two things differ from every OpenAI-shaped API and are easy to get wrong:
 *
 * 1. The system prompt is a **top-level field**, not a message with
 *    `role: 'system'`. Passing one in `messages` is a 400.
 * 2. There is no `response_format: json`. JSON mode is achieved by prefilling the
 *    assistant turn with `{` — the model then has no way to open with prose, and
 *    the `{` must be prepended back onto the response because it is not echoed.
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

const API = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

/**
 * Known models, with the capability flags the pipeline routes on.
 *
 * Hard-coded because Anthropic has no public model-list endpoint that returns
 * capabilities. `listModels()` therefore returns this table rather than pretending
 * to discover it — an honest static list beats a fake dynamic one.
 */
const MODELS: readonly Model[] = [
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    provider: 'anthropic',
    contextWindow: 200_000,
    vision: true,
    structuredOutput: true,
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    contextWindow: 200_000,
    vision: true,
    structuredOutput: true,
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    contextWindow: 200_000,
    vision: true,
    structuredOutput: true,
  },
];

interface AnthropicContent {
  type: 'text' | 'image';
  text?: string;
  source?: { type: 'base64'; media_type: string; data: string };
}

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
  model?: string;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
}

/** Split urlume's flat message list into Anthropic's system + turns shape. */
function splitMessages(messages: Message[]): {
  system: string | undefined;
  turns: { role: 'user' | 'assistant'; content: AnthropicContent[] }[];
} {
  const systemParts: string[] = [];
  const turns: { role: 'user' | 'assistant'; content: AnthropicContent[] }[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(message.content);
      continue;
    }

    const content: AnthropicContent[] = [];
    // Images before text: the model should have seen the screenshot before it
    // reads the question about it.
    for (const image of message.images ?? []) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: image },
      });
    }
    if (message.content) content.push({ type: 'text', text: message.content });
    if (content.length) turns.push({ role: message.role, content });
  }

  return {
    system: systemParts.length ? systemParts.join('\n\n') : undefined,
    turns,
  };
}

/** Always returns a value — an absent reason means a normal stop, so the return
 *  type is narrowed rather than left optional. */
function mapStopReason(reason: string | undefined): NonNullable<GenerateResponse['stopReason']> {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'refusal':
      return 'refusal';
    default:
      return reason ? 'error' : 'stop';
  }
}

export function createAnthropicProvider(apiKey: string): AIProvider {
  return {
    id: 'anthropic',
    name: 'Anthropic',
    envVars: ['ANTHROPIC_API_KEY'],

    async listModels(): Promise<Model[]> {
      return [...MODELS];
    },

    async generate(request: GenerateRequest): Promise<GenerateResponse> {
      const { system, turns } = splitMessages(request.messages);

      if (!turns.length) {
        throw new ProviderError({
          provider: 'anthropic',
          model: request.model,
          message: 'No user message to send.',
          hints: ['A system prompt alone is not a request; Anthropic requires a turn.'],
        });
      }

      // JSON mode by assistant prefill. With `{` already in its mouth the model
      // cannot open with "Here is the storyboard:", which is the failure
      // extractJson exists to clean up. The `{` is not echoed back, so it has to
      // be prepended to the result.
      const prefill = request.json === true;
      if (prefill) turns.push({ role: 'assistant', content: [{ type: 'text', text: '{' }] });

      const body = {
        model: request.model,
        max_tokens: request.maxTokens ?? 8192,
        ...(system !== undefined ? { system } : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        messages: turns,
      };

      return withRetry(
        async () => {
          let response: Response;
          try {
            response = await fetch(API, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': VERSION,
              },
              body: JSON.stringify(body),
              ...(request.signal ? { signal: request.signal } : {}),
            });
          } catch (err) {
            // A transport failure has no status, so it is not retried by
            // withRetry — which is correct: a bad proxy or offline machine will
            // not fix itself in two seconds.
            throw new ProviderError({
              provider: 'anthropic',
              model: request.model,
              message: `Could not reach the Anthropic API: ${(err as Error).message}`,
              hints: ['Check network access and any proxy configuration.'],
            });
          }

          if (!response.ok) {
            const { message, hints } = explainStatus(response.status, 'anthropic');
            // The body usually says more than the status does.
            let detail = '';
            try {
              const parsed = (await response.json()) as AnthropicResponse;
              detail = parsed.error?.message ?? '';
            } catch {
              detail = await response.text().catch(() => '');
            }
            throw new ProviderError({
              provider: 'anthropic',
              model: request.model,
              status: response.status,
              message: detail ? `${message} ${detail}` : message,
              hints,
            });
          }

          const parsed = (await response.json()) as AnthropicResponse;
          const text = (parsed.content ?? [])
            .filter((block) => block.type === 'text')
            .map((block) => block.text ?? '')
            .join('');

          const full = prefill ? `{${text}` : text;

          // Streaming is not implemented here: this adapter is used for
          // storyboard generation, where the caller needs a complete document
          // before it can do anything. `onToken` is honoured as a single chunk so
          // a progress indicator still works rather than silently never firing.
          request.onToken?.(full);

          return {
            text: full,
            model: parsed.model ?? request.model,
            stopReason: mapStopReason(parsed.stop_reason),
            ...(parsed.usage
              ? {
                  usage: {
                    inputTokens: parsed.usage.input_tokens ?? 0,
                    outputTokens: parsed.usage.output_tokens ?? 0,
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

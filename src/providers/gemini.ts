/**
 * Google Gemini adapter.
 *
 * A third wire format, different from both the others in ways that are silent
 * rather than loud:
 *
 *   - turns are `contents` with `parts`, and the assistant role is `model`
 *   - the system prompt is `systemInstruction`, its own top-level object
 *   - generation settings live under `generationConfig`, not at the top level
 *   - images are `inlineData` with a `mimeType`
 *   - JSON mode is `responseMimeType: 'application/json'`
 *   - the key goes in a header, and the model id is in the URL path
 *
 * Getting the role name wrong does not error; it produces a conversation where the
 * model cannot see its own prior turns.
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

const API = 'https://generativelanguage.googleapis.com/v1beta';

const MODELS: readonly Model[] = [
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'gemini', contextWindow: 1_048_576, vision: true, structuredOutput: true },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'gemini', contextWindow: 1_048_576, vision: true, structuredOutput: true },
];

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

function splitMessages(messages: Message[]): {
  systemInstruction: { parts: GeminiPart[] } | undefined;
  contents: { role: 'user' | 'model'; parts: GeminiPart[] }[];
} {
  const systemParts: string[] = [];
  const contents: { role: 'user' | 'model'; parts: GeminiPart[] }[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(message.content);
      continue;
    }

    const parts: GeminiPart[] = [];
    for (const image of message.images ?? []) {
      parts.push({ inlineData: { mimeType: 'image/png', data: image } });
    }
    if (message.content) parts.push({ text: message.content });
    if (parts.length) {
      // 'model', not 'assistant'. The wrong name is accepted and quietly drops
      // the turn from the model's view of the conversation.
      contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
    }
  }

  return {
    systemInstruction: systemParts.length ? { parts: [{ text: systemParts.join('\n\n') }] } : undefined,
    contents,
  };
}

/** Always returns a value — an absent reason means a normal stop. */
function mapFinishReason(reason: string | undefined): NonNullable<GenerateResponse['stopReason']> {
  switch (reason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'PROHIBITED_CONTENT':
    case 'BLOCKLIST':
      return 'refusal';
    default:
      return reason ? 'error' : 'stop';
  }
}

export function createGeminiProvider(apiKey: string): AIProvider {
  return {
    id: 'gemini',
    name: 'Google Gemini',
    envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],

    async listModels(): Promise<Model[]> {
      try {
        const response = await fetch(`${API}/models`, {
          headers: { 'x-goog-api-key': apiKey },
        });
        if (!response.ok) return [...MODELS];

        const parsed = (await response.json()) as {
          models?: { name?: string; displayName?: string; inputTokenLimit?: number;
                     supportedGenerationMethods?: string[] }[];
        };

        const known = new Map(MODELS.map((m) => [m.id, m]));
        const listed = (parsed.models ?? [])
          // Ids come back as `models/gemini-2.5-pro`; the generate call wants the
          // bare id.
          .map((m) => ({ ...m, id: (m.name ?? '').replace(/^models\//, '') }))
          .filter((m) => m.id && m.supportedGenerationMethods?.includes('generateContent'))
          .map((m): Model => {
            const hit = known.get(m.id);
            if (hit) return hit;
            return {
              id: m.id,
              name: m.displayName ?? m.id,
              provider: 'gemini',
              ...(m.inputTokenLimit !== undefined ? { contextWindow: m.inputTokenLimit } : {}),
            };
          });

        return listed.length ? listed : [...MODELS];
      } catch {
        return [...MODELS];
      }
    },

    async generate(request: GenerateRequest): Promise<GenerateResponse> {
      const { systemInstruction, contents } = splitMessages(request.messages);

      if (!contents.length) {
        throw new ProviderError({
          provider: 'gemini',
          model: request.model,
          message: 'No user message to send.',
          hints: ['Gemini requires at least one `contents` entry.'],
        });
      }

      const body = {
        contents,
        ...(systemInstruction ? { systemInstruction } : {}),
        generationConfig: {
          ...(request.maxTokens !== undefined ? { maxOutputTokens: request.maxTokens } : {}),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.json ? { responseMimeType: 'application/json' } : {}),
        },
      };

      return withRetry(
        async () => {
          let response: Response;
          try {
            response = await fetch(
              `${API}/models/${encodeURIComponent(request.model)}:generateContent`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
                body: JSON.stringify(body),
                ...(request.signal ? { signal: request.signal } : {}),
              }
            );
          } catch (err) {
            throw new ProviderError({
              provider: 'gemini',
              model: request.model,
              message: `Could not reach the Gemini API: ${(err as Error).message}`,
              hints: ['Check network access and any proxy configuration.'],
            });
          }

          if (!response.ok) {
            const { message, hints } = explainStatus(response.status, 'gemini');
            let detail = '';
            try {
              const parsed = (await response.json()) as GeminiResponse;
              detail = parsed.error?.message ?? '';
            } catch {
              detail = await response.text().catch(() => '');
            }
            throw new ProviderError({
              provider: 'gemini',
              model: request.model,
              status: response.status,
              message: detail ? `${message} ${detail}` : message,
              hints,
            });
          }

          const parsed = (await response.json()) as GeminiResponse;

          // A prompt-level block returns 200 with no candidates at all, which
          // would otherwise surface as a confusing empty string.
          if (parsed.promptFeedback?.blockReason) {
            throw new ProviderError({
              provider: 'gemini',
              model: request.model,
              message: `The prompt was blocked: ${parsed.promptFeedback.blockReason}`,
              hints: ['Safety filters rejected the request before generation.'],
            });
          }

          const candidate = parsed.candidates?.[0];
          const text = (candidate?.content?.parts ?? [])
            .map((part) => part.text ?? '')
            .join('');

          if (!text) {
            throw new ProviderError({
              provider: 'gemini',
              model: request.model,
              message: 'The model returned no text.',
              hints: [`finishReason: ${candidate?.finishReason ?? 'absent'}`],
            });
          }

          request.onToken?.(text);

          return {
            text,
            model: request.model,
            stopReason: mapFinishReason(candidate?.finishReason),
            ...(parsed.usageMetadata
              ? {
                  usage: {
                    inputTokens: parsed.usageMetadata.promptTokenCount ?? 0,
                    outputTokens: parsed.usageMetadata.candidatesTokenCount ?? 0,
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

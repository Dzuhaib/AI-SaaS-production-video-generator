/**
 * Errors that a person can act on.
 *
 * `Error: ENOENT` tells a user nothing. Every failure surface in the renderer
 * carries what failed, and what to try next — the hints are the part that
 * matters, and they are required rather than optional.
 */

export class RenderError extends Error {
  readonly hints: readonly string[];

  constructor(message: string, hints: readonly string[]) {
    super(message);
    this.name = 'RenderError';
    this.hints = hints;
  }

  /** Multi-line form for the terminal. */
  format(): string {
    const out = [this.message];
    if (this.hints.length) {
      out.push('');
      out.push(...this.hints);
    }
    return out.join('\n');
  }
}

/**
 * ffmpeg failure, with its own tail of stderr.
 *
 * ffmpeg writes its real diagnostics to stderr and exits non-zero, so the exit
 * code alone is never enough to say what went wrong.
 */
export class EncodeError extends RenderError {
  readonly stderr: string;
  readonly code: number | null;

  constructor(message: string, stderr: string, code: number | null) {
    const tail = stderr.trim().split('\n').slice(-8);
    super(message, [
      ...(tail.length ? ['', 'ffmpeg said:', ...tail.map((l) => `  ${l}`)] : []),
    ]);
    this.name = 'EncodeError';
    this.stderr = stderr;
    this.code = code;
  }
}

/**
 * Keys this process has loaded, registered by the credential store.
 *
 * A late-bound setter rather than an import, because `providers/` imports from
 * `renderer/errors.ts` for `redact` and importing back the other way would make
 * the two circular. The pattern passes below cannot match a key issued by a
 * custom gateway in an unanticipated format, and gateways commonly echo the
 * submitted key in a 401 body — so the literal keys are the load-bearing half.
 */
let knownKeys: () => readonly string[] = () => [];

export function registerSecretSource(source: () => readonly string[]): void {
  knownKeys = source;
}

/** `sk-proj-abc…xyz` — enough to tell two keys apart, not enough to use one. */
function mask(key: string): string {
  if (key.length <= 12) return '*'.repeat(key.length);
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

/** Redact anything that looks like a credential before a message is logged. */
export function redact(text: string): string {
  let out = text;

  for (const key of knownKeys()) {
    if (key.length >= 8) out = out.split(key).join(mask(key));
  }

  return out
    .replace(/\b(sk-ant-[A-Za-z0-9_-]{16,})/g, 'sk-ant-***')
    .replace(/\b(sk-[A-Za-z0-9_-]{16,})/g, 'sk-***')
    .replace(/\b(AIza[A-Za-z0-9_-]{16,})/g, 'AIza***')
    .replace(
      /\b(api[-_]?key|authorization|bearer)(["'\s:=]+)([A-Za-z0-9._-]{8,})/gi,
      '$1$2***'
    );
}

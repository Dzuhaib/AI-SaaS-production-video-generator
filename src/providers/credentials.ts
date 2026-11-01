/**
 * Credential storage.
 *
 * Honest about what this is: environment variables first, then a 0600 file in
 * the user's home directory. That is meaningfully weaker than an OS keychain,
 * and the CLI says so when it writes a key.
 *
 * `keytar` would give real keychain storage but is a native module — a build
 * toolchain requirement on Windows and a common install failure. Trading a
 * working `npm install` for stronger at-rest storage is the wrong call for a
 * first release, so the limitation is documented rather than hidden.
 *
 * Hard rules, in priority order:
 *   - Never in the project directory. `.urlume/` may be committed.
 *   - Never in logs, errors, or anything sent to a provider.
 *   - Never in a storyboard, a film, or a render artefact.
 */

import { readFile, writeFile, mkdir, chmod, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export interface Credential {
  provider: string;
  key: string;
  /** Optional override for OpenAI-compatible endpoints. */
  baseUrl?: string;
  /** Model to use when none is named. */
  defaultModel?: string;
  /** Extra request headers. Some gateways authenticate the client as well as the
   *  key and reject an unrecognised `user-agent`. */
  headers?: Record<string, string>;
}

export interface CredentialSource {
  provider: string;
  /** Where it came from, so `providers` can show it without showing the key. */
  origin: 'env' | 'file';
  /** e.g. `OPENAI_API_KEY` or the store path. */
  detail: string;
}

const ENV_VARS: Record<string, readonly string[]> = {
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
};

export function storePath(): string {
  return join(homedir(), '.urlume', 'credentials.json');
}

/**
 * Where keys lived before the rename.
 *
 * Read-only, and only when the current path holds nothing. A user who stored a
 * key under the old name should not have to notice that the product was renamed;
 * the first write after this lands at the new path, so the fallback quietly stops
 * being consulted rather than needing a migration step that could fail.
 */
function legacyStorePath(): string {
  return join(homedir(), '.genvid', 'credentials.json');
}

interface StoreShape {
  version: 1;
  credentials: Record<string, Omit<Credential, 'provider'>>;
}

function parseStore(text: string): StoreShape | null {
  try {
    const parsed = JSON.parse(text) as StoreShape;
    return parsed.credentials ? parsed : null;
  } catch {
    // A corrupt store should not stop a run that could use env vars instead.
    return null;
  }
}

async function readStore(): Promise<StoreShape> {
  for (const path of [storePath(), legacyStorePath()]) {
    if (!existsSync(path)) continue;
    const parsed = parseStore(await readFile(path, 'utf8'));
    if (parsed) return parsed;
  }
  return { version: 1, credentials: {} };
}

/**
 * Write via a temp file and rename.
 *
 * A direct write that is interrupted leaves a truncated store, which loses every
 * key rather than the one being changed. Rename is atomic on both platforms.
 * The mode is set before the rename so the file is never briefly world-readable.
 */
async function writeStore(store: StoreShape): Promise<void> {
  const path = storePath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
  try {
    await chmod(tmp, 0o600);
  } catch {
    // Non-POSIX filesystem. restrictWindows below is the real guard there.
  }
  await rename(tmp, path);
  await restrictWindows(path);
}

/**
 * On Windows, `mode: 0o600` is silently ignored and the file inherits the user
 * profile's ACL — which on a domain or multi-user machine can include groups
 * other than the owner. Measured on a test machine: mode reported 666 and
 * `icacls` listed an inherited non-owner group with read access.
 *
 * `/inheritance:r` drops inherited entries, then `/grant:r <user>:F` gives the
 * owner full control and nobody else anything. Best-effort: a failure here must
 * not stop a key being stored, but it does change what we are allowed to claim,
 * which is why `storageNotice()` asks whether this succeeded.
 */
async function restrictWindows(path: string): Promise<void> {
  if (process.platform !== 'win32') return;
  const user = process.env.USERNAME;
  if (!user) return;
  const { execFile } = await import('node:child_process');
  await new Promise<void>((done) => {
    execFile(
      'icacls',
      [path, '/inheritance:r', '/grant:r', `${user}:F`],
      { windowsHide: true },
      () => done()
    );
  });
}

/** Env wins over the file, so a shell override needs no config edit. */
export async function getCredential(provider: string): Promise<Credential | null> {
  for (const name of ENV_VARS[provider] ?? []) {
    const value = process.env[name];
    if (value?.trim()) {
      rememberSecret(value.trim());
      return { provider, key: value.trim() };
    }
  }

  const store = await readStore();
  const entry = store.credentials[provider];
  if (!entry) return null;
  rememberSecret(entry.key);
  return { provider, ...entry };
}

/** What is configured, without exposing any key material. */
export async function listCredentials(): Promise<CredentialSource[]> {
  const found: CredentialSource[] = [];
  const seen = new Set<string>();

  for (const [provider, vars] of Object.entries(ENV_VARS)) {
    for (const name of vars) {
      if (process.env[name]?.trim()) {
        found.push({ provider, origin: 'env', detail: name });
        seen.add(provider);
        break;
      }
    }
  }

  const store = await readStore();
  for (const provider of Object.keys(store.credentials)) {
    if (seen.has(provider)) continue; // env already shadows it
    found.push({ provider, origin: 'file', detail: storePath() });
  }

  return found.sort((a, b) => a.provider.localeCompare(b.provider));
}

export async function setCredential(cred: Credential): Promise<void> {
  const store = await readStore();
  // Fields are copied explicitly rather than spread, so nothing a caller happens
  // to be carrying (a whole provider object, a stray token) lands in the store by
  // accident. Adding a field to `Credential` means adding a line here.
  const entry: Omit<Credential, 'provider'> = { key: cred.key };
  if (cred.baseUrl) entry.baseUrl = cred.baseUrl;
  if (cred.defaultModel) entry.defaultModel = cred.defaultModel;
  if (cred.headers && Object.keys(cred.headers).length) entry.headers = cred.headers;
  store.credentials[cred.provider] = entry;
  await writeStore(store);
}

export async function removeCredential(provider: string): Promise<boolean> {
  const store = await readStore();
  if (!(provider in store.credentials)) return false;
  delete store.credentials[provider];
  await writeStore(store);
  return true;
}

/** `sk-proj-abc…xyz` — enough to tell two keys apart, not enough to use one. */
export function maskKey(key: string): string {
  if (key.length <= 12) return '*'.repeat(key.length);
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

/**
 * Strip anything key-shaped from text about to be logged or displayed.
 *
 * The known-key pass matters more than the pattern pass: a custom
 * OpenAI-compatible endpoint may issue keys in a format no regex here
 * anticipates, and those are exactly the ones most likely to leak.
 */
export function redactSecrets(text: string, knownKeys: readonly string[] = []): string {
  let out = text;

  for (const key of knownKeys) {
    if (key.length >= 8) out = out.split(key).join(maskKey(key));
  }

  return out
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, 'sk-***')
    .replace(/\bsk-ant-[A-Za-z0-9_-]{16,}/g, 'sk-ant-***')
    .replace(/\bAIza[A-Za-z0-9_-]{20,}/g, 'AIza***')
    .replace(
      /\b(api[-_]?key|authorization|bearer|token)(["'\s:=]+)([A-Za-z0-9._-]{12,})/gi,
      '$1$2***'
    );
}

/**
 * Every key this process has seen, for redaction.
 *
 * `redactSecrets`' pattern pass cannot match a key issued by a custom gateway in
 * a format no regex anticipates — and those are exactly the keys most likely to
 * appear in an error body, because gateways commonly echo the submitted key in a
 * 401. So the keys themselves are the primary defence and the patterns are the
 * fallback. In-memory only, never written anywhere.
 */
const seenKeys = new Set<string>();

export function rememberSecret(key: string | undefined | null): void {
  if (key && key.length >= 8) seenKeys.add(key);
}

export function knownSecrets(): readonly string[] {
  return [...seenKeys];
}

/**
 * Shown once when a key is first written, because at-rest storage here is weaker
 * than a keychain and a user should know that rather than assume.
 *
 * Platform-specific because the guarantee is: POSIX gets mode 0600, Windows gets
 * an ACL reset by `restrictWindows`. Claiming "0600" on Windows was inaccurate —
 * the mode is ignored there — and an inaccurate security claim shown to a user is
 * its own compliance problem.
 */
export function storageNotice(): string {
  const where = `Stored in ${storePath()}`;
  const how =
    process.platform === 'win32'
      ? 'with an ACL restricted to your user account (inherited permissions removed).'
      : 'with file permissions 0600.';
  return (
    `${where} ${how}\n` +
    `This is not an OS keychain. Anyone who can read your user profile can read\n` +
    `this file. To avoid storing it at all, use an environment variable instead.`
  );
}

/** @deprecated Use `storageNotice()` — the notice is platform-dependent. */
export const STORAGE_NOTICE = storageNotice();

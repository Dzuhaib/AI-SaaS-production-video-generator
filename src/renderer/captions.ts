/**
 * Caption and subtitle sidecars — WebVTT and SubRip.
 *
 * The single largest compliance gap in a published video, in both markets:
 *
 * - **US** — ADA Title III as applied to web content, FCC 47 CFR §79.4 for
 *   internet-distributed programming that aired on TV, and Section 508 for
 *   anything touching federal procurement.
 * - **UK** — Equality Act 2010 (reasonable adjustments), and the Ofcom
 *   Guidelines on Television Access Services for anything broadcast.
 * - **Both** — WCAG 2.2 SC 1.2.2 (Captions, Level A).
 *
 * It is also simply how feed video works: most of a social audience watches
 * muted, so an uncaptioned film is an unwatched one.
 *
 * The timings and line discipline below follow Ofcom's guidance, which is the
 * stricter and better-specified of the two regimes; a file that satisfies it
 * satisfies the FCC's four quality criteria (accuracy, synchronicity,
 * completeness, placement) as well.
 */

import type { Storyboard } from '../storyboard/schema.js';

/* ------------------------------------------------------------------ *
 * Caption discipline
 * ------------------------------------------------------------------ */

/**
 * Ofcom's Guidelines on Television Access Services, §"Subtitling":
 *
 * - Reading speed should not exceed about 160-180 words per minute for
 *   pre-recorded content. 180 is the ceiling, so 160 is used here — a marketing
 *   film has dense on-screen text competing for the same eye.
 * - No more than two lines, at roughly 34-38 characters each.
 * - A caption must hold long enough to be read. Under about a second it
 *   registers as a flicker rather than as text.
 */
export const CAPTION = {
  wordsPerMinute: 160,
  maxLines: 2,
  maxCharsPerLine: 37,
  minDurationMs: 1000,
  maxDurationMs: 7000,
  /** A frame or two of separation so consecutive cues do not visually merge. */
  gapMs: 80,
} as const;

export interface Cue {
  /** 1-based, as both formats require. */
  index: number;
  startMs: number;
  endMs: number;
  /** Already wrapped to at most `maxLines`. */
  lines: string[];
}

/**
 * Wrap on words, never mid-word, and prefer breaking at punctuation.
 *
 * A caption broken mid-phrase costs more comprehension than one that runs a
 * few characters long, which is why this balances the two lines rather than
 * greedily filling the first.
 */
export function wrapCaption(text: string, maxChars = CAPTION.maxCharsPerLine): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return [clean];

  const words = clean.split(' ');
  // Balance: aim for two lines of similar length rather than one full and one
  // short, which reads better and is what broadcast subtitlers do by hand.
  const target = Math.ceil(clean.length / 2);

  let best: [string[], number] | null = null;
  for (let split = 1; split < words.length; split++) {
    const first = words.slice(0, split).join(' ');
    const second = words.slice(split).join(' ');
    if (first.length > maxChars || second.length > maxChars) continue;
    // Prefer a break after punctuation, then a balanced one.
    const punctuationBonus = /[,.;:!?—]$/.test(first) ? maxChars : 0;
    const cost = Math.abs(first.length - target) - punctuationBonus;
    if (!best || cost < best[1]) best = [[first, second], cost];
  }
  if (best) return best[0];

  // Too long for two lines at this width. Hard-wrap greedily and let the caller
  // split into further cues.
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && `${line} ${word}`.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** How long a line needs to be on screen to be read, at the Ofcom rate. */
export function readingTimeMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const ms = (words / CAPTION.wordsPerMinute) * 60_000;
  return Math.max(CAPTION.minDurationMs, Math.round(ms));
}

/* ------------------------------------------------------------------ *
 * Building cues from a storyboard
 * ------------------------------------------------------------------ */

/**
 * Turn a storyboard into timed cues.
 *
 * Narration is the source. A scene with none contributes nothing rather than
 * having its headline captioned: on-screen text that is already legible does
 * not need repeating in a caption track, and access-services reviewers treat a
 * caption file that merely transcribes the titles as non-compliant padding.
 *
 * Non-speech audio is bracketed, which is the convention in both regimes.
 */
export function buildCues(sb: Storyboard): Cue[] {
  const cues: Cue[] = [];

  for (const scene of sb.scenes) {
    for (const line of scene.narration) {
      const start = scene.start + line.at;
      // A line with no explicit duration runs to the end of its scene, capped
      // at the readable maximum.
      const declared = line.dur ?? Math.max(0, scene.start + scene.duration - start);
      const needed = readingTimeMs(line.text);
      const span = Math.min(
        CAPTION.maxDurationMs,
        Math.max(CAPTION.minDurationMs, declared || needed)
      );

      const body = line.sound ? `[${line.text.replace(/^\[|\]$/g, '')}]` : line.text;
      const prefixed = line.speaker ? `${line.speaker}: ${body}` : body;

      // Split anything too long for two lines into consecutive cues, dividing
      // the span in proportion to each part's reading time.
      const wrapped = wrapCaption(prefixed);
      const chunks: string[][] = [];
      for (let i = 0; i < wrapped.length; i += CAPTION.maxLines) {
        chunks.push(wrapped.slice(i, i + CAPTION.maxLines));
      }

      const weights = chunks.map((c) => readingTimeMs(c.join(' ')));
      const total = weights.reduce((a, b) => a + b, 0) || 1;

      let cursor = start;
      for (const [i, chunk] of chunks.entries()) {
        const share = Math.round((weights[i]! / total) * span);
        const end = cursor + Math.max(CAPTION.minDurationMs, share);
        cues.push({ index: 0, startMs: cursor, endMs: end, lines: chunk });
        cursor = end + CAPTION.gapMs;
      }
    }
  }

  cues.sort((a, b) => a.startMs - b.startMs);

  // Overlapping cues are a hard error in both formats — a player shows one and
  // silently drops the other. Trimming the earlier one is the only repair that
  // keeps both visible.
  for (let i = 1; i < cues.length; i++) {
    const prev = cues[i - 1]!;
    const cur = cues[i]!;
    if (prev.endMs > cur.startMs - CAPTION.gapMs) {
      prev.endMs = Math.max(prev.startMs + 400, cur.startMs - CAPTION.gapMs);
    }
  }

  // Never run past the end of the film; a trailing cue is another QC rejection.
  for (const cue of cues) {
    cue.endMs = Math.min(cue.endMs, sb.duration);
    if (cue.startMs >= sb.duration) cue.endMs = cue.startMs;
  }

  const kept = cues.filter((c) => c.endMs > c.startMs);
  kept.forEach((c, i) => (c.index = i + 1));
  return kept;
}

/* ------------------------------------------------------------------ *
 * Serialisation
 * ------------------------------------------------------------------ */

/** `HH:MM:SS,mmm` for SubRip, `HH:MM:SS.mmm` for WebVTT. The separator is the
 *  only difference, and getting it wrong makes the file parse as empty. */
function timestamp(ms: number, separator: ',' | '.'): string {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3_600_000);
  const m = Math.floor((clamped % 3_600_000) / 60_000);
  const s = Math.floor((clamped % 60_000) / 1000);
  const milli = clamped % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(milli, 3)}`;
}

/**
 * WebVTT — the web standard, and the format a `<track>` element takes.
 *
 * The `Region`/`STYLE` blocks are deliberately omitted: a player that does not
 * understand them is required to ignore them, but several older ones instead
 * fail the whole file.
 */
export function toWebVtt(cues: Cue[]): string {
  const body = cues
    .map(
      (c) =>
        `${c.index}\n` +
        `${timestamp(c.startMs, '.')} --> ${timestamp(c.endMs, '.')}\n` +
        c.lines.join('\n')
    )
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

/**
 * SubRip — what broadcast and post-production tooling still expects, and what
 * ffmpeg's `subtitles` filter burns in.
 *
 * CRLF line endings: the format predates any specification, and the de-facto
 * one is what Windows tooling wrote. Several hardware players reject LF-only.
 */
export function toSrt(cues: Cue[]): string {
  return (
    cues
      .map(
        (c) =>
          `${c.index}\r\n` +
          `${timestamp(c.startMs, ',')} --> ${timestamp(c.endMs, ',')}\r\n` +
          c.lines.join('\r\n')
      )
      .join('\r\n\r\n') + '\r\n'
  );
}

/* ------------------------------------------------------------------ *
 * Review
 * ------------------------------------------------------------------ */

export interface CaptionIssue {
  cue: number;
  message: string;
}

/** Check a cue list against the reading-speed and duration rules, so a film
 *  that captions faster than anyone can read says so rather than shipping. */
export function reviewCaptions(cues: Cue[]): CaptionIssue[] {
  const issues: CaptionIssue[] = [];
  for (const cue of cues) {
    const text = cue.lines.join(' ');
    const span = cue.endMs - cue.startMs;
    const needed = readingTimeMs(text);
    if (span + 50 < needed) {
      issues.push({
        cue: cue.index,
        message:
          `on screen for ${span}ms but needs ~${needed}ms at ` +
          `${CAPTION.wordsPerMinute}wpm — "${text.slice(0, 40)}..."`,
      });
    }
    if (span > CAPTION.maxDurationMs) {
      issues.push({ cue: cue.index, message: `held ${span}ms; over ${CAPTION.maxDurationMs}ms reads as stuck` });
    }
    for (const line of cue.lines) {
      if (line.length > CAPTION.maxCharsPerLine) {
        issues.push({
          cue: cue.index,
          message: `line is ${line.length} chars; Ofcom guidance is ${CAPTION.maxCharsPerLine}`,
        });
      }
    }
  }
  return issues;
}

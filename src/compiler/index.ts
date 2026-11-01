/**
 * The compiler: storyboard JSON -> a playable, exportable film.
 *
 * Entirely deterministic. No AI runs here. The model already made every creative
 * decision and encoded it as validated JSON; this turns that into markup and
 * timeline records, and the same input always produces the same output.
 *
 * It emits three things into the output directory:
 *
 *   index.html      structure only — no animation, no inline motion styles
 *   timeline.js     all timing, and nowhere else
 *   assets/         a copy of runtime/
 *
 * The two rules that matter most here are structural. Script order is fixed
 * (`sfx.js` -> engine -> film), and the cursor/ring pair are the last children
 * of `.camera` rather than living inside a scene — inside a scene, the cut takes
 * the cursor with it.
 */

import { mkdir, writeFile, readdir, copyFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';

import type { Storyboard } from '../storyboard/schema.js';
import { buildScene } from './scenes.js';
import { CURSOR_SVG, CLICK_RING } from './cursor.js';
import { esc, jsString } from './escape.js';
import { themeFor, type Theme } from './theme.js';
import { contrastRatio } from '../shared/contrast.js';
import { rationalFps, frameRate, titleSafe } from '../shared/broadcast.js';
import { buildCues, toWebVtt, toSrt, reviewCaptions } from '../renderer/captions.js';

export interface CompileOptions {
  storyboard: Storyboard;
  /** Directory to write the film into. Created if absent. */
  outDir: string;
  /** Path to `runtime/`, copied to `<outDir>/assets`. */
  runtimeDir: string;
  /** Include the preview scrub bar. The renderer suppresses it via `?render=1`
   *  regardless, so this only affects a browser preview. */
  controls?: boolean;
  /** Where `depth.css` lives. Defaults to `<runtimeDir>/../assets`. */
  extraAssetsDir?: string;
}

export interface CompileResult {
  html: string;
  timeline: string;
  outDir: string;
  files: string[];
  /** Things worth telling the user that do not stop a compile. */
  notes: string[];
}

async function copyDir(from: string, to: string): Promise<string[]> {
  const written: string[] = [];
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dest = join(to, entry.name);
    if (entry.isDirectory()) {
      written.push(...(await copyDir(src, dest)));
    } else {
      await copyFile(src, dest);
      written.push(dest);
    }
  }
  return written;
}

/* ------------------------------------------------------------------ *
 * Markup
 * ------------------------------------------------------------------ */

function buildHtml(
  sb: Storyboard,
  sceneMarkup: string[],
  glassFilters: string,
  theme: Theme
): string {
  // Brand tokens are applied as inline custom properties rather than by editing a
  // preset: the preset stays intact, and accent, radius and typeface all restyle
  // the film from one declaration. The preset itself is chosen from the brand
  // (see theme.ts) instead of defaulting, which is what stops every film from
  // arriving in the same dark blue.
  const rootStyle = Object.entries(theme.vars)
    .map(([name, value]) => `${name}:${value}`)
    .join('; ');

  return `<!DOCTYPE html>
<html lang="en" data-aspect="${sb.aspect}">
<head>
<meta charset="utf-8">
<title>${esc(sb.product)}</title>
<link rel="stylesheet" href="assets/explainer.css">
<link rel="stylesheet" href="assets/components.css">
<link rel="stylesheet" href="assets/depth.css">
</head>
<body data-preset="${esc(theme.preset)}" style="${esc(rootStyle)}">

${glassFilters}

<div class="viewport"><div class="stage">

  <!-- The background field, derived from the brand accent (see theme.ts).
       Inside .stage because .stage is what gets rasterised: the renderer strips
       every body child that does not contain it, so a wash placed outside the
       stage is silently missing from every export while looking correct in
       preview. Outside .camera so a push-in does not scale the backdrop along
       with the scene.
       The aurora's own filter does not flatten the glass above it -- it is a
       sibling behind .camera, not an ancestor of any glass panel. -->
  ${theme.backdrop}

  <div class="camera" data-el="camera">

${sceneMarkup.join('\n\n')}

    <!-- Cursor and ring: last children of .camera, OUTSIDE every scene, so a
         cut does not take them with it. One pair for the whole film. -->
${CURSOR_SVG}
${CLICK_RING}
  </div>

  <!-- Film grade. This is what separates a graded frame from a screenshot of an
       HTML page, and it MUST be a sibling of .camera, never an ancestor. The
       overlay carries opacity < 1, and any ancestor with opacity < 1 becomes a
       backdrop root: placed inside .camera, it would flatten every glass panel
       beneath it and break backdrop-filter: url(#lens) refraction. A sibling
       tints what the camera painted without changing how anything inside that
       picture composited, and with no transition or @keyframes on it, a CSS
       animation can never freeze under frame-by-frame export. -->
  ${theme.grade}
</div></div>

<!-- Load order is fixed and getting it wrong means nothing animates:
     sfx.js first (the engine checks for window.SFX at mount), then the engine,
     then this film's timeline. -->
<script src="assets/sfx.js"></script>
<script src="assets/timeline.js"></script>
<script src="timeline.js"></script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ *
 * Timeline
 * ------------------------------------------------------------------ */

function buildTimeline(sb: Storyboard, sceneCode: string[], controls: boolean): string {
  const { width, height } = sb.resolution;
  const rate = frameRate(sb.fps);

  // SCENES is the single place scene times are written. Moving a scene then
  // means editing one number rather than hunting through offsets. Keys are
  // quoted because a scene id is model-supplied and need not be an identifier.
  const scenesTable = sb.scenes
    .map((s) => `    ${jsString(s.id)}: [${s.start}, ${s.duration}]`)
    .join(',\n');

  return `/* ${sb.product} — generated by urlume. Edit the storyboard, not this file.
   All timing lives here and nowhere else. */
(function () {
  'use strict';

  var SCENES = {
${scenesTable}
  };

  var tl = new Timeline({
    duration: ${sb.duration},
    // ${rate.label}fps as the exact rational (${rationalFps(sb.fps)}) — ${rate.note}.
    // The decimal would disagree with what ffmpeg is told, and the two clocks
    // have to be the same clock.
    fps: ${rate.den === 1 ? rate.num : `${rate.num} / ${rate.den}`},
    width: ${width},
    height: ${height}
  });

${sceneCode.join('\n\n')}

  tl.mount({ controls: ${controls} });
}());
`;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export async function compile(opts: CompileOptions): Promise<CompileResult> {
  const { storyboard: sb, outDir, runtimeDir } = opts;
  const controls = opts.controls ?? true;

  const markup: string[] = [];
  const code: string[] = [];

  for (const [index, scene] of sb.scenes.entries()) {
    const built = buildScene(scene, sb, index);
    markup.push(built.markup);
    code.push(built.code);
  }

  // The SVG filter defs must be inline in the same document: `backdrop-filter:
  // url(#lens)` only resolves against a filter in the same tree, never against
  // an external file or an <img>.
  let glassFilters = '';
  try {
    const svgPath = join(runtimeDir, 'assets', 'glass-filters.svg');
    await stat(svgPath);
    glassFilters = await import('node:fs/promises').then((fs) =>
      fs.readFile(svgPath, 'utf8')
    );
  } catch {
    // Without the filter the @supports guard drops to the blur stack, which
    // still reads as glass. Not fatal.
    glassFilters = '<!-- glass-filters.svg not found; refraction disabled -->';
  }

  const theme = themeFor(sb);
  const html = buildHtml(sb, markup, glassFilters, theme);
  const timeline = buildTimeline(sb, code, controls);

  await mkdir(outDir, { recursive: true });
  const htmlPath = join(outDir, 'index.html');
  const tlPath = join(outDir, 'timeline.js');
  await writeFile(htmlPath, html, 'utf8');
  await writeFile(tlPath, timeline, 'utf8');

  const assetFiles = await copyDir(join(runtimeDir, 'assets'), join(outDir, 'assets'));

  // The depth/frame/icon layer. It lives in `assets/` at the repo root rather than
  // in `runtime/`, because `runtime/` is generated from the core skill and the next
  // extract would delete anything else in it (§19.7).
  const depthSource = opts.extraAssetsDir ?? join(dirname(runtimeDir), 'assets');
  try {
    const depth = join(depthSource, 'depth.css');
    await stat(depth);
    const dest = join(outDir, 'assets', 'depth.css');
    await copyFile(depth, dest);
    assetFiles.push(dest);
  } catch {
    // Without it the film still renders: every rule in depth.css is additive, so
    // the loss is 3D and frames, not a broken page.
  }

  // `brand-extraction` §Contrast: "Report when you adjusted and by how much — a
  // designer will want to know their blue was lightened." Silently changing a
  // brand colour is the kind of thing that gets noticed in review rather than in
  // a log, so it is said out loud.
  const notes: string[] = [];
  if (theme.contrast) {
    const c = theme.contrast;
    notes.push(
      `accent ${c.from} reached only ${contrastRatio(c.from, c.background).toFixed(2)}:1 on ` +
        `${c.background}; adjusted to ${c.to} for ${c.ratio}:1 (WCAG AA needs 4.5:1)`
    );
  }

  /* ---- Captions ---------------------------------------------------- *
   * Written here rather than in the renderer because this is the stage that
   * holds the storyboard, and because a sidecar should exist as soon as the
   * film does — a preview in a browser can carry a <track> too.
   *
   * A film with no narration produces no file at all, which is the honest
   * outcome: an empty caption track asserts "this has been captioned" and is
   * worse than its absence.
   */
  const cues = buildCues(sb);
  const captionFiles: string[] = [];
  if (cues.length) {
    const vtt = join(outDir, 'captions.vtt');
    const srt = join(outDir, 'captions.srt');
    await writeFile(vtt, toWebVtt(cues), 'utf8');
    await writeFile(srt, toSrt(cues), 'utf8');
    captionFiles.push(vtt, srt);

    for (const issue of reviewCaptions(cues)) {
      notes.push(`caption ${issue.cue}: ${issue.message}`);
    }
  } else {
    notes.push(
      'no narration in the storyboard, so no caption sidecar was written. ' +
        'US ADA/FCC and UK Equality Act 2010 expectations attach to published ' +
        'video; add `narration` to the scenes that speak.'
    );
  }

  // Title-safe geometry, reported so a reviewer can check the film against it
  // without recomputing the percentages.
  const safe = titleSafe(sb.resolution.width, sb.resolution.height);
  notes.push(
    `title-safe area is ${safe.width}x${safe.height} at (${safe.left}, ${safe.top}) ` +
      `— EBU R95 / SMPTE RP 218, 5% inset`
  );

  return {
    html,
    timeline,
    outDir,
    files: [htmlPath, tlPath, ...assetFiles, ...captionFiles],
    notes,
  };
}

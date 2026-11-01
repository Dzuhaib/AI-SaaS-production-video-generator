---
name: playwright-deterministic-capture
description: Capturing browser frames so the same input always produces identical pixels — the seek-and-screenshot loop, readiness gates, wall-clock hazards, and parallel frame ranges. Use when building or debugging a video export pipeline that screenshots a page frame by frame.
---

# Deterministic Capture with Playwright

Rendering a browser animation to video is not recording. Recording samples a
clock you do not control, drops frames under load, and produces a different file
every run. Capture instead: set the animation to an exact time, screenshot it,
repeat.

This only works if the page is a pure function of time. Everything below is
about the second half of that contract — making sure nothing *else* on the page
is advancing on its own.

## The loop

```js
const film = await page.evaluate(() => window.__EXPLAINER__);

for (let f = 0; f < film.frames; f++) {
  await page.evaluate((n) => window.__EXPLAINER__.seekFrame(n), f);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`frames/${String(f).padStart(6, '0')}.png`, Buffer.from(shot.data, 'base64'));
}
```

That is the whole mechanism. `seekFrame` sets every animated property to its
value at that frame; the screenshot reads back the result.

**Why not `MediaRecorder` or `Page.startScreencast`:** both capture in real time.
If a frame takes 80ms to composite, the recording contains that stall. Capture
has no deadline — a slow frame makes the render slower, never worse.

## `captureScreenshot` vs `page.screenshot()`

`page.screenshot()` is the friendlier API and does more work: it can scroll,
clip to an element, and wait for fonts. At one call per frame that overhead
compounds.

```js
const cdp = await context.newCDPSession(page);
const shot = await cdp.send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: false,  // the film IS the viewport
  fromSurface: true,             // composited output, not the renderer's guess
});
```

`fromSurface: true` captures what the compositor actually produced, which
matters for `backdrop-filter` and anything else composited rather than painted.

I have not benchmarked the two side by side in this environment. Treat the
preference as reasoned from what each API does, not measured.

## Readiness: the gate that lies

```js
await page.waitForFunction(() => window.__EXPLAINER__?.ready === true);
```

This is the correct gate for *timing*. It is not sufficient for *correctness*.

**`document.fonts.ready` resolves when font loading finishes — including when it
finishes by failing.** A page whose webfont 404s reports ready, renders in a
fallback face with different metrics, and exports a film whose line breaks do not
match what you designed. There is no error anywhere.

Ask the different question:

```js
const missing = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('.t-hero, .t-display, .t-body')) {
    const style = getComputedStyle(el);
    const family = style.fontFamily.split(',')[0].trim().replace(/["']/g, '');
    if (/^(system-ui|sans-serif|serif|monospace|-apple-system)$/.test(family)) continue;
    if (!document.fonts.check(`${style.fontWeight} 16px "${family}"`)) out.push(family);
  }
  return out;
});
```

`fonts.check()` asks whether the face is usable *now*, which is what you need.

**Self-host the woff2 next to the film.** A CDN link works until the render
machine has no network, and then it silently falls back.

## Browser and context setup

```js
const browser = await chromium.launch({
  args: [
    '--hide-scrollbars',              // a scrollbar is 15px of your frame
    '--force-color-profile=srgb',     // or colours shift per display profile
    '--disable-lcd-text',             // subpixel AA differs between machines
    '--font-render-hinting=none',     // hinting differs between platforms
  ],
});

const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  reducedMotion: 'no-preference',
  colorScheme: 'dark',
});
```

**`reducedMotion: 'no-preference'` is not optional.** Headless Chromium can
report `prefers-reduced-motion: reduce`. Most well-built films neutralise their
camera under that query — so every push-in silently vanishes from the export
while the preview looks perfect.

**Pin `deviceScaleFactor`.** At 2 you get a 3840×2160 frame from a 1920 film,
which is either what you wanted or four times the disk and encode cost. Never
leave it to the environment.

**Set the viewport to the film's native size** after reading it from the page:

```js
await page.setViewportSize({ width: film.width, height: film.height });
```

Rasterising at native size is sharper than rendering small and upscaling in
ffmpeg. The stage re-fits on resize, so this must happen before the first
capture.

## Wall-clock hazards

Anything that advances without being told to will differ between two renders of
the same film.

**Images.** A lazily-loaded image that decodes on frame 40 is absent from frames
1–39, and the boundary moves each run.

```js
await page.evaluate(async () => {
  const images = [...document.images];
  images.forEach((img) => { img.loading = 'eager'; img.decoding = 'sync'; });
  await Promise.all(images.map((img) => img.decode().catch(() => {})));
});
```

**Media.** `<video>` and `<audio>` run on their own clock:

```js
await page.evaluate(() => {
  document.querySelectorAll('video, audio').forEach((el) => {
    el.pause();
    el.autoplay = false;
    el.currentTime = 0;
  });
});
```

**CSS animations.** `animation-play-state: paused` freezes an animation at
whatever time it had reached — which depends on how long the page took to load.
Pin to the first frame instead:

```js
await page.addStyleTag({
  content: `*, *::before, *::after {
    animation-delay: -0.0001s !important;
    animation-play-state: paused !important;
    transition: none !important;
  }`,
});
```

**Why the negative delay:** it seeks the animation to a fixed offset before
pausing, so every run pins to the same frame rather than to whenever the pause
landed.

**Carets and selection.** A text caret blinks on the browser's clock and lands in
roughly half your frames.

```css
* { caret-color: transparent !important; }
::selection { background: transparent !important; }
```

**Animated GIF and WebP have no fix.** No API can seek them. Replace with a still
or with an element the timeline drives.

## What capture cannot fix

State this to whoever is authoring the film, because these are theirs to solve:

| Hazard | Why capture cannot help |
|---|---|
| `Math.random()` in film code | Different values per run; seed it instead |
| Runtime `fetch` | Content may differ between runs |
| `Date.now()` in rendered output | Changes every render |
| Animated GIF/WebP | No seek API exists |

## GPU versus software rasterisation

Headless Chromium may rasterise on a different path than headed Chromium. The
effect is usually invisible; the exception is `backdrop-filter`, and especially
`backdrop-filter: url(#svg-filter)`.

If glass panels look correct in the browser and flat in the export, try
`--swiftshader` to force software rasterisation. It is slower and more
consistent. If that does not fix it, drop the SVG displacement filter and keep
the blur — it still reads as glass, and a slightly simpler material beats a
broken one.

I have not been able to verify headless backdrop-filter rasterisation in this
environment. Treat this section as the documented failure mode and its
workaround, not as a measured result.

## Parallelism comes free

Because `seek(t)` depends on nothing but `t`, frame ranges are independent. No
worker needs to know what any other worker did.

```js
const workers = Math.min(os.cpus().length - 1, 4);
const per = Math.ceil(film.frames / workers);

await Promise.all(
  Array.from({ length: workers }, (_, i) =>
    renderRange(i * per, Math.min((i + 1) * per, film.frames))
  )
);
```

Each worker writes globally-numbered PNGs into one shared directory, so the
sequence is complete without a merge step.

Two rules:

- **Render audio once, in the coordinator.** It is not per-frame work.
- **Encode once at the end.** Per-worker segments joined by the concat demuxer
  invite timestamp and keyframe seams at every boundary.

Past about 4 workers, contention on disk and memory usually outweighs the gain —
each Chromium instance holds a full-resolution compositor surface.

## PNG sequences cost disk

A 1920×1080 PNG of typical UI content runs 300KB–1.5MB. A 30-second film at
30fps is 900 frames — roughly 0.3–1.3GB of intermediate files.

Write to a temp directory and delete after encoding, but keep a `--keep-frames`
flag: when frame 412 is wrong, you want to look at frame 412 rather than
re-render to find it.

Piping PNGs directly to ffmpeg's stdin avoids the disk entirely, at the cost of
losing resumability and per-frame inspection. Start with files; optimise if
throughput actually demands it.

## Verifying determinism

Render the same frame twice and compare bytes:

```js
const a = await captureFrame(300);
const b = await captureFrame(300);
assert(a.equals(b), 'frame 300 is not reproducible');
```

Then check that arrival order does not matter — seek forward to 300, then
backward to 300 from 600, then cold in a fresh page. All three must match. If
they do not, something in the film is accumulating rather than computing from
`t`.

## Common mistakes

| Symptom | Cause |
|---|---|
| First frames use a different font than the rest | Capture started before the face loaded; `fonts.ready` resolved on failure |
| Text metrics differ between preview and export | Webfont fell back on the render machine; self-host the woff2 |
| Every camera move is missing from the export | Headless reported `prefers-reduced-motion: reduce` |
| Glass panels export flat, preview fine | Headless backdrop-filter rasterisation; try `--swiftshader` |
| A 15px strip on the right differs between runs | Scrollbar; add `--hide-scrollbars` |
| Two renders of one film differ | Something on the wall clock — GIF, video, `Math.random()`, or a CSS animation |
| Export is 2× the expected resolution | `deviceScaleFactor` inherited from the environment |
| Random frames show a text caret | Caret blinks on the browser clock; set `caret-color: transparent` |
| An image appears partway through | Lazy loading; force `eager` and await `decode()` |
| Colours differ between machines | No `--force-color-profile=srgb` |
| Frames look soft | Viewport smaller than the film; resize to native before capturing |
| Render slows steadily | Frames accumulating in memory; write each one out as you go |

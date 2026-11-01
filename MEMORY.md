# Urlume — session handoff

Read this, then `requirements.md` §60 (status).

## What works

```bash
export ANTHROPIC_API_KEY=...        # or OPENAI / GEMINI / MISTRAL
npx tsx src/cli.ts create https://any-saas.com --prompt "24 second product film"
```

Verified: `npm run typecheck` clean, `npm test` **226/226**, `npm run extract:check`
in sync. Renders 1920x1080 h264 yuv420p + AAC, ~12.7 fps capture, frame-identical
across runs.

Current gateway config (AgentRouter):

```bash
npx tsx src/cli.ts config --provider custom \
  --key sk-... --base-url https://agentrouter.org/v1 --model claude-opus-5 \
  --header "user-agent: claude-cli/1.0.0 (external, cli)"
```

**That header is mandatory.** AgentRouter authenticates the *client* and rejects an
unrecognised `user-agent` with a 401 that reads exactly like a bad key. It also caps
output at **8192 tokens** regardless of what is requested, and a reasoning model can
spend all of it thinking and return empty content — generation treats that as a
retryable attempt.

## The style problem, and what fixed it

The user's complaint was that every film looked the same regardless of the business.
Root causes, all now fixed — **nothing is hardcoded to a brand or an industry**:

1. `colorScheme: 'dark'` was hardcoded in the renderer. Removed; the film declares
   its own theme.
2. The aurora background was a fixed `hsl(211)` blue + `hsl(266)` purple +
   `hsl(190)` cyan. Now built from the accent as an analogous triad
   (`src/compiler/theme.ts`), with much lower opacity on light schemes.
3. Preset was always `apple`. Now derived from scheme + accent hue: light / warm /
   midnight / mono / apple.
4. The logo was extracted (`brand.logoSvg`) and thrown away. Now inlined; a site
   without one gets a wordmark in its own display face.
5. `radius`, `fontDisplay`, `fontText` were extracted and ignored. Now written as
   custom properties, so an 8px-radius product stops looking like a 20px one.
6. **`buildScene` had no per-type layouts** — every scene was "centred copy plus
   absolutely positioned elements". `src/compiler/layouts.ts` now gives each type a
   real composition: browser frame, phone frame + alternating bubbles, icon grid,
   scroll frame, logo lockup, end card.
7. **No feature extraction.** Element ranking finds what is *prominent* (nav, hero,
   buttons) and never the feature grid, so films talked about a problem and never
   showed the product. `src/browser/features.ts` reads feature cards by DOM shape,
   plan bullets, metrics with labels, integrations, narrative spine, CTAs, quotes.
8. No icons. `src/compiler/icons.ts` — 70 inlined stroke icons + a semantic
   resolver, so "WhatsApp" → message, "Auto booking" → calendar. **Inlined, never
   fetched**: films load over `file://` and §19.5 lists runtime network fetches as
   unguarded.
9. No 3D. `assets/depth.css` (NOT `runtime/` — extract wipes that) adds perspective
   scopes, tilts, decks, device/window frames, accent surfaces via `color-mix`.
10. `rotateY`/`rotateX`/`z` existed in the engine but were never in the schema, so
    nothing could tilt into frame. Exposed and bounded to ±60.
11. Every scene eased in, sat still, and was replaced — a slideshow. Frames now
    enter with 3D rotation, and the subject recedes in the last ~500ms so motion
    carries through the cut. End cards are exempt.

## Bugs fixed (do not reintroduce)

Earlier sessions, deterministic half:

1. Core skill filename/frontmatter mismatch — silently unresolved 12 policy refs.
2. `edit` policy stage cited `§ Pacing`, a `###` not a `##`.
3. Model strings interpolated raw into generated JS — `SCENES.${id}` broke on
   `"scene-1"`. Now `jsString()` + ordinal variable names + keyed lookup.
4. Tier 1 index measured 1295 tokens vs a documented ~400. Ceiling 1500. **Grows
   linearly (~2.2k at 27 skills) — past ~20, compact `renderIndex`.**
5. `filmClock` UI-exemption ignored settle+press, sat 210ms early.
   `respondAt = at + travel + 120 + 90 + latency`.
6. `detect.ts` `Awaited<ReturnType<typeof readdir>>` resolved to the Buffer
   overload — 10 type errors from one annotation.
7. Four of five element renderers wrote `left`/`top` without `.abs`.
8. Background used three class names the stylesheet does not define AND sat outside
   `.stage`, which the renderer strips.
9. `cursorTo` fades the cursor in and never out — it sat on the payoff and end card.

This session:

10. `analyzePageInPlace` could never have worked: `eval`'d a
    `function selectorFor(){}` statement then declared `const selectorFor` in the
    same scope — redeclaration SyntaxError.
11. Crawl used `waitUntil: 'domcontentloaded'` and lost the whole crawl on
    stripe.com. Now `'commit'` + best-effort DOM wait.
12. **Camera `x`/`y` read as absolute stage points.** A model writes them as a nudge
    from centre; `x: -40` became 1180px of translation and pushed the film off
    frame. Small values are now offsets, large ones absolute.
13. Rows positioned twice — container took row 1's coordinate, flexbox stacked the
    rest below it.
14. Copy block collided with elements — fixed 30% top landed on upper-half content.
15. `hero`/`heading` elements rendered as unstyled 16px divs.
16. **Frame 3D entrance lived in `defaultMotion`**, which only fires when the
    storyboard has no animations — and a model always supplies some. So depth was
    present only in films nobody generates. Now always emitted.
17. **Camera cropped the layout it aimed at.** A 1500px dashboard panel at 1.5x lost
    500px of its own width, off all four edges. Added `maxZoomFor(type)` (dashboard
    1.2, feature 1.15, device 1.9, text 2.5) and a clamp so the stage edge never
    enters shot. The craft-rule 2.5x cap is about *rasterisation*, a different limit
    from "the subject still fits".

Compliance session (`src/shared/`, `renderer/{flash,captions}`, `browser/svg-sanitize`):

18. `DELIVERY_PROFILES` was annotated `readonly DeliveryProfile[]`, which widens the
    tuple away and left `z.enum()` with no literals — **typecheck was red**, and
    `npm test` stayed green because vitest does not typecheck. The union is now
    derived from the tuple, so the two cannot drift.
19. **Four things were computed and then thrown away.** Each looked wired because
    the producing code was correct and cited its standard:
    * `conformance()` — exported, documented as running before a frame is
      rendered, called by nothing. Now emitted from `runPipeline` after compile
      and *before* the `stopAfterStoryboard` return, so `urlume storyboard` shows
      it too.
    * The **flash report** — `analyseFlashes` ran on every render and the CLI had
      no `'flash'` case, so a photosensitivity result reached nobody. Its own
      comment read "a report the user never sees is worse than one they can act
      on."
    * `describeFlashReport` — "Human-readable summary for the CLI", uncalled. The
      CLI now uses it rather than a second hand-rolled formatter.
    * `compiled.notes` — caption issues and title-safe geometry, dropped at the
      `'compiled'` emit.
20. **A lone metric got a browser window.** `layoutFor` tested content shape only
    under `feature` and `zoom`, so a `payoff` beat typed `dashboard` with one
    metric took `dashboardLayout`: a squat, near-empty chrome frame in the upper
    third with `+40%` at body size in its corner. `statLayout` existed for exactly
    that shot and was unreachable from `dashboard`. The test is now hoisted above
    the type switch (`isProofShot`), because the declared type is the model's word
    for a scene and the elements are what it actually contains — when they
    disagree, the elements are right. Multi-metric scenes now reach
    `featureLayout`, which renders all of them; the old route rendered the first
    and silently dropped the rest.

## Gotchas

* **`__name is not defined`** — tsx/esbuild `keepNames` rewrites named functions to
  `__name(fn,"fn")`; Playwright serialises `evaluate` callbacks to source and runs
  them in the page. Fixed in `src/browser/shim.ts`; **every context must call
  `installNameShim`.** Invisible until a specific evaluate runs.
* **Backticks in a generated HTML comment terminate the template literal.**
* `assets/depth.css` must NOT move into `runtime/` — extract deletes everything
  there except README.md.
* `ffmpeg-static` ships no ffprobe. Inspect with
  `./node_modules/ffmpeg-static/ffmpeg.exe -i FILE -f null -`
* **Tests that do not rasterise cannot catch composition bugs.** Several of the
  worst defects passed typecheck and a green suite. Render frames and *look*.

## Not built

```text
src/agent/loop.ts      conversational agent (§4, §29) — `urlume` prints help instead
src/project/*          local project mode not wired to the CLI (remote ships first)
tests/{render,mutation}/
3 of 19 planned skills (16 present)
```

`src/tui/` **does** exist now (`app.tsx`, `banner.ts`, `pickers.tsx`, `index.ts`,
13 tests) — it is the config/doctor surface, not a pipeline progress view, and it
does not consume `PipelineEvent`. `tests/browser/` exists with one live-Chromium
test. Earlier handoffs listed both as absent.

No live vendor HTTP call is unit-tested; adapters are covered by 27 stubbed-transport
tests asserting request *shape*, because those shapes fail silently (a
`role:'system'` in Anthropic's `messages` is a 400; Gemini accepts `assistant` and
drops the turn).

## Still open — the only criterion that finally matters

§55.3's last criterion has now been **partly** met: `clinza33.mp4` was sampled at
1fps into a contact sheet and looked at. It does **not** read as a generic
template — the palette, layouts, icons and copy are all the actual product. Six
distinct compositions across seven scenes.

What looking at it found, in severity order. Only the first is fixed:

1. ~~The payoff number buried in browser chrome~~ — fixed, see bug 20.
2. **Vertical dead space.** Most scenes load the top 40-60% and leave the bottom
   third empty. Worst on the checklist hook and the metric beats. The frame reads
   as a slide, not a shot.
3. **Long static holds.** Sampled at 1fps, scenes 4 and 5 are four near-identical
   frames each. Depth entrances fire at the cut, then the scene sits. This is the
   original "slideshow" complaint surviving in the middle of the film.
4. **Type is small at film scale.** Feature-card labels and dashboard rows would
   be unreadable on a phone. `kinetic-typography` says film-scale; the grid is
   web-scale.
5. **Headline position drifts** between scenes (high-left, centred, left), so the
   eye re-hunts at every cut.

2-5 are all composition, all invisible to the type checker and to 226 green tests,
and all found in about ninety seconds of looking at a contact sheet:

```bash
ffmpeg -i film.mp4 -vf "fps=1,scale=440:-1,tile=4x6:padding=6" -frames:v 1 sheet.jpg
```

Make that the first thing you do to any film.

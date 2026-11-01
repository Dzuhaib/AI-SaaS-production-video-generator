# urlume

An AI video agent for SaaS products. Point it at a website and it analyses the
brand, reads what the product actually does, writes a storyboard, and renders a
cinematic product film using that site's own colours, type, logo and copy.

## Install

```bash
npm install -g urlume
npx playwright-core install chromium     # ~150MB, once
```

> The name is `playwright-core`, not `playwright`. Each Playwright version expects
> one specific browser revision, so the generic installer can leave this one still
> looking for a revision that was never downloaded.

Then run it with no arguments for the interactive interface:

```bash
urlume
```

```text
urlume 0.1.0  ·  AI product films from a URL

Using anthropic (key from environment)

Paste a URL to begin, or /help for commands.

❯ https://your-saas.com  24 second launch film
```

Or drive it as a one-liner:

```bash
urlume create https://your-saas.com --prompt "24 second launch film"
```

Check the install at any time with `urlume doctor`.

## Commands inside the interface

| | |
|---|---|
| `<url> [prompt]` | make a film |
| `/key <key>` | store an API key |
| `/provider <id>` | anthropic, openai, gemini, mistral, custom |
| `/model <id>` · `/models` | choose a model, or list reachable ones |
| `/seconds <n>` · `/aspect <r>` | length, and 16:9 / 9:16 / 1:1 / 4:5 |
| `/quality <q>` · `/draft` | draft, high, master |
| `/save [path]` · `/open` | keep the render, or watch it |
| `/doctor` · `/status` · `/help` | |

One API key is needed, from any of Anthropic, OpenAI, Gemini or Mistral — or any
OpenAI-compatible endpoint, including a local model. Nothing about the site you film
needs to be yours beyond it being publicly reachable.

> **Status: the pipeline runs end to end.** 149 tests green, published as an npm
> package, verified by installing globally and rendering a film from a clean
> directory. The vendor HTTP call is covered by stubbed-transport tests rather than a
> live key in CI. See [Verification status](#verification-status).

---

## How it works

```
detect project -> start dev server -> drive Chromium -> analyse UI + brand
  -> AI writes a storyboard (JSON)   <- craft rules validate it
  -> compiler emits a film (HTML/CSS/JS)
  -> seek + screenshot every frame
  -> ffmpeg -> MP4
```

Two architectural decisions shape everything else.

**The AI decides WHAT, WHEN and WHY. The renderer decides HOW.** The model emits
validated JSON and never CSS, HTML, or timing code. A deterministic compiler
turns that JSON into a film. This is what makes a render reproducible, and it is
what allows the craft rules below to exist at all.

**Every visual is a pure function of time.** The animation engine's `seek(ms)` is
idempotent — seeking forward, backward, or cold to the same `t` produces
byte-identical output. Export is therefore not a recording but a loop of
`seek(frame)` + screenshot. Nothing accumulates, so nothing drifts, and frame
ranges are independent, which makes parallel rendering trivial.

The consequence you must respect when authoring a film: **never put a CSS
`transition` or `@keyframes` on anything the timeline animates.** Under
frame-by-frame export the browser clock does not advance, so those properties
freeze at their initial value while everything around them moves — perfect in
preview, broken in the export, with no error anywhere. Ambient motion goes in
`tl.loop(fn)`, which receives `t`.

---

## The skill system

Urlume's video craft lives in `Skills/` as markdown, not in prompts scattered
through the code. Making those skills *available* to a model is not enough — a
model that has read "cut, do not dissolve" will still crossfade every scene,
because nothing stopped it. So the rules bind at four levels:

| Tier | What | When | Cost |
|---|---|---|---|
| 0 | **Laws** — the non-negotiables | Every prompt, always | ~2k tokens |
| 1 | **Index** — every skill's name + description | Every prompt, always | ~1.3k tokens |
| 2 | **Retrieval** — one `##` section on request | When the model asks | ~1k per section |
| 3 | **Policy** — sections injected per pipeline stage | Unconditionally, per stage | ~2-8k |

Tier 2 exists because the core skill is thousands of lines; skills are indexed by
heading at load, so `readSection()` returns a section rather than a file.

Tier 3 exists because Tier 2 only fires when a model recognises it needs
something. That works for a question it knows it has and fails for the rules it
does not know it is about to break — a model writing a camera move does not think
to ask about backdrop roots, so the camera section is injected every time.

### Craft rules

`src/storyboard/craft-rules.ts` compiles skill prose into executable checks. Each
cites the section it derives from, so a rule can be traced back to the reasoning
that justifies it and the two cannot drift apart silently.

| Rule | Enforces |
|---|---|
| `cuts-not-crossfades` | Hard cuts; at most 2 dissolves per film |
| `no-linear-on-motion` | Never `linear` on a moving element |
| `scenes-overlap` | Ranges overlap so motion carries across a cut |
| `film-clock` | Entrances 400ms+, not UI timings |
| `overlap-not-queue` | Next move starts at ~65% of the previous |
| `stagger-range` | 60-120ms between siblings |
| `camera-discipline` | One move per beat, zoom ≤ 2.5×, leads the cursor |
| `payoff-hold` | 600-900ms of stillness after the payoff |
| `single-cta` | Exactly one call to action |
| `attributed-stats` | Every on-screen statistic carries its source |
| `vary-beat-length` | No two adjacent beats of identical length |
| `readable-type` | Body copy ≥ 24px on a 1920 stage |
| `no-random-stagger-on-text` | Random order destroys reading direction |

Violations that can be fixed without a judgement call are repaired in place.
Content decisions are not: a film with two calls to action goes back to the model
with the rule text, because silently deleting one would be worse than asking.

---

## Architecture

```
src/
  cli.ts            commander entry
  tui/              Ink interface
  agent/            loop, tool registry, prompt assembly
  providers/        AIProvider adapters + credential store
  project/          framework detection, dev-server supervisor
  browser/          Playwright session, page analysis, brand extraction
  storyboard/       Zod schema, generation, craft rules, editing
  compiler/         storyboard JSON -> film
  renderer/         capture -> ffmpeg -> MP4
  skills/           loader, index, policy, retrieval
  shared/           types, logging, errors
runtime/            the vendored animation engine (generated — see below)
Skills/             the craft library
tests/              unit | browser | render + mutation harness
```

Directories mirror the package boundaries in the eventual monorepo, and
cross-directory imports go only through each directory's `index.ts`, so splitting
into `packages/*` later is mechanical rather than an import rewrite.

### `runtime/` is generated

The animation engine — `timeline.js`, `explainer.css`, `components.css`,
`sfx.js`, `glass-filters.svg` and the starter film — ships as verbatim source
blocks inside `Skills/saas-explainer-motion.md`. It is extracted, never retyped:

```bash
npm run extract         # skill -> runtime/
npm run extract:check   # CI: fail if runtime/ has drifted from the skill
```

Editing `runtime/` directly is a mistake; the next extract overwrites it. Change
the skill.

---

## Requirements

- **Node ≥ 20.11**
- **Chromium**, installed by Playwright (`npx playwright install chromium`)
- **ffmpeg** — bundled via `ffmpeg-static`, no system install needed
- An API key for at least one provider

## Providers

OpenAI, Anthropic, Gemini, Mistral, and any OpenAI-compatible endpoint. Nothing
outside `src/providers/` imports a vendor SDK.

Keys are read from the environment first (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`GEMINI_API_KEY`, `MISTRAL_API_KEY`), then from `~/.urlume/credentials.json` at
mode 0600.

> **That file is not an OS keychain.** Anyone who can read your user profile can
> read it. `keytar` would give real keychain storage but is a native module and a
> frequent install failure on Windows; that trade is documented rather than
> hidden. Use environment variables if you would rather not store a key at rest.

Keys are never written to `.urlume/`, a storyboard, a log, or a render artefact,
and are redacted from every error message.

---

## Verification status

| Component | State |
|---|---|
| `scripts/extract-runtime.mjs` | **run** — extracts 7 files, 3756 lines |
| `src/storyboard/{schema,craft-rules}.ts` | **tested**, 28 tests green |
| `src/skills/{laws,library,policy}.ts` | **tested**, 24 tests green |
| `src/compiler/{index,scenes,cursor,escape}.ts` | **tested**, 17 tests green |
| `src/providers/{anthropic,openai,gemini}.ts` | **tested**, 27 tests (stubbed transport) |
| `src/storyboard/generate.ts` | **tested**, 18 tests — the validation loop |
| `src/browser/{analyze,brand,crawl}.ts` | **run** against live sites |
| `src/renderer/{index,encode,hazards,errors}.ts` | **run** — 588 frames to MP4 |
| `src/pipeline.ts`, `src/cli.ts` | **run** — URL to MP4 |
| `src/project/{detect,dev-server}.ts` | typechecks; local mode not wired to the CLI |
| interactive agent, Ink TUI | not started |
| 3 new skills (19 planned, 16 present) | not started |

The one thing no test covers is a live vendor HTTP call: the adapters are verified
against stubbed transports that assert each vendor's request shape, because those
three shapes fail *silently* when wrong (a system message in Anthropic's `messages`
array is a 400; Gemini's `assistant` role is accepted and drops the turn). Point it
at a real key to confirm the last hop.

Measured on the demo film (19.6s, 588 frames, 1920x1080, Windows, headless):

* **~12.7 frames/sec** captured — 46s of capture, 122s wall clock including a
  `-preset slow` encode. §31.2 previously listed this as unmeasured.
* **Frame-identical across runs.** Two renders of frames 280-285 produce
  byte-identical PNGs, which is the reproducibility claim in §55.3.
* **Glass composites in headless.** Panels show their specular rim and the
  background blooms read through them. Whether `backdrop-filter: url(#lens)`
  refraction is *pixel-identical* to headed mode is still unverified — that needs a
  headed comparison. If exported frames ever show flat glass, try `--swiftshader`,
  then drop `.glass-lens` and keep `.glass`.

The engine's own documentation said it had never been opened in a browser, and
that its visual composition was therefore unverified. It has now been opened, and
that turned out to be true in three places — all in this repo's compiler rather
than in the engine: elements were given coordinates without `.abs` to position
them against, the background wash used three class names the stylesheet does not
define and sat outside the `.stage` that gets rasterised, and the cursor was faded
in but never out, so it sat on the payoff and the end card. All three looked
correct in source and only failed when watched.

What has *not* been done is the last item in §55.3, and it is the one that
finally matters: nobody has watched the film and judged whether it reads as a
template.

---

## Development

```bash
npm install
npx playwright install chromium
npm run extract        # populate runtime/ from the core skill

npm test               # all suites
npm run test:unit      # pure functions — Node
npm run test:browser   # layout-dependent — real Chromium
npm run test:render    # the export pipeline end to end
npm run typecheck
```

The browser suite needs a real Chromium rather than jsdom: jsdom has no layout,
so `offsetParent`, `offsetTop/Left` and `getBoundingClientRect` all return 0 and
`getTotalLength()` is unimplemented. Anything touching `point()`, `cursorTo()` or
`draw()` cannot be tested there.

## License

MIT

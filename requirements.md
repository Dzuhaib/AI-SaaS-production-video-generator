# GENVID — AI VIDEO AGENT FOR WEB PROJECTS

## Master Product & Development Specification

> **Document status — revised to match the implementation in `src/`.**
>
> This began as a forward-looking brief. It is now a description of a system that
> was partly built, and the build made different decisions in several places. Those
> sections were rewritten rather than left standing, because a spec that disagrees
> with the code is worse than no spec: it is read as authoritative and it is wrong.
>
> The substantive changes, each with its reasoning recorded in place:
>
> | Was | Is | Why |
> |---|---|---|
> | Remotion for composition | Urlume's own compiler | §19.1 — two frame models, one clock |
> | Three.js + R3F for depth | CSS transforms; 3D opt-in | §16 — determinism, and R3F needs a React app |
> | 5 AI roles | 1 director; the rest deterministic | §8.1 — a model made those steps worse |
> | 10 mood presets | 5 colour/material presets | §21 — pacing belongs in rules, not tokens |
> | `VideoStyle` settings object | preset + craft rules split | §44 — pacing is not a preference |
> | Browser primitives as tools | one `analyze_page` pass | §28.1 |
> | Monorepo | one package, directory boundaries | §27 |
> | CLI-first build order | contract and renderer first | §46 |
> | Zustand, pnpm, 4K | removed or deferred | §26, §20 |
>
> **New sections 56-60** document the skill system, the craft rules, why validation
> *is* the architecture, the silent-failure hazards, and honest build status. All
> five exist in the code and none was in the first draft.
>
> Where this document and `src/` disagree, **`src/` is authoritative and this
> document is the bug.**
>
> **Nothing here has been run.** See §60 and §52.1.

You are a senior staff-level full-stack engineer, CLI/TUI engineer, AI agent architect, browser automation engineer, motion graphics engineer, and video rendering engineer.

Your task is to design and build **Urlume**, a production-quality AI-powered CLI application that turns existing web projects and SaaS applications into premium, cinematic product videos.

Urlume should feel like **Claude Code / Codex / Gemini CLI**, but its specialization is completely different:

> **Urlume is an AI agent that understands an existing web project, launches it, analyzes its UI, creates a cinematic storyboard, and renders a premium animated product video built from the real product's content.**

The product must be designed as a serious developer tool rather than a simple screen recorder.

Two decisions shape everything downstream, and both are easier to state now than to
discover in §17 and §19:

**The AI decides WHAT, WHEN and WHY. The renderer decides HOW.** The model emits
validated JSON and never CSS, HTML or timing code (§53).

**Every visual is a pure function of time.** So export is not a recording but a loop
of seek-and-screenshot, and a render is reproducible (§18.1).

---

# 1. CORE CONCEPT

A developer should be able to enter any supported web project:

```bash
cd my-saas
urlume
```

Urlume launches an interactive terminal interface.

The user can then type:

```text
Create a premium 30 second product video for this project.

Show the landing page, dashboard, AI generator and analytics.
Cinematic camera moves, premium SaaS style, dark.
```

Urlume should:

1. Detect the project and its framework.
2. Start the local development server, with permission.
3. Launch a controlled Chromium browser.
4. Analyze pages, rank UI elements, extract the brand.
5. Identify what is visually and commercially important.
6. Generate a storyboard as validated JSON.
7. Check it against the craft rules; repair or re-ask.
8. Ask for approval.
9. Compile a film — real product content, rebuilt as animatable components.
10. Capture it frame by frame, deterministically.
11. Encode to MP4 and save into the project.

The output should look like a professionally produced product video, not a raw screen
recording — and **not a slideshow of screenshots with crossfades**, which is the thing
that is easy to build and worthless to have.

Two consequences of that, both load-bearing and both counter-intuitive:

The film shows the product's **real content** but usually not its real pixels. A page
is analyzed and rebuilt from animatable components carrying its own copy, colours and
data, because a screenshot cannot be pushed into, cannot respond to a cursor, and
cannot animate a row arriving (§17).

The film is **rendered, not recorded.** Capture is a loop of seek-and-screenshot over
a timeline where every visual is a pure function of time, so the same storyboard
always produces the same video (§18.1).

---

# 2. PRODUCT NAME

Name:

**Urlume**

CLI:

```bash
urlume
```

Subcommands: see §23. Every pipeline stage is runnable on its own, which is a design
property rather than a convenience (§23.1).

The branding should feel premium, modern, technical and creative.

---

# 3. PRIMARY EXPERIENCE

Running:

```bash
urlume
```

inside a project should launch an interactive TUI.

Example:

```text
╭──────────────────────────────────────────────────────────────╮
│                                                              │
│   ██████╗ ███████╗███╗   ██╗██╗   ██╗██╗██████╗             │
│  ██╔════╝ ██╔════╝████╗  ██║██║   ██║██║██╔══██╗            │
│  ██║  ███╗█████╗  ██╔██╗ ██║██║   ██║██║██║  ██║            │
│  ██║   ██║██╔══╝  ██║╚██╗██║╚██╗ ██╔╝██║██║  ██║            │
│  ╚██████╔╝███████╗██║ ╚████║ ╚████╔╝ ██║██████╔╝            │
│   ╚═════╝ ╚══════╝╚═╝  ╚═══╝  ╚═══╝  ╚═╝╚═════╝             │
│                                                              │
│                 AI VIDEO AGENT                               │
╰──────────────────────────────────────────────────────────────╯

Project:    my-saas
Framework:  Next.js · pnpm · 8 routes
Model:      claude-opus-5
Status:     ● Ready          /help for commands

› Create a premium product video
```

The header shows the model because which model is directing is the single largest
influence on the result, and a user who has forgotten they are on a cheap one will
blame the tool.

The UI should feel similar in quality and usability to modern AI coding CLIs.

---

# 4. INTERACTIVE AGENT

Urlume should have a conversational agent loop.

Example:

```text
You:
Create a 30 second premium video highlighting the AI generator.

Urlume:
I'll analyze the project first.

✓ Next.js · pnpm · 8 routes from the filesystem
✓ Dev server          http://localhost:3001
✓ Analyzed 5 routes   247 elements ranked
✓ Brand               #5b8cff on #0b0d12 · Inter · radius 16px

  route         top elements                              score
  ──────────────────────────────────────────────────────────────
  /             hero, cta, feature ×3                      0.94
  /ai           composer, prompt form, output card         0.91
  /dashboard    metric ×4, chart, table                    0.88
  /analytics    chart ×2, metric ×3                        0.79
  /settings     form, table                                0.41

/ai is the strongest feature and you asked for it, so it gets the
longest beat. /dashboard earns a short one — it's mostly how someone
gets to /ai. /settings won't appear; a settings form in a product
film costs four seconds and says nothing.

Two things I need to warn you about:

  ⚠ /analytics charts are canvas-rendered, so that scene falls back
    to capture mode — it can't be pushed into past ~1.5x.
  ⚠ "Söhne" is declared but not loaded. Self-host the woff2 or the
    export will use fallback metrics and reflow every headline.
```

Then:

```text
Storyboard  ·  "Six answers to the same question, every morning."

  beat      scene                     start    dur    camera
  ────────────────────────────────────────────────────────────────────
  hook      inbox filling up          0.0s    4.2s   push → queue 1.6x
  stakes    response time climbing    4.0s    3.4s   hold
  reveal    Acme                      7.2s    2.8s   cut, no move
  how       AI generator drafting     9.8s    9.6s   push → composer 1.8x
  payoff    sent, queue empty        19.0s    4.4s   pull back 1.0x
  proof     2 counted metrics        23.0s    4.0s   hold
  end       one CTA                  26.8s    3.2s   hold

  30.0s · 900 frames · 1920x1080 · 30fps · preset apple
  brand: #5b8cff on #0b0d12 · Inter · radius 16px

  ✓ 13 craft rules pass
```

Note the beat order: the problem arrives before the product, so the reveal lands
as relief rather than as the start of a feature list. Beat lengths vary
deliberately — two adjacent beats of identical length read as a template, and
`vary-beat-length` rejects it.

The user can approve, modify, regenerate or render. Modification is
conversational and edits the structured storyboard rather than regenerating it
(§34).

---

# 5. COMMAND SYSTEM

Implement slash commands similar to modern AI CLI tools.

Example:

```text
/help
```

Available commands:

```text
/help          this list
/model         select the AI model
/provider      select the AI provider
/api           manage API keys (add | remove | list)

/project       detected framework, package manager, routes
/analyze       analyze routes; show ranked elements and brand
/brand         show the extracted brand; override accent, font, radius

/storyboard    show the current storyboard
/scenes        per-scene detail: timing, camera, animations, cues
/check         run the craft rules and report violations
/style         preset, aspect, fps
/aspect        16:9 | 1:1 | 9:16 | 4:5  (re-composes; see §20.1)

/preview       compile and open the film in a browser
/render        render to MP4
/skills        list the skill library; read one section

/status        session state: provider, project, dev server, storyboard
/settings      configuration
/clear         clear the conversation
/exit          shut down cleanly (dev server, browser)
```

Changed from the draft: `/check` and `/skills` added, since the craft rules and
the skill library are user-visible parts of the product rather than internals —
"why did it refuse to crossfade" deserves an answer. `/brand` and `/aspect` split
out from `/video` and `/preset`, both being things a user adjusts directly.
`/assets` folded into `/brand`.

## /model

Lists models from providers that actually have a key, via `listModels()` — not a
hardcoded catalogue that goes stale on every vendor release. Capability flags are
shown because they change what Urlume can do (§6.2):

```text
Select model                          ● has key   ○ no key

● Anthropic
    claude-opus-5              200k   vision  json
    claude-sonnet-5            200k   vision  json

● OpenAI
    gpt-5.6                    400k   vision  json

○ Google        no key — set GEMINI_API_KEY or run /api add
○ Mistral       no key

  Custom        OpenAI-compatible endpoint
```

`vision` matters for the optional re-rank (§8.2); `json` raises the odds a storyboard
parses first time but never removes validation (§6.2).

The model system is provider-agnostic (§6).

---

# 6. AI PROVIDER SYSTEM

Users must be able to connect their own API keys.

Do NOT lock Urlume to one AI provider.

Support an abstraction layer.

Initial providers:

* OpenAI
* Anthropic
* Google Gemini
* Mistral
* OpenAI-compatible APIs
* Local models where practical

Architecture:

```text
Urlume
   │
   ▼
AI Provider Interface
   │
   ├── OpenAI Adapter
   ├── Anthropic Adapter
   ├── Gemini Adapter
   ├── Mistral Adapter
   └── Custom Adapter
```

`src/providers/types.ts`:

```typescript
interface AIProvider {
  readonly id: string;
  readonly name: string;
  readonly envVars: readonly string[];
  listModels(): Promise<Model[]>;
  generate(request: GenerateRequest): Promise<GenerateResponse>;
}
```

**Nothing outside `src/providers/` imports a vendor SDK.** Swapping OpenAI for a
local model is an adapter, not a refactor.

## 6.1 The interface is deliberately small

Urlume needs exactly two things from a model: **structured JSON, and a stream of
text.**

Providers differ enormously in their streaming, tool-calling and multimodal APIs.
Modelling that surface here would leak every vendor's design decisions into the rest
of the codebase — and it would mean the abstraction has to grow every time one of
them ships a feature. A wide interface that mirrors five SDKs is not an abstraction;
it is five SDKs with extra steps.

```typescript
interface GenerateRequest {
  model: string;
  messages: Message[];        // role, content, optional base64 images
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  signal?: AbortSignal;
  onToken?: (chunk: string) => void;
}

interface GenerateResponse {
  text: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
  stopReason?: 'stop' | 'length' | 'refusal' | 'error';
}
```

Note the agent loop is Urlume's own (§29), not a provider's tool-calling API. Tools
are dispatched locally from parsed model output, so tool support does not have to be
abstracted across five different shapes — and a provider without tool calling still
works.

## 6.2 Capability flags, not capability assumptions

```typescript
interface Model {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  vision?: boolean;            // required for the vision re-rank
  structuredOutput?: boolean;  // raises the odds a storyboard parses first time
}
```

`structuredOutput` raises the odds; it never guarantees a schema match. **The caller
always validates** — no provider's JSON mode makes Zod optional.

## 6.3 JSON extraction is required regardless

Models wrap JSON in prose and code fences no matter how firmly they are asked not
to, and they do it with JSON mode enabled. So `extractJson()` does brace matching —
not a regex, which cannot handle nesting — and it is **string-aware**, because a `}`
inside a copy string would otherwise end the object early.

Three failure modes get distinct errors: no object at all (prints the first 200
characters, which is usually a refusal), a found-but-malformed object, and an
unterminated object — the last meaning the response was truncated, whose fix is
`maxTokens` or fewer scenes rather than a retry.

---

# 7. API KEY MANAGEMENT

Implement secure local credentials.

Commands:

```text
/api
/api add
/api remove
/api list
```

Example:

```text
/api add

Provider:
> OpenAI

API Key:
> **************

Model:
> GPT-5.6
```

Never store API keys in:

* project source code
* `.urlume/` — any file, including `config.json`
* Git
* storyboard files
* logs, errors, or render artefacts

## 7.1 Resolution order

Environment first, then the file store:

```bash
OPENAI_API_KEY
ANTHROPIC_API_KEY
GEMINI_API_KEY        # or GOOGLE_API_KEY
MISTRAL_API_KEY
```

Then `~/.urlume/credentials.json` at mode 0600.

## 7.2 That file is not a keychain

**Stated plainly rather than implied:** `~/.urlume/credentials.json` is a
permission-restricted file, not OS keychain storage. Anyone who can read the user's
profile can read it.

`keytar` would give real keychain storage, but it is a native module and a frequent
install failure on Windows — which would make a first run fail at
`npm install` for a meaningful share of users. That trade is documented in
`STORAGE_NOTICE` and shown when a key is first stored, rather than hidden behind
language like "secure credential storage."

Users who would rather not store a key at rest should use environment variables,
and `/api list` shows which provider resolved from `env` versus `file` so it is
always visible which is in play.

## 7.3 Writes are atomic

The store is written to a temp file and renamed. A direct write that is interrupted
leaves a truncated store, which loses **every** key rather than the one being
changed. Mode 0600 is set before the rename, so the file is never briefly
world-readable.

A corrupt store degrades to empty rather than throwing, so a bad file cannot block
a run that could have used environment variables instead.

## 7.4 Redaction

`maskKey()` for display (`sk-pro…4f2a`, or fully starred under 12 characters).
`redactSecrets()` runs over every error message and log line before it is shown or
written, so keys never appear in a `ProviderError`, a render log, or a crash trace.

It does two passes, and the order matters. First **known keys** — every key currently
loaded, replaced by literal substring match. Then pattern matching for `sk-`,
`sk-ant-`, `AIza`, and `api_key`/`authorization`/`bearer`/`token` followed by a value.

The known-key pass is the one that counts. A custom OpenAI-compatible endpoint may
issue keys in a format no regex here anticipates, and those are precisely the keys
most likely to leak — a pattern list only ever covers the vendors someone thought of.

---

# 8. MULTI-MODEL ARCHITECTURE

Urlume should eventually support specialized AI roles.

Example:

```text
                        GENVID
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   deterministic       DIRECTOR          optional
        │              (one model)            │
  detect, analyze,          │           vision re-rank,
  rank, extract,      beats, timing,      copy pass
  compile, capture    camera, copy            │
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
                    Video Pipeline
```

## 8.1 Only one role needs a model

The draft listed five AI roles. Construction reduced that to one, and the reduction
is the interesting part — each role turned out to be either deterministic or
mechanical:

| Draft role | Where it went |
|---|---|
| Project Analyzer | **deterministic.** Filesystem detectors (§9); no model call |
| Vision Analyzer | **deterministic heuristic** (§12.1). Vision is an optional re-rank, not the ranker |
| Video Director | **the model.** Beats, timing, camera, copy, emphasis — the only genuine judgement in the pipeline |
| Execution Agent | **deleted.** One `analyze_page` pass replaces a model driving a browser click by click (§28.1) |
| Render Planner | **deleted.** The compiler is a pure function of the storyboard (§19.3). A model planning renders would be a model introducing non-determinism |

What is left is the part that is actually hard: deciding what a film should say,
in what order, and where the viewer should be looking. That is one model call, or a
few.

Every role removed was removed because giving it to a model made the output worse,
not merely slower — a deterministic heuristic that ranks elements the same way
every time is worth more than a model that ranks them differently on each run,
because reproducibility is the product's core property.

## 8.2 Where a second model still helps

**Vision re-rank.** The heuristic scores DOM properties and cannot see that a
section is visually dominant despite being small, or that a "hero" is an empty
wrapper. A vision pass over the route screenshot can adjust `importance`. Opt-in
(`vision.rerank`), since it sends screenshots off the machine (§30.1) and costs a
call per route.

**Copy pass.** Headlines and the thesis are writing, and a model chosen for prose
may beat one chosen for structured output. Separable because copy lives in a
`copy` field the schema already isolates.

Neither is required, and the `AIProvider` interface (§6) already carries the
`vision` and `structuredOutput` capability flags needed to route a call to the
right model. So this is configuration, not architecture — which was the draft's
actual requirement, and it holds.

---

# 9. PROJECT DETECTION

When Urlume starts, inspect the current directory.

### Detectors as implemented

`src/project/detect.ts`, **most specific first** — order is load-bearing, because a
SvelteKit project is also a Vite project and matching Vite first would lose the route
convention. `DETECTORS`, in order:

```text
Next.js       next.config.* or the `next` dep; walks app/ AND pages/     port 3000
SvelteKit     @sveltejs/kit; walks src/routes for +page.svelte           port 5173
Astro         astro dep; walks src/pages                                 port 4321
Nuxt          nuxt dep; walks pages/                                     port 3000
React (CRA)   react-scripts; devScript is `start`, not `dev`             port 3000
Vite          vite.config.* or the vite dep; UI refined from deps        port 5173
Static HTML   *.html — last, because almost every project has one
```

CRA precedes Vite because a CRA project can carry a stray `vite` dependency, and its
dev script is `start` rather than `dev` — matching Vite first would produce a command
that does not exist.

The Vite detector refines the framework name from dependencies (`React (Vite)`,
`Vue (Vite)`, `Svelte (Vite)`, `Solid (Vite)`), because "Vite" alone tells the analyzer
nothing about what the UI is built from. It reports `routes: ['/']` and nothing more:
a Vite SPA has one HTML entry and its routes live in a client-side router that only
running the app would reveal, so route discovery is left to the browser analyzer
following in-page links.

Static HTML is last for the same reason it exists: almost every project has an
`index.html` somewhere, so it must only fire when nothing else matched.

New frameworks are added as a detector in this list. Each returns a confidence:
**1** when a config file and the dependency agree, **0.7-0.9** on one signal alone. A
route walk that finds nothing falls back to `['/']` rather than an empty list, since a
project with no discoverable routes still has a homepage.

**Below 0.5 the caller confirms with the user** rather than guessing. A wrong framework
means a dev command that fails, which is a worse experience than one question.

## 9.1 Only claim a dev script that exists

A detector proposes a script name by convention (`dev`, or `start` for CRA), but the
project decides. So the proposal is checked against `package.json` and falls back
through `dev` → `start` → `serve`, ending at `null` if none exists.

Without this, Urlume would confidently offer `pnpm dev` on a project whose only script
is `serve`, and the failure would surface as an exec permission prompt for a command
that cannot work. `devCommand` is null when there is nothing to run, which is the
honest answer for a static site.

`name` comes from `package.json` if present, otherwise the directory name.
`assetDirs` collects whichever of `public/`, `static/`, `assets/`, `src/assets` exist
(§35).

Returns:

```typescript
interface ProjectInfo {
  name: string;
  framework: string;
  confidence: number;
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun';
  devScript: string | null;
  devCommand: string | null;
  defaultPort: number;
  routes: string[];
  root: string;
  assetDirs: string[];
}
```

Two caveats stated in the code and worth repeating: **routes inferred from the
filesystem are not authoritative** — a route may exist that no file describes, and
a file may not be a route — and `defaultPort` is a hint for the log only. The real
port is parsed from the dev server's own output (§10).

---

# 10. DEVELOPMENT SERVER

`src/project/dev-server.ts`. Starting the project is the only `exec` permission in
the system, and it always prompts (§28.2).

## 10.1 Package manager

Never hardcoded. `detectPackageManager()` reads, in priority order:

```text
packageManager in package.json     Corepack — an explicit declaration
pnpm-lock.yaml                     → pnpm
bun.lockb / bun.lock               → bun
yarn.lock                          → yarn
otherwise                          → npm
```

The declaration wins over the lockfile because it is a statement of intent rather
than an artefact. Getting this wrong is expensive in a specific way: running
`npm install` in a pnpm workspace produces a broken `node_modules` and a very
confusing error several steps later, nowhere near the cause.

`devCommandFor()` composes the command — npm is the one that needs `run`
(`npm run dev` vs `pnpm dev`).

A malformed `package.json` is not fatal: a static site may still render, so
detection continues rather than aborting.

## 10.2 Port detection

The assigned port is **parsed from the server's own output**, not assumed from the
framework default. Every framework prints something different, so `parsePort()`
matches shapes rather than any one format:

```text
Next.js     - Local:  http://localhost:3000
Vite        ➜  Local:   http://localhost:5173/
SvelteKit   ➜  Local:   http://localhost:5173/
Astro       ┃ Local    http://localhost:4321/
```

A full localhost URL is the strongest signal and also confirms the host; an
explicit `port NNNN` phrasing is the fallback.

This matters because a framework default is frequently wrong in practice — port
3000 is occupied, so Next.js takes 3001 and says so. Assuming 3000 would point the
browser at whatever else is running there, which is a confusing failure.

## 10.3 Readiness

**A printed URL means the process chose a port, not that it can serve a request.**
Navigating on the strength of a log line races the server's first compile.

So Urlume polls the URL until it answers, then launches the browser. Any HTTP
response proves something is listening and speaking HTTP — **including a 404**,
which is fine: the film may only ever visit `/dashboard`.

```text
Urlume wants to run:  pnpm dev

Allow? [Y/n] y

Starting development server...
✓ Listening      http://localhost:3001
✓ Responding     200
```

## 10.4 Shutdown kills the process *tree*

The dev server is a child process and Urlume owns its lifetime: it is terminated on
clean exit, on `/exit`, on SIGINT and SIGTERM, and on an unhandled error. A stranded
dev server holding a port is a bug the user has to find and kill by hand.

`child.kill()` is **not sufficient**, and this is the platform detail most likely to
be got wrong:

* **Windows** — a spawned `npm.cmd` sits between Urlume and node, so `kill()` reaches
  only the shim and leaves the real server holding the port. `taskkill /PID <pid> /T
  /F` walks the tree.
* **POSIX** — a process-group kill via the negative pid, which requires
  `detached: true` at spawn. SIGTERM first, then SIGKILL after two seconds if it has
  not exited, because a dev server deserves a chance to close cleanly but not an
  unbounded one.

## 10.5 Two failure modes, two messages

The distinction matters because the fixes are unrelated:

**No port announced.** The server started but printed nothing Urlume could parse. The
error says so and points at setting the port explicitly in `.urlume/config.json`,
including the captured output.

**Port announced, never answered.** The process is running but not serving — usually
still compiling, or bound to a host other than localhost. A different message, because
"set the port" would be useless advice here.

Both carry the captured server output, which is where the real cause usually is
(§40.1).

---

# 11. BROWSER ENGINE

**Playwright + Chromium**, used for two quite different jobs. Conflating them is a
mistake, because their requirements conflict.

## 11.1 Analysis — driving someone else's site

Navigate, wait, inspect the DOM, read computed styles and bounding boxes, screenshot.
Reads only; it never interacts with the user's application beyond navigation and
scrolling.

`analyzeRoutes()` uses **one browser for all routes**; `analyzeRoute()` launches its
own and exists for the single-route case. Launch cost is paid once, not per page.

Analysis need not be deterministic — it is a survey, and a slightly different
screenshot changes nothing downstream, because ranking is computed from DOM
properties rather than from pixels.

Analysis runs at a 1440x900 viewport, not the film's 1920x1080. That is a desktop
size the site was probably designed for, and `aboveFold` should mean what a visitor
saw rather than what a film stage would show.

## 11.1a Waiting for a page that is actually there

`networkidle`, then a 5-second wait for `h1, h2, main, [role="main"]`.

An SPA reports `networkidle` before it has painted, so navigation alone is not enough
— analysing at that moment ranks an empty shell. Waiting for a real element beats a
fixed sleep, which is either too short on a slow machine or wasted on a fast one.

The selector wait is allowed to time out without failing: a page may genuinely be
sparse, and refusing to analyse a minimal landing page would be wrong.

## 11.2 Capture — driving our own film

This one **must** be deterministic, and everything in §19.4 and §19.5 exists to make
it so: fixed launch flags, `reducedMotion: 'no-preference'`, native-size viewport,
hazard guards, a raw CDP session for screenshots.

Launch flags that matter:

```text
--hide-scrollbars
--force-color-profile=srgb
--disable-lcd-text            subpixel AA differs between machines
--font-render-hinting=none
```

Those last two exist because a render should produce the same pixels on a
colleague's machine. Subpixel antialiasing and font hinting are both
machine-dependent, and both change glyph edges — enough to make a byte-comparison
test fail for a reason that has nothing to do with the film.

## 11.3 Packaging

`playwright-core` is a dependency; the full `playwright` package is a devDependency.
Core carries no browser binaries, so the CLI does not ship a Chromium download —
users run `npx playwright install chromium` once. The import is lazy, keeping it off
the CLI's cold start.

## 11.4 What is not used

No clicking, hovering, keyboard input or interaction with the analyzed site. A film
shows a **rebuilt** interface with a synthetic cursor (§17.1), so the demonstrated
interaction is authored on the timeline, not recorded from a real one.

Recording a real interaction would mean wall-clock capture, which loses
determinism, and it would tie the film's pacing to how fast the dev server
responded on the day. Authoring it means the click lands on the frame it should.

---

# 12. PROJECT VISUAL ANALYSIS

`src/browser/analyze.ts` navigates each route once and returns everything a
director needs from it: ranked elements with bounds and real text, the brand
system, and a screenshot.

## 12.1 Ranking, not recording

The AI must not record every page. Element ranking is a **deterministic
heuristic**, not a model call — it is cheap, reproducible, and good enough that a
model's judgement is better spent on structure than on guessing which div is the
hero.

`scoreOf` combines, clamped to 0..1:

| Signal | Contribution |
|---|---|
| Element type | 50% of the score — see the type weights below |
| Above the fold | +0.15 — what a visitor actually saw |
| Area, `sqrt` with a 0.15 cap | diminishing: a full-bleed wrapper is not 10x a card |
| Interactive with short text | +0.10 — a CTA is a deliberate decision about what matters |
| Text over 400 chars | −0.15 — a wall of text does not read on screen |
| Empty, and not an image or chart | −0.10 |

Type weights:

```text
hero 1.0   dashboard 0.95   chart 0.9   metric 0.85   feature 0.8
table 0.7  card 0.7         button 0.65 form 0.6      heading 0.55
image 0.5  video 0.5        row 0.4     badge 0.3     navigation 0.3
logo 0.3   (unknown 0.2)
```

Sorted descending, **capped at 60 elements per route** (collection itself stops at
400 candidates). A director does not need the 61st most important element on a page,
and the cap bounds prompt size on a large application.

The weights are judgement, not measurement. What matters is the **ordering** they
produce, not the absolute numbers — a hero heading above the fold outranking a nav
item, and a chart outranking a paragraph.

## 12.1a De-duplication

Classification runs over every element, which means a card and its inner wrapper both
match. So an element is skipped when an **ancestor was already collected as the same
type** — otherwise the top of the ranking fills with three nested versions of the same
card, and the model sees three features where there is one.

`area` is normalised against the viewport rather than measured in pixels, so the score
means the same thing at any window size. `aboveFold` tests intersection with the
viewport, not just `top < height`, so a tall hero that starts above the fold still
counts.

## 12.2 Junk suppression

Elements matching known chrome are dropped before scoring: cookie and consent
banners, GDPR notices, newsletter prompts, chat widgets (Intercom, Drift),
announcement bars, skip links. Every one of them is prominent, above the fold,
and worthless in a product film — exactly the profile the heuristic would
otherwise rank highly.

---

# 13. ELEMENT SELECTION

An element is identified by a selector chosen for **traceability, not for
querying** — the film never queries the real page, so a fragile selector is
acceptable. Preference order:

```text
data-testid / data-test    authored for automation; survives refactors
id                         only if it does not start with a digit or contain
                           a colon or whitespace — a CSS-invalid id is useless
class chain                up to 4 levels, one class per level, stopping early
                           at any ancestor id
```

Utility and state classes are filtered out of the chain: anything matching `is-` or
`has-`, and anything 24 characters or longer. A state class describes the moment the
page was captured rather than the element, and a long generated class name
(`css-1x9k2p-Wrapper`) changes on the next build. Both make a selector actively
misleading rather than merely fragile.

## 13.1 Classification is by role and shape, not class name

```text
nav / role=navigation                     → navigation
h1                                        → hero
h2, h3                                    → heading
button, or a.btn/.button/.cta             → button
table, or contains a table                → table
form, or contains input/textarea          → form
video, img/picture                        → video, image
svg with logo/brand in the class          → logo
svg with a path, wider than 180x90        → chart
class contains card/panel/tile            → card
metric/stat/kpi, dashboard, feature       → metric, dashboard, feature
badge/chip/tag/pill                       → badge
li, or class contains row/item            → row
```

Semantics first, class names only as a fallback, because a `<nav>` is a nav in every
codebase while `.card` means whatever that team decided. The chart heuristic is shape
as well as content: an SVG containing paths at chart proportions is a chart, while the
same markup at icon size is not.

## 13.2 Visibility gate

An element must be `display` and `visibility` visible, above 0.1 opacity, and **at
least 40x20 pixels**. The size floor removes tracking pixels, spacer divs and
collapsed wrappers — all technically visible, none filmable.

```typescript
interface AnalyzedElement {
  selector: string;
  type: string;
  text: string | null;
  bounds: { x: number; y: number; width: number; height: number };
  importance: number;   // 0..1
}
```

## 13.3 Two vocabularies, deliberately different sizes

`ELEMENT_TYPES` in the schema is what a **storyboard** may contain:

```text
hero      heading   button   card    chart   image   video
navigation  dashboard  form   table   modal   feature  logo
metric    row       badge    toast
```

The analyzer's `classify()` produces a **subset** of these. It never returns `toast`
or `modal`, because neither is reliably detectable in a static page: a toast has
usually already dismissed itself, and a modal that is open when the analyzer arrives
is more often a cookie dialog than a product feature.

Both stay in the schema anyway, because a film can *author* what a page cannot be
observed to have. A payoff beat landing a toast is one of the most useful moves
available, and it comes from the director's judgement rather than from something
harvested.

`metric`, `row` and `badge` were added beyond the original draft in the other
direction — they are detectable *and* they are what a rebuilt UI is made of: a
dashboard scene animates rows arriving and a metric counting up. `modal` is rarely
the right choice in a film either way; it reads as an interruption.

Text harvested here is what the rebuilt UI displays, which is what makes a
generated film specific to the product rather than generic.

---

# 14. STORYBOARD ENGINE

The storyboard is the contract between AI intelligence and deterministic
rendering. The model emits nothing but a value that parses against the schema —
never CSS, never HTML, never timing code.

Implemented in `src/storyboard/schema.ts`. **Zod** for runtime validation.

## 14.1 Units

All times are **milliseconds**, integers. All positions are **pixels in the
film's own fixed stage space** (1920x1080 by default) — never viewport units,
never percentages of something responsive. A film is a fixed canvas, so the
responsive-design instinct is wrong here and produces layouts that shift
between preview and export.

`SCHEMA_VERSION` is bumped whenever a change would stop an existing storyboard
from rendering.

## 14.2 Beat vocabulary

Every scene declares a `beat`. The order is problem-first on purpose: a viewer
who has not yet felt the problem has no slot to put the product into, so the
product must arrive as relief rather than as a feature list.

```text
hook      show the pain — no narration, no headline first
stakes    one number going the wrong way
reveal    hard cut; product name + one line
how       the only beat with real UI, and only a crop of it
payoff    it worked; let the moment land
proof     counted numbers, attributed
end       one action, held long enough to read
```

## 14.3 Scene modes

```text
rebuild   reconstruct the UI from glass components using content harvested
          from the real site. Can zoom, respond to a cursor, animate a row in.
capture   composite real captured frames. Pixel-exact but flat: goes soft past
          ~1.5x push-in and cannot respond to a cursor.
```

`rebuild` is the default. `capture` is the fallback for pages too custom to
rebuild faithfully — not the primary path. This reverses the naive assumption
that real pixels are always better: a flat image that cannot be pushed into or
interacted with is worth less in a film than a faithful rebuild that can.

## 14.4 Storyboard shape

```json
{
  "version": 1,
  "product": "Acme",
  "thesis": "Support teams answer the same question forty times a day.",
  "duration": 30000,
  "fps": 30,
  "aspect": "16:9",
  "resolution": { "width": 1920, "height": 1080 },
  "preset": "apple",
  "brand": {
    "accent": "#5b8cff",
    "scheme": "dark",
    "productName": "Acme",
    "radius": 16
  },
  "scenes": [
    {
      "id": "s1-hook",
      "beat": "hook",
      "type": "dashboard",
      "mode": "rebuild",
      "start": 0,
      "duration": 4200,
      "route": "/",
      "transition": { "kind": "cut", "fade": 0 },
      "camera": { "target": "queue", "zoom": 1.6, "at": 900, "dur": 1200, "ease": "inOutCubic" },
      "copy": { "headline": "Forty times a day.", "bodySize": 28 },
      "elements": [
        { "id": "queue", "type": "table", "importance": 0.9, "sourceSelector": "[data-testid=inbox]" }
      ],
      "animations": [
        { "target": "row", "at": 400, "dur": 620, "ease": "outQuint", "stagger": 90, "y": [24, 0] }
      ],
      "cursor": [{ "target": "reply", "at": 2600, "travel": 620, "click": true, "latency": 110 }],
      "cues": [{ "name": "tick", "at": 400 }],
      "hold": 700
    }
  ],
  "audio": { "enabled": true, "bed": "none" }
}
```

`thesis` is the single idea the film carries. If it cannot be written, the film
has no spine and no amount of motion will give it one.

## 14.5 Cross-field validation

`superRefine` enforces what per-field types cannot:

* **`resolution` must match `aspect`.** The engine derives frame count from
  `duration` and `data-aspect` sets the canvas on first paint. A mismatch gives
  a correctly-centred preview and a wrongly-cropped video — a bug you only find
  in the export.
* **Both dimensions even.** H.264 cannot encode odd dimensions without a scale
  filter.
* **Scenes in timeline order.** A paint window is derived from a scene's
  neighbours, so order is load-bearing.
* **Scenes must not overrun `duration`.** The overflow is silently cut off.
* **Scene ids unique.**

## 14.6 Enumerated vocabularies

`EASES` lists every ease the engine resolves. The schema rejects unknown names
rather than accepting them, because the engine degrades an unknown ease to
`outQuint` silently — so a typo would produce motion that looks *almost* right,
which is the hardest class of bug to see.

Also enumerated: `SCENE_TYPES`, `TRANSITIONS` (`cut`, `dissolve`, `match`,
`whip`), `ELEMENT_TYPES`, `PRESETS` (`apple`, `light`, `midnight`, `warm`,
`mono`), `ASPECTS` (`16:9`, `1:1`, `9:16`, `4:5`), and the sound cue names.

`ASPECT_DIMENSIONS` is the single source of canonical pixel dimensions per
aspect.

## 14.7 Derived values

```typescript
frameCount(sb)   // from duration and fps — derived, never counted
sceneEnd(scene)  // start + duration; distinct from the paint window
```

A scene's declared range and its **paint window** are different things. Ranges
deliberately overlap so motion carries across a cut; the engine narrows the
paint window to the moment the next non-overlay scene starts, so an overlap
never double-paints.

---

# 15. VIDEO SCENES

Scene types, as implemented in `src/compiler/scenes.ts`. Each owns its markup
and its timeline records.

```text
hero
dashboard
feature
scroll
zoom
device
text
logo
cta
transition
capture
```

Each scene carries:

* `id`, `beat`, `type`, `mode`
* `start`, `duration`, `hold`
* `route` — where on the analyzed project its content came from
* `transition` — `kind` and `fade`
* `camera` — at most one move
* `copy` — eyebrow, headline, body, cta, bodySize
* `elements` — harvested UI, each with `importance` and optional `attribution`
* `animations` — target, at, dur, ease, stagger, and property tuples
* `cursor` — gestures with travel, click and response latency
* `cues` — sound, by name and time
* `notes`

Two constraints on this shape are worth stating because violating them produces
plausible-looking output that is wrong:

**`fade` defaults to 0, and a hard cut is the default transition.** A scene at
opacity below 1 becomes a backdrop root, so a dissolve silently flattens its own
glass. The material disappears and nothing errors.

**`hold` is a feature, not padding.** A cut landing the instant motion stops
feels clipped. 600-900ms of stillness after a payoff is what lets it land.

## 15.1 Cursor gestures

A cursor gesture is travel on an arc, settle, press, release — and then the UI
responds one beat later. `travel` defaults to 620ms (200-1400); `latency` defaults to
110ms and is floored at 60, because instant response reads as fake. Real software has
latency, and a viewer knows what software feels like.

This is what turns a mockup into a demonstration.

## 15.2 Times are scene-relative

Every `at` in a storyboard — animation, camera, cursor — is **relative to its scene**,
and the scene helper adds `start`. Sound cues are the one exception: `tl.cue()` takes
absolute film time, so the compiler emits `scene.start + cue.at`.

Scene-relative is what makes §34 cheap. Moving a scene changes one number in the
`SCENES` table, and everything inside it follows; absolute times would mean rewriting
every record in the scene.

## 15.3 Details the compiler adds

The scene renderers carry small correctness rules the storyboard does not have to
express:

* **`.tnum` on anything that counts.** Without tabular figures, digit widths differ
  between glyphs and the whole line wobbles as a counter runs up — visible, and
  bafflingly hard to attribute if you have not seen it before.
* **Rows are grouped**, so a stagger applies to siblings in one container rather than
  to elements scattered across the scene.
* **A scene with no animations gets default motion** rather than appearing statically:
  glass cards land with `softLand` on y and scale, and copy enters ~600ms after the
  visual it names (§45).

---

# 16. DEPTH AND PERSPECTIVE

The film needs perspective, camera movement and depth. It does **not** need a 3D
scene graph to get them, and reaching for one first was the original draft's
mistake.

## 16.1 CSS transforms are the default

Camera push, dolly, pan, device tilt, parallax layers, floating UI, glass, and
depth of field are all CSS: `transform`, `perspective`, `filter`,
`backdrop-filter`, and layered elements at different translate rates. This is
what the built system does.

It is not a compromise. A CSS transform composites on the GPU, is a pure
function of the transform value, and rasterises identically on every seek.
Supported this way:

* perspective and camera dolly / push / pan
* zoom (capped at 2.5x — past that, text rasterises soft)
* rotation and device tilt
* depth, parallax, floating UI
* glass material, shadows, rim highlights
* depth of field via `filter: blur()` on background layers
* smooth interpolation, from the engine's ease library

## 16.2 When real 3D is warranted

Three.js is available for scenes that genuinely need geometry — an orbiting
product model, a mesh that cannot be faked with layers. It is opt-in per scene
and comes with conditions, because a WebGL scene is the easiest way to break
determinism:

* the scene is driven from `t`, never from a clock or `requestAnimationFrame`
  delta
* camera paths are **closed-form** — position is a function of `t`, not an
  accumulated step
* all randomness is seeded
* readback is explicit, so a frame is not captured before the canvas has drawn

See `Skills/threejs-in-video.md`. Its own guidance is that a CSS perspective
transform is usually the better answer, and the skill exists mostly to say when
it is not.

**Camera orbit around a captured website plane is not supported.** A captured
frame is a flat image; orbiting it reveals that immediately. Orbit needs a
rebuilt scene with real layers.

## 16.3 Restraint

One camera move per beat. If two things need attention at once, that is two
scenes. The goal is premium visual quality, not visual noise — and effect
density is the most reliable tell of a template.

---

# 17. REAL WEBSITE CONTENT

Urlume must show the user's actual product, not a generic approximation. There
are two ways to do that, and the distinction matters.

## 17.1 Rebuild (default)

Analyze the real page, harvest its real content — copy, labels, metric values,
table rows, brand colours, typeface, radius — and rebuild the interface out of
animatable glass components at reduced density.

The result is the user's product, because every string and every colour came
from it. And unlike a screenshot it can be pushed into past 2x, respond to a
cursor, animate a row arriving, and light a button on press.

```text
Chromium
   │
   ▼  real site
Page analysis  ──→  ranked elements + real copy
Brand extraction ─→  accent, scheme, typeface, radius
   │
   ▼
Storyboard (AI)
   │
   ▼  deterministic
Compiler  ──→  glass components carrying the real content
   │
   ▼
Film (HTML/CSS/JS)
```

## 17.2 Capture (fallback)

Composite real captured frames. Pixel-exact, and the right answer for a page too
custom to rebuild faithfully — an unusual data visualisation, a canvas-based
editor, a heavily illustrated marketing page.

Its limits are real: flat, soft past ~1.5x push-in, no cursor response. So it is
the fallback, chosen per scene, not the default.

## 17.3 Density reduction

A rebuilt UI is not a copy of the real one. A real dashboard has forty
interactive affordances; at 1920px on a screen a viewer looks at for four
seconds, most of them are noise that makes the frame read as a wireframe. Keep
the elements the beat needs and drop the rest. See
`Skills/ui-mockup-rebuild.md`.

---

# 18. MOTION SYSTEM

## 18.1 One law above all others

**Every visual is a pure function of time.** `seek(ms)` is idempotent: seeking
forward, backward, or cold to the same `t` produces byte-identical output.

This single property is what makes everything else work. Export is not a
recording but a loop of `seek(frame)` + screenshot. Nothing accumulates, so
nothing drifts. Frame ranges are independent, so parallel rendering is trivial.
A render is reproducible.

## 18.2 The consequence you must respect

**Never put a CSS `transition` or `@keyframes` on anything the timeline
animates.**

Under frame-by-frame export the browser clock does not advance, so those
properties freeze at their initial value while everything around them moves.
Perfect in preview, broken in the export, and **no error anywhere**. This is the
single most expensive mistake available in this codebase, which is why it is a
Tier 0 law, a policy injection, and a documented hazard.

Ambient motion goes in `tl.loop(fn)`, which receives `t`.

## 18.3 Animatable properties

`opacity`, `x`, `y`, `scale`, `rotate`, `blur` — each declared as a
`[from, to]` tuple, so a record is self-contained and reversible.

Plus `stagger` (60-120ms between siblings) and `staggerFrom`
(`start` | `end` | `center` | `edges` | `random`).

`random` is never correct on text: it destroys reading direction. Enforced by
the `no-random-stagger-on-text` craft rule.

## 18.4 Easing

The engine's named ease library, enumerated in the schema:

```text
outExpo  outQuint  outQuart  outCubic  outCirc  outBack
inExpo  inCubic  inQuart
inOutCubic  inOutQuart  inOutQuint  inOutCirc
softLand  standard  uiOut  uiInOut
spring  springSoft  springSnappy
linear
```

`linear` exists because a colour crossfade or an opacity-only wash wants it. On
anything that moves it is the cheapest tell there is, and the
`no-linear-on-motion` craft rule rejects it.

A camera has mass: `inOutCubic` accelerates and decelerates. `outExpo` is right
for a UI element snapping in and wrong for a frame move.

## 18.5 The two clocks

Film time runs **1.5-2.5x slower** than the same move in a shipping app. Across
a 1920px frame the viewer's gaze needs 200-300ms just to arrive, so a 250ms
entrance registers as a flicker rather than a movement.

The exception: **product UI inside the frame** responds on the UI clock
(90-240ms), because the viewer knows what software feels like. A button that
takes 600ms to depress reads as broken.

Both clocks are enforced by the `film-clock` craft rule.

---

# 19. VIDEO RENDERING

## 19.1 Stack decision

The original draft specified **Remotion**. The built system does not use it, and
the reason is the determinism guarantee in §18.1.

Remotion is a good tool that owns the composition layer: React components, its
own frame model, its own renderer. The animation engine Urlume vendors already
owns that layer, and its `seek(t)` contract is the foundation the craft rules,
the compiler and the export loop are all built on. Running both would mean two
frame models and two sources of truth about what time it is.

The output is also a self-contained HTML file that plays in any browser with a
scrub bar. That makes preview free — the same artefact previews and exports —
and it means a film outlives Urlume: a user can open it, edit it, and host it
without the tool that made it.

The trade accepted: no Remotion ecosystem, and the compiler is code Urlume
maintains rather than a dependency.

**FFmpeg is unchanged** from the original spec, via `ffmpeg-static` so no system
install is needed.

## 19.2 Pipeline

```text
Storyboard JSON  (validated; the AI's only output)
    ↓  deterministic — no AI runs below this line
Compiler         (src/compiler)
    ↓
Film: index.html + timeline.js + assets/
    ↓
Chromium via Playwright, ?render=1
    ↓  seek(frame) + CDP screenshot, per frame
PNG sequence  +  procedural WAV
    ↓
FFmpeg
    ↓
MP4
```

## 19.3 The compiler

`src/compiler/index.ts`. Emits three things:

```text
index.html     structure only — no animation, no inline motion styles
timeline.js    all timing, and nowhere else
assets/        a copy of runtime/
```

Two structural rules, both of which fail silently when broken:

**Script order is fixed:** `assets/sfx.js` → `assets/timeline.js` (the engine) →
`timeline.js` (the film). The engine checks for `window.SFX` at mount. Wrong
order means nothing animates.

**The cursor and click ring are the last children of `.camera`, outside every
scene.** Inside a scene, the cut takes the cursor with it. One pair for the whole
film.

The glass filter defs are inlined into the document, because
`backdrop-filter: url(#lens)` only resolves against a filter in the same tree —
never an external file, never an `<img>`. If the SVG is missing, the `@supports`
guard drops to the blur stack, which still reads as glass. Not fatal.

Scene times are written in exactly one place, a `SCENES` table at the top of
`timeline.js`, so moving a scene is editing one number rather than hunting
offsets. Each scene also gets its own helper variable (`s_<id>`) rather than a reused
`var s` — legal either way, but a reused name makes the generated file impossible to
reorder safely and hard to read when debugging.

## 19.3a Camera arithmetic is why the model never writes numbers

The engine writes `translate3d(...) scale(...)`, and CSS applies the **rightmost**
function first. So the target point is scaled about the stage centre *before* it is
translated, which means the translation has to be multiplied by the scale.

Omit the multiply and a push to 2.4× leaves the target roughly **950px off centre**
on a 1920x1080 stage — a framing that is obviously wrong on screen but whose cause is
invisible in the numbers. This is the concrete reason §53 forbids the model from
emitting coordinates: `camera.target` names an element, and the compiler does the
arithmetic once, correctly.

Where a camera names a target, the engine resolves it to a stage coordinate at mount,
so the framing stays correct when the layout moves.

## 19.4 The render harness

`src/renderer/index.ts`.

```text
file://film/index.html?render=1
  → poll window.__EXPLAINER__.ready   (gated on document.fonts.ready)
  → resize viewport to the film's native size
  → verify fonts, apply hazard guards, strip chrome
  → for f in [from, to): seekFrame(f), Page.captureScreenshot → PNG
  → renderAudio() → base64 WAV → disk
  → ffmpeg → MP4
```

Details that are load-bearing:

* **Native-size viewport.** Rasterise at the film's own dimensions rather than
  upscaling a smaller frame.
* **`reducedMotion: 'no-preference'` is set explicitly.** Headless Chromium can
  report `reduce`, and the film's CSS neutralises `.camera` when it does — every
  push-in would vanish from the export, silently.
* **Chrome is stripped structurally,** by removing everything outside `.stage`
  rather than by hiding a `.preview-ui` class. A film that built its own control
  bar without that class would otherwise export it. The `.stage` ancestor chain
  and the inline SVG filter defs are preserved.
* **A raw CDP session** for screenshots, skipping a layer of Playwright
  plumbing that would otherwise run once per frame.
* **Frame ranges are independent** (`from`/`to`), which is what makes parallel
  and resumed rendering possible.
* **Console errors are collected** and surfaced as a warning, since a film can
  throw and still produce frames.

## 19.5 Determinism guards

`src/renderer/hazards.ts`. The engine guarantees its own output is a function of
`t`; it cannot guarantee that about the page around it.

| Hazard | Guard |
|---|---|
| Fonts loaded-by-failing | `document.fonts.check()`, not just `fonts.ready` |
| Lazy images decoding mid-render | force eager + sync, await decode |
| `<video>`/`<audio>` on their own clock | pause, reset to 0 |
| CSS animations at load-dependent offsets | negative delay pins to frame 1 |
| Caret blink, text selection | transparent |

The font case is subtle and worth stating: `document.fonts.ready` resolves when
loading *finishes* — including when it finishes by failing. On a machine with no
network a Google Fonts link falls back silently, every glyph metric shifts, line
breaks change, and the composition is different. `fonts.check()` asks the
question that matters: is this face usable right now.

**Knowingly unguarded**, listed in `UNGUARDED` so nobody assumes coverage that
is not there:

* animated GIF/WebP frames — no API exists to seek one; replace with a still
* `Math.random()` in film code — the engine seeds its own randomness
* runtime network fetches
* GPU vs software rasterisation of `backdrop-filter`

## 19.6 Encoding

`src/renderer/encode.ts`.

`-framerate` goes **before** `-i`, which sets the rate the input is interpreted
at. The same flag after `-i` resamples instead, silently dropping or duplicating
frames to hit the target — which is how a 30fps render becomes 30fps of stutter.

CRF is tuned for screen content, which is flat colour and hard type rather than
film grain and compresses far better at the same CRF:

| Quality | CRF | x264 preset |
|---|---|---|
| `draft` | 26 | veryfast |
| `high` | 18 | slow |
| `master` | 14 | veryslow |

18 is visually lossless for UI. 23 is noticeably soft on 1px rim highlights,
which is exactly where the glass material lives.

The rest of the flag set, each present for a specific failure it prevents:

| Flag | Why |
|---|---|
| `-tune stillimage` | weights the encoder toward sharp edges over temporal smoothness — correct for flat regions and hard type |
| `-pix_fmt yuv420p` | the only chroma format with universal decoder support. Safari and QuickTime refuse `yuv444p` outright, and the file appears to play with **no video** |
| `-vf scale=trunc(iw/2)*2:…` | a safety net for odd dimensions, which would otherwise fail at the very end of a long render |
| `-c:a aac -b:a 192k` | when audio is present |
| `-shortest` | the procedural soundtrack carries a ~1.2s tail past the last cue; without this the video is padded to match it |
| `-movflags +faststart` | moves the moov atom to the front. Without it a browser downloads the whole file before playing — the "hosted video that spins forever" bug |

Two of those are worth singling out because they fail in ways that look like
something else entirely. `yuv444p` produces a file that opens, shows controls, and
plays silence over a blank frame — which reads as a corrupt render rather than a
chroma-format problem. And a missing `+faststart` produces a video that works
perfectly from disk and hangs when hosted, so it survives every local test.

ffmpeg writes progress to stderr, so only the tail is kept — a long render produces
megabytes of it, and the useful part of a failure is at the end.

## 19.7 `runtime/` is generated

The animation engine — `timeline.js`, `explainer.css`, `components.css`,
`sfx.js`, `glass-filters.svg` and the starter film — ships as verbatim source
blocks inside `Skills/saas-explaner-motion.md`. It is extracted, never retyped:

```bash
npm run extract         # skill -> runtime/
npm run extract:check   # CI: fail if runtime/ has drifted from the skill
```

Editing `runtime/` directly is a mistake; the next extract overwrites it. Change
the skill.

---

# 20. OUTPUT FORMATS

`ASPECTS` and `ASPECT_DIMENSIONS` in the schema are the single source of truth:

| Aspect | Pixels | Use |
|---|---|---|
| `16:9` | 1920x1080 | landscape — the default |
| `1:1` | 1080x1080 | square |
| `9:16` | 1080x1920 | vertical |
| `4:5` | 1080x1350 | feed |

FPS: `24`, `30` (default), `60`.

Defaults: **1920x1080, 30fps, `apple` preset.**

Resolution must match the aspect or the schema rejects the storyboard (§14.5).
4K is deferred: at 4x the pixels, per-frame screenshot throughput is the binding
constraint and it has not been measured (§60).

## 20.1 A vertical cut is a re-composition, not a crop

Cropping 1920x1080 to 1080x1920 throws away 69% of the frame, and it throws away
the part the composition was built around. A camera move calibrated for a wide
frame is wrong in a tall one; type sized for 1920 is small at 1080 wide; a
side-by-side layout has nowhere to go.

So a vertical version is generated from the **storyboard**, not from the MP4:
re-laid-out scenes, re-scaled type, re-shot camera moves, platform safe areas
respected. Same content and same beats, different composition.

See `Skills/vertical-social-reformat.md`. The practical consequence is that aspect
should be decided before scenes are laid out, not after.

---

# 21. VIDEO PRESETS

Presets as implemented (`PRESETS` in the schema, applied as
`body[data-preset]`):

```text
apple      dark, deep glass, restrained — the default
light      light ground, low-contrast glass
midnight   near-black, high-saturation accent
warm       warm neutral ground
mono       monochrome, accent used only for state
```

A preset is a **colour and material decision**: ground, glass tint, rim
highlight, shadow depth, type scale. It does not encode pacing or camera
behaviour — those come from the beat sheet and the craft rules, so a film keeps
its structure when the preset changes.

The brand accent overrides the preset's accent through a single inline
`--accent` custom property on `<body>`, so the preset stays intact and one
declaration restyles the film.

The original draft listed ten presets by mood (`cinematic`, `futuristic`,
`product-launch`, `startup`, …). Those collapsed into five, because most of what
distinguished them — pacing, camera restraint, effect density — turned out to
belong in the craft rules rather than in a style token. Two presets that differ
only in how fast they move are not two presets; they are one preset and a
mistake in the beat sheet.

Presets are original visual styles. Do not copy copyrighted branding or reproduce
another company's exact design.

---

# 22. USER COMMAND EXAMPLES

The following should work naturally.

```text
Create a video for this project.
```

```text
Create a 30 second SaaS demo.
```

```text
Show only the dashboard.
```

```text
Focus on the AI generator.
```

```text
Make it cinematic.
```

```text
Push into the dashboard instead of cutting to it.
```

```text
Make a vertical version for TikTok.
```

```text
Make the camera movements slower.
```

```text
Remove the analytics scene.
```

```text
Make the intro shorter.
```

```text
Use the dark premium style.
```

The agent should interpret natural language rather than requiring complicated CLI flags.

---

# 23. CLI COMMANDS

```bash
urlume                    interactive agent (the primary experience)
urlume init               initialize .urlume/ configuration

urlume analyze            detect, start server, analyze routes; print + cache
urlume storyboard         generate and validate a storyboard
urlume check              run the craft rules against the saved storyboard
urlume compile            storyboard -> film, no capture
urlume preview            compile and open in a browser
urlume render             render to MP4
urlume create             the whole pipeline: analyze -> storyboard -> render

urlume models             list models reachable with the configured keys
urlume providers          list configured providers and where each key came from
urlume config             configuration
urlume skills             list the skill library; read a section
```

## 23.1 Every stage is independently runnable

This is a deliberate design property, not a convenience. Each subcommand consumes
what the previous one wrote to `.urlume/` and writes its own output there, so any
stage can be run, inspected and re-run alone.

That is what made the build order in §46 possible: `urlume render` on a
hand-written storyboard exercised the entire rendering pipeline before any AI code
existed. It is also how a failure is diagnosed — a bad film is either a bad
storyboard (`urlume check`) or a bad compile (`urlume preview`), and the two are
distinguishable without rendering 900 frames.

## 23.2 Useful flags

```bash
urlume render --from 120 --to 240      one beat, not the whole film (§33.1)
urlume render --quality draft          CRF 26, veryfast — for iteration
urlume render --no-audio               silent MP4
urlume render --headed                 watch the browser; for debugging
urlume render --keep-frames            keep the PNG sequence to inspect a bad frame
urlume storyboard --aspect 9:16        re-compose vertical (§20.1)
urlume --url https://example.com       remote mode (§43)
```

---

# 24. PROJECT FILE STRUCTURE

Urlume writes into the analyzed project under `.urlume/`:

```text
.urlume/
├── config.json          provider, model, video defaults, preset
├── project.json         cached detection result
├── storyboard/
│   └── main.json        the validated storyboard — the durable artefact
├── film/                compiled film: index.html, timeline.js, assets/
├── captures/            per-route screenshots + analysis, cached
├── renders/             MP4 output
└── logs/
```

`film/` replaces the draft's `scenes/` and `previews/`. There is no separate
preview artefact: the compiled film **is** the preview. It opens in a browser
with a scrub bar and exports frame by frame from the same file, so preview and
export cannot disagree about what the video looks like.

`storyboard/main.json` is the one file worth version-controlling. It is the whole
creative decision, it is small, it diffs readably, and a film can be rebuilt from
it byte-identically. `film/`, `captures/` and `renders/` are all derived and
disposable.

Suggested `.gitignore`:

```text
.urlume/*
!.urlume/storyboard/
```

**No secrets in this directory, ever.** API keys live in the environment or in
`~/.urlume/credentials.json` (§7), never in the project tree.

---

# 25. TUI TECHNOLOGY

**TypeScript + Ink.** React is a dependency only because Ink requires it, and
nothing outside `src/tui/` imports it.

The UI supports:

* streaming responses
* markdown-like formatting
* keyboard navigation
* command autocomplete and a slash command menu
* spinners and progress bars
* interactive selection
* confirmation dialogs (§30)
* errors with hints (§32)
* render progress

Avoid a crude readline interface. The experience should feel polished.

## 25.1 Render progress

The renderer emits typed events rather than writing to stdout, so the TUI owns
presentation and the renderer stays usable from a script:

```typescript
type RenderEvent =
  | { type: 'launch' }
  | { type: 'ready'; film: ExplainerHandle }
  | { type: 'frame'; frame: number; total: number; scene?: string }
  | { type: 'audio'; bytes: number }
  | { type: 'encode'; stage: string }
  | { type: 'done'; output: string; frames: number; ms: number }
  | { type: 'warn'; message: string };
```

A `frame` event fires 900 times for a 30-second film, so the TUI throttles
repainting rather than rendering every one. Ink re-rendering at 30Hz for the
duration of a render would cost more than the capture.

```text
Rendering  ████████████████████░░░░░░░░  612/900   68%   ~40s left

  ✓ hook        126 frames
  ✓ stakes      102
  ✓ reveal       84
  ▸ how         300  ███████████░░░░░  204/300
    payoff      132
    proof       120
    end          96

⚠ "Söhne" is declared but not loaded — the export will use a fallback.
```

Warnings are shown as they arrive and do not stop the render (§32.4).

## 25.2 Cancellation

An `AbortSignal` threads through the render loop, checked per frame. Ctrl-C stops
capture at the current frame, closes the browser, and removes the frame directory —
`browser.close()` is in a `finally`, so an orphaned Chromium is not left behind on
any exit path.

---

# 26. CLI STACK

The stack as built:

```text
Language:          TypeScript, strict
Runtime:           Node.js >= 20.11
CLI:               Commander
TUI:               Ink
AI:                provider abstraction over OpenAI, Anthropic, Gemini,
                   Mistral, OpenAI-compatible
Browser:           Playwright + Chromium
                   (playwright-core as a dependency; playwright as a
                    devDependency, since only dev needs the browser download)
Compiler:          Urlume's own — storyboard JSON -> HTML/CSS/JS
Animation engine:  vendored, extracted from the core skill into runtime/
Encoding:          FFmpeg via ffmpeg-static
Depth / 3D:        CSS transforms; Three.js opt-in per scene (§16)
Validation:        Zod
Package manager:   npm
Testing:           Vitest (unit | browser | render) + a mutation harness
Build:             tsc
Documentation:     Markdown
```

Changed from the original draft:

* **Remotion removed.** See §19.1.
* **React Three Fiber removed.** R3F exists to drive Three.js from React state.
  The film is not a React app, so it would add a renderer and a reconciler to
  reach an API that `seek(t)` already addresses directly.
* **Zustand removed.** The TUI's state is one session object. Ink's own hooks
  cover it, and a store would be indirection with nothing on the other side.
* **npm rather than pnpm.** Single package, no workspace to justify it.
* **React remains a dependency** — Ink requires it. Nothing outside `src/tui/`
  imports it.

Choose the simplest production-ready solution where alternatives exist. Removing
a dependency is a feature.

---

# 27. REPOSITORY ARCHITECTURE

A single package with directory boundaries, not a monorepo. A workspace buys
independent versioning and independent publishing; nothing here is published
independently, so it would cost a build graph and buy nothing.

As built:

```text
urlume/
├── src/
│   ├── cli.ts              commander entry
│   ├── tui/                Ink interface
│   ├── agent/              loop, tool registry, prompt assembly
│   ├── providers/          AIProvider adapters + credential store
│   ├── project/            framework detection, dev-server supervisor
│   ├── browser/            Playwright session, page analysis, brand extraction
│   ├── storyboard/         Zod schema, generation, craft rules, editing
│   ├── compiler/           storyboard JSON -> film
│   ├── renderer/           capture -> ffmpeg -> MP4
│   ├── skills/             loader, index, policy, retrieval
│   └── shared/             types, logging, errors
├── runtime/                the vendored animation engine (generated — §19.7)
├── Skills/                 the craft library
├── scripts/
│   └── extract-runtime.mjs
├── tests/                  unit | browser | render + mutation harness
├── examples/
└── docs/
```

Directories mirror the package boundaries a monorepo would have, and
cross-directory imports go **only through each directory's `index.ts`**. That
constraint is what keeps the option open: splitting into `packages/*` later is
mechanical rather than an import rewrite.

The dependency direction is one-way. `shared` depends on nothing. `storyboard`
depends on `shared`. `compiler` depends on `storyboard`. `renderer` depends on
neither the agent nor any provider. Nothing outside `providers/` imports a vendor
SDK; nothing outside `tui/` imports React.

---

# 28. AGENT TOOL SYSTEM

`src/agent/tools.ts`. Each tool has a name, description, Zod input schema, a
**permission class**, and a `run` that returns a result rather than throwing.

## 28.1 The registry

```text
detect_framework      framework, package manager, dev command, routes
list_files            project tree, filtered
read_file             one file, bounded
start_dev_server      launch and wait for the port          [exec]
analyze_page          navigate, rank elements, extract brand, screenshot
read_skill            Tier 2 retrieval — one section of one skill
validate_storyboard   Zod + craft rules; returns violations as text
render_video          compile + capture + encode
```

Smaller than the draft's list, and deliberately. The draft enumerated browser
primitives — `click`, `hover`, `scroll`, `getBoundingBox`, `getComputedStyle`,
`captureElement` — as separate tools. In practice `analyze_page` does one
navigation and returns everything a director needs from that route in a single
result: ranked elements with bounds and types, real copy, the brand system, and
a screenshot.

Exposing the primitives instead would mean the model driving a browser one call
at a time, spending turns and context to reassemble a picture the analyzer can
produce in one pass. Worse, it would put layout decisions in a place where they
cannot be validated — the tools that matter are the ones whose output the schema
and the craft rules can check.

## 28.2 Permission classes

```text
read     inspect the project or the page       never prompted
write    write inside `.urlume/`               never prompted — our own directory
exec     run a project command                ALWAYS prompted
network  reach a provider or a URL             prompted once per session
```

The class is declared **on the tool**, not decided at the call site, so a new
tool cannot quietly acquire dangerous reach. `start_dev_server` is the only
`exec` tool, and it always asks.

Reach is bounded inside the read tools as well, since `read` never prompting only
makes sense if `read` cannot go anywhere interesting:

* **path traversal is refused.** `list_files` and `read_file` resolve the target and
  reject anything whose relative path escapes the project root — a model asking for
  `../../.ssh` is refused rather than served.
* **depth and volume are capped** — depth 1-3, at most 300 entries. A monorepo would
  otherwise fill the context window with a directory listing.
* **`node_modules`, `.git`, `.next`, `dist`, `build`, `.urlume` and dotfiles are
  skipped**, which removes almost all of the accidental-secret surface (`.env`
  included) as a side effect of removing the noise.

## 28.3 Tools return errors, they do not throw

A tool that throws kills the agent loop. A tool that returns
`{ ok: false, content: "..." }` lets the model read what went wrong and try
something else, which is almost always what should happen — a missing route or a
dev server on an unexpected port is a recoverable situation, not a crash.

`content` is rendered back to the model and must stay short: it is context.
`data` carries the structured payload for the orchestrator, which the model never
sees.

`callTool()` is the single entry point and it converts **every** failure into a
`ToolResult`: an unknown tool name (listing the available ones), arguments that fail
their Zod schema (naming the fields), a declined permission, and any exception the
tool itself throws. The loop never sees an exception from here.

Permission is checked in `callTool`, after argument validation and before `run` — so
the approval prompt shows the parsed arguments, and a tool cannot skip the check by
forgetting to ask.

## 28.4 The registry is the funnel's entry point

`validate_storyboard` is where §58 meets the agent loop. It parses with Zod, runs
`repairCraft`, and then either returns `ok: true` listing what it auto-repaired, or
`ok: false` carrying `formatForModel(remaining)` — the rule text for what the model
must fix itself.

So the craft rules reach the model as a **tool result**, not as a prompt instruction.
That is the difference between telling a model the rules and holding it to them: a
failed validation is an observation it has to respond to, in the same channel as any
other tool failure.

`render_video` declares up front that it is slow — roughly a second per frame — and
refuses to run before validation has passed. A model that renders first and validates
second would burn fifteen minutes to produce a film with two calls to action.

---

# 29. AGENT LOOP

```text
User request
     ↓
Intent  ──────────────── duration, aspect, focus, style, tone
     ↓
Project analysis ─────── detect → dev server → routes        [cached]
     ↓
Page analysis ────────── rank elements, extract brand         [cached]
     ↓
Storyboard generation ── laws + index + stage policy injected
     ↓
┌─→ Zod validation
│        ↓
│    Craft rules ──────── repair what is mechanical
│        ↓
└─── re-ask ←──────────── content violations only, with rule text
     ↓ (clean)
Compile ──────────────── deterministic; no AI below this line
     ↓
Preview ──────────────── the film itself, in a browser
     ↓
User approval
     ↓
Render ───────────────── seek + screenshot + ffmpeg
```

## 29.1 The validation loop is the load-bearing part

A model that has read "cut, do not crossfade" will still crossfade, because
nothing stopped it. So the loop does not trust the model's output; it checks it
(§58) and either repairs it or sends it back with the specific rule text.

The re-ask is bounded. After a small number of attempts on the same violation
Urlume reports the violation to the user rather than looping — an infinite retry
burns tokens and a user would rather see "this film has two calls to action" than
watch a spinner.

## 29.2 Everything below the compiler is deterministic

No AI runs after validation passes. That line is what makes a render
reproducible: the same storyboard always produces the same MP4, so a re-render is
a build, not a new generation.

## 29.3 Caching

Project detection and per-route analysis are cached in `.urlume/`. Re-running
`urlume` on an unchanged project should not re-navigate every route, and
conversationally editing a storyboard should not re-analyze anything at all —
editing operates on the structured document (§34).

## 29.4 Safety

The agent must not blindly execute commands. `exec` tools always prompt (§28.2),
and the agent never deletes project files, installs software, or writes outside
`.urlume/`.

---

# 30. SAFETY / PERMISSIONS

Browser and shell actions should have clear permission boundaries.

For example:

```text
Urlume wants to run:

pnpm dev

Allow? [Y/n]
```

Potentially dangerous shell operations require confirmation. Permission classes
are declared on the tool, not at the call site (§28.2), so a new tool cannot
quietly acquire reach.

Urlume never:

* deletes or modifies project files — it writes only inside `.urlume/`
* installs software
* runs a shell command that was not detected from the project's own
  `package.json`
* exposes secrets (§7.4)

## 30.1 What is sent to a provider

The minimum needed to direct a film:

```text
sent          route paths, ranked element types with bounds and short text,
              brand tokens, page titles, and — only for a vision re-rank —
              screenshots

not sent      source files, .env contents, dependency manifests, git history,
              full page HTML, or anything from a file the user did not
              have analyzed
```

`read_file` exists as a tool and its output does reach the model, so it is bounded
and the agent uses it for configuration and route files rather than sweeping the
project. **Source code is not the input to this product** — a rendered page is —
which is what keeps the exposure small by design rather than by policy.

Screenshots are the largest thing that leaves the machine, and they go only when a
vision re-rank is enabled.

## 30.2 Remote and asset handling

Remote URL mode requires explicit configuration (§42, §43). Project assets — logos,
images, fonts — are read locally and never uploaded.

---

# 31. PERFORMANCE

The dominant cost is **frame capture**: one `seek` + one screenshot per frame, 900
frames for a 30-second film at 30fps. Everything else — detection, analysis, one or
two model calls, compilation, encoding — is small next to it.

Requirements:

* cache project detection and per-route analysis in `.urlume/`
* cache screenshots
* never re-analyze an unchanged project
* stream AI responses
* analyze independent routes in parallel
* one browser session for all routes, not one per route
* support partial and incremental rendering

## 31.1 Frame ranges make this tractable

Because every frame is an independent function of `t` (§18.1), capture
parallelises and resumes trivially:

* **iterate on one beat** — `--from`/`--to` renders 120 frames instead of 900
* **draft quality** — CRF 26 / veryfast for structure review, `master` for delivery
* **resume** — a crashed render restarts at the frame it reached
* **parallel workers** — disjoint ranges into one PNG directory, then one encode.
  `-start_number` exists in the encoder for exactly this

Parallel capture is not implemented yet. The property that permits it is, which is
the part that had to be designed in rather than added later.

## 31.2 Unmeasured

Per-frame throughput has not been measured (§60), so render time for a 900-frame
film is unknown. It is the first thing to measure after the first successful
render, because it determines whether parallel capture is a priority or a
nice-to-have, and whether 4K (§20) is viable at all.

Large projects should remain usable: the 60-element cap per route (§12.1) bounds
prompt size regardless of application size.

---

# 32. ERROR HANDLING

Every error carries **what happened, why it probably happened, and what to do**.
A status code alone sends someone to a search engine.

Bad:

```text
Error: ENOENT
```

Better:

```text
Urlume couldn't start the development server.

Detected command:
pnpm dev

The process exited with code 1.

Run:

pnpm dev

to inspect the project error.

[Retry]
```

## 32.1 Error classes

Each subsystem owns one, and each carries hints rather than just a message:
`ProviderError`, `DevServerError`, `RenderError`, `EncodeError`.

## 32.2 Provider errors

`explainStatus()` maps HTTP status to something actionable:

| Status | Reading | Hint |
|---|---|---|
| 401 / 403 | key rejected | check with `urlume providers`; replace with `urlume config --provider X` |
| 404 | model not found | may be misspelled or unavailable to this account; `urlume models` |
| 429 | rate limited or out of quota | Urlume retries with backoff; a persistent 429 usually means quota |
| 400 | malformed | usually context too long — fewer routes, or a larger-context model |
| 5xx | provider-side | Urlume retries automatically |

`withRetry()` retries **only transient failures** — 429 and 5xx, with exponential
backoff and jitter. A 401 will never succeed on a second attempt, and retrying it
just delays a clear error by several seconds. Jitter stops parallel scene
generations from retrying in lockstep.

`stopReason: 'length'` is distinguished from a refusal, because a truncated JSON
document is a `maxTokens` problem with a specific fix, not a model declining.

## 32.3 Render errors explain the mechanism

The renderer's failures are the ones a user cannot diagnose from the symptom, so
each one names the cause:

**`__EXPLAINER__` never published** → the most likely cause is script order, so the
error prints the required order (`sfx.js` → engine → film) and suggests re-running
with `--headed` to see the console.

**`ready` never became true** → it is gated on `document.fonts.ready`, and a webfont
that never resolves hangs it. The fix — self-host the woff2 next to the film — is in
the message.

**Empty frame range** → reports the film's actual frame count and fps, so the
correct `--from`/`--to` is obvious.

**No ffmpeg binary** → `ffmpeg-static` resolved to null, which means the postinstall
download was skipped or blocked. `npm rebuild ffmpeg-static`.

## 32.4 Warnings do not stop a render

A font that will fall back, a `version` mismatch between film and renderer, console
errors during capture — all reported as warnings and the render proceeds. A film
that throws can still produce usable frames, and stopping would waste them.

## 32.5 Never expose keys

`redactSecrets()` (§7.4) runs over every error before display or write.

---

# 33. PREVIEW SYSTEM

**Preview is not a separate render.** The compiled film is a self-contained HTML
file that plays in a browser with a scrub bar; `?render=1` is the only thing that
distinguishes an export from a preview. So there is no preview pipeline to keep in
sync with the real one, and no class of bug where a film previews correctly and
exports wrong.

```bash
urlume preview
```

compiles the storyboard and opens `file://.urlume/film/index.html`. Scrub, replay,
seek to any frame — the engine's `seek(ms)` is the same function the exporter
calls.

```text
✓ Storyboard validated
✓ Film compiled       .urlume/film/index.html

  30.0s · 900 frames · 1920x1080 · 30fps

Open in browser? [Y/n]
```

`controls: false` is passed at compile time to suppress the scrub bar for a
deliverable; the renderer suppresses it via `?render=1` regardless, so the flag
only affects browser preview.

## 33.1 Rendering a range

Because frame ranges are independent (§18.1), a single scene can be rendered
without the rest of the film:

```bash
urlume render --from 120 --to 240
```

Useful for iterating on one beat without paying for 900 frames, and the mechanism
that makes parallel rendering possible later.

---

# 34. STORYBOARD EDITING

The user modifies the storyboard conversationally:

```text
Remove scene 3.
Make scene 2 slower.
Zoom into the pricing cards.
Change the intro to 3 seconds.
Make the ending more dramatic.
Swap to the midnight preset.
Give me a vertical cut.
```

Urlume edits the **structured storyboard** rather than regenerating it. That is not
just an efficiency argument — a regeneration changes everything, so a user who
asked for a shorter intro gets a different film and has to re-review all of it.
Editing preserves every decision they already approved.

## 34.1 An edit is a re-validation, not a patch

A removed scene leaves a gap, and the schema requires scenes in timeline order
within `duration` (§14.5). A slowed scene pushes every later scene. So an edit
runs the same funnel: apply, re-validate, re-check the craft rules, repair what is
mechanical, re-ask on judgement.

This catches what makes conversational editing dangerous. "Make the intro 3
seconds" on a 4.2s hook is fine. On a 2.8s reveal it drops below the film clock,
and `film-clock` says so rather than producing a beat that flickers. "Remove scene
3" can leave two adjacent beats of identical length, which `vary-beat-length`
catches, or remove the only CTA, which `single-cta` catches.

The `edit` stage injects pacing and continuity policy (§56.3), because those are
exactly the rules an edit breaks.

## 34.2 Cost

An edit re-analyzes nothing. Project detection, route analysis and brand
extraction are all cached (§29.3); editing touches only the JSON document and then
recompiles — which is deterministic and fast. Re-rendering a single changed beat is
a frame range (§33.1).

---

# 35. ASSET SYSTEM

`assetDirs` on `ProjectInfo` (§9) collects candidate directories:

```text
public/  static/  assets/  src/assets/
```

Reusable: logo, product images, icons, illustrations, brand fonts.

## 35.1 The logo is the one that matters

`logoSvg` is extracted from the live DOM rather than guessed from a filename,
because an inline SVG can be embedded directly in the film and scaled to any size
without rasterising. A logo lockup at 1920 from a 32px favicon is one of the most
visible cheap tells there is.

Preference order: inline `<svg>` in the header → an `<img>` pointing at a local
`.svg` → a raster logo at 2x or better → wordmark set in the brand's display face.
The last option is often *better* than a small raster: type at the right size beats a
blurred image.

## 35.2 Fonts

A brand font found on disk should be copied next to the film and self-hosted, which
is what makes the export's glyph metrics match the preview (§19.5, §36.2). A font
referenced only from a CDN is the case that breaks a render on a machine without
network — copying it locally is the fix, and finding it in `assetDirs` is how.

## 35.3 Screenshots are not assets

Existing marketing screenshots in `public/` are deliberately **not** used as film
content. They are stale by construction — a screenshot committed three releases ago
shows an interface that no longer exists — and they are flat, so they cannot be
pushed into or interacted with. Analysing the live page produces something both
current and animatable (§17).

They remain useful as reference for what the team considered worth showing.

## 35.4 Nothing is uploaded

Assets are read locally and embedded in the film. Nothing is sent to an external
service. Route screenshots go to a provider only when the optional vision re-rank is
enabled (§30.1).

---

# 36. BRAND EXTRACTION

`src/browser/brand.ts`. One `page.evaluate` rather than a dozen round trips —
every part of it needs the live DOM, and splitting it would mean re-querying the
same elements repeatedly.

```typescript
interface ExtractedBrand {
  productName: string | null;
  tagline: string | null;
  accent: string | null;
  accentCandidates: { colour: string; weight: number }[];
  background: string | null;
  scheme: 'light' | 'dark';
  fontDisplay: string | null;
  fontText: string | null;
  radius: number | null;        // modal radius across components
  hasShadows: boolean;
  navLabels: string[];
  headings: string[];
  ctaLabels: string[];
  logoSvg: string | null;
  fontWarnings: string[];       // declared but not loaded
}
```

Three things here are worth explaining, because they are not obvious.

**The accent is a weighted vote, not a lookup.** No single property is reliable:
a CSS variable named `--primary` may be unused, the most frequent colour on a page
is usually the text colour, and a brand colour often appears only on a CTA. So
candidates are collected from several sources and weighted, with the ranking kept
in `accentCandidates` so a user can override it.

**Radius is the modal value, not the mean.** A site with `8px` on forty inputs and
`24px` on two cards has a `8px` radius; averaging gives `9.6px`, which matches
nothing on the page.

**Real copy is extracted, not just style.** `navLabels`, `headings` and `ctaLabels`
are why a rebuilt UI is specific to the product. A film with the right accent and
invented labels still reads as a template.

## 36.1 Contrast repair

A site's accent was chosen against **that site's** background. A film's ground is
usually near-black, so an accent that passed WCAG on a white page can land at 2:1
in the film and become unreadable.

`ensureContrast()` steps the accent toward light or dark in 4% increments until it
reaches 4.5:1 — **toward the accent's own hue**, never substituting a different
colour, so the brand stays recognisable. It reports `adjusted` and the final
`ratio` rather than silently changing the brand.

## 36.2 Font warnings

Faces that are declared but not actually loaded are collected during extraction,
because they will export with fallback metrics — different glyph widths, different
line breaks, a different composition. Same failure the renderer guards against
(§19.5), caught earlier where it can still be fixed by self-hosting the woff2.

```text
Brand detected

Product:     Acme
Accent:      #5b8cff  (adjusted from #2b5cef for 4.5:1 on near-black)
Background:  #0b0d12
Scheme:      dark
Display:     Inter
Radius:      16px
Shadows:     yes

⚠ "Söhne" is declared but not loaded — self-host the woff2.
```

The video should feel like an extension of the website.

---

# 37. AUDIO

## 37.1 It must read muted

Autoplay is muted in every major browser. **Sound is a layer that rewards
unmuting; it never carries meaning.** A film that needs its audio to be
comprehensible is a film most viewers will not understand. This is a Tier 0 law.

Design for silence first, then add sound.

## 37.2 Sound is procedural, not sampled

The engine synthesises cues through Web Audio rather than playing audio files.
`renderAudio(48000)` renders the whole soundtrack offline and returns a base64
WAV, which the harness writes to disk and ffmpeg muxes.

This follows from determinism (§18.1): a cue is scheduled at a time on the
timeline, so the rendered WAV is a function of the storyboard exactly as the
frames are. There is no drift between picture and sound, no sample-rate
negotiation, and no audio asset to ship or license.

The cue vocabulary, scheduled per scene:

```text
click  tick  key  pop  whoosh  thump  chime  success  error
riser  toggle  pad  transition  impact  notify  appear
```

Each with `at`, and optional `gain` (0-2) and `pitch` (0.25-4). A cue lands on the
UI clock with its visual, not on the film clock — a click sound 400ms after the
press reads as broken.

## 37.3 Music bed

`audio.bed` on the storyboard: `none` (default), `dark_glass_synth`,
`upbeat_corporate`, `minimal_chill`.

A licensed track is the user's decision and their license, so Urlume does not
bundle music. `Skills/motion-audio.md` covers sourcing (Pixabay, YouTube Audio
Library), licensing, and mixing with ffmpeg at broadcast loudness.

## 37.4 Mixing

FFmpeg muxes the rendered WAV with the PNG sequence in a single encode pass
(§19.6). Audio is optional and off by default at the CLI (`--no-audio`), because a
silent MP4 is a valid deliverable and often the one that goes on a landing page.

---

# 38. VOICEOVER

```text
Create a 30-second video with a professional voiceover.
```

Deferred to phase 7. Voice stays modular and provider-agnostic, like the text
providers (§6).

## 38.1 First question: should it narrate at all?

`Skills/voiceover-narration.md` leads with this, and it is the right order. A film
built on §37.1 — readable muted, one idea per scene, the visual landing before the
words — often does not need narration, and adding it can make the film worse by
letting the copy explain what the picture was already proving.

Narration earns its place when there is something the picture genuinely cannot
carry: a claim needing a source, a mechanism needing a sentence, a tone that only a
voice sets.

## 38.2 Narration is written to the beat sheet, not to the film

The script is generated **from the beat sheet**, with a word budget per beat derived
from words-per-second, before or alongside the picture. Writing a script against a
finished film means either rushing lines or stretching beats to fit them — and
stretched beats are what makes a narrated film drag.

At ~2.5 words per second, a 4.2s hook is about ten words. That constraint improves
the writing.

## 38.3 Timing and determinism

TTS output must be **cached and content-addressed**, keyed by text plus voice plus
model. A render that re-synthesises audio is not reproducible: providers change
voices, and the same request can return a clip a few milliseconds different in
length, which shifts every alignment after it.

So the cached WAV is an input to the render, exactly like the procedural cues
(§37.2), and a re-render of an unchanged storyboard produces an identical file.

## 38.4 Alignment

Narration is aligned to the timeline, not the reverse. A line is anchored to its
beat's start with a lead-in, and the **law that the visual lands ~600ms before the
words that name it** applies here directly: the picture shows it, then the voice
names it. Reversed, the film feels like a slideshow with commentary.

---

# 39. CONFIGURATION

`.urlume/config.json`. Validated with Zod, and **safe to commit** — it contains no
secrets (§7).

```json
{
  "version": 1,
  "provider": "anthropic",
  "model": "claude-opus-5",
  "video": {
    "aspect": "16:9",
    "fps": 30,
    "quality": "high"
  },
  "preset": "apple",
  "audio": { "enabled": false, "bed": "none" },
  "brand": {
    "accent": "#5b8cff",
    "fontDisplay": "Inter"
  },
  "browser": {
    "headless": true,
    "devServerTimeoutMs": 60000
  },
  "vision": { "rerank": false }
}
```

Note there is no `width`/`height`: resolution is **derived from `aspect`** via
`ASPECT_DIMENSIONS` (§14.5). Letting both be configured independently is how a
storyboard ends up with a 16:9 aspect and 1080x1920 pixels, which previews
correctly and exports wrong. One of them has to be derived, and aspect is the one a
user actually thinks in.

`brand` here is an **override**, not a cache. Extraction (§36) fills what is
missing; anything set here wins, so a user who disagrees with the detected accent
fixes it once rather than per storyboard.

`format` is dropped — H.264/MP4 is the only output, and a config field offering
choices that do not exist is worse than no field.

---

# 40. ENVIRONMENT SUPPORT

The analyzed project's dev server usually needs its own environment — a database
URL, an auth secret, API keys of its own. Urlume does not manage those; the dev
server inherits the environment Urlume was launched in, which is the same
environment `pnpm dev` would have had.

```text
.env
.env.local
.env.production
```

**Values are never read into Urlume's own memory and never sent to a provider.**
The distinction that matters: the child process needs them, Urlume does not. So
they pass through the process environment and are never parsed, logged, cached in
`.urlume/`, or included in a prompt.

## 40.1 Missing values

When a dev server exits non-zero on startup, its own output usually says which
variable is missing, and that output is what Urlume shows (§32). Urlume does not
try to predict a project's environment requirements — it would be guessing, and the
project already produces a better error than a guess.

What it does do is name the likely cause: a dev server that exits immediately is
far more often a missing environment variable than a Urlume problem, so the error
says so and suggests running the command directly.

## 40.2 Pages requiring authentication

A dashboard behind a login is the most valuable thing in a product film and the
hardest to reach. Urlume cannot log in on its own, and inventing credentials is not
an option.

Not solved yet. The realistic answers, in preference order: a project's own seed or
demo user; a `storageState` file captured once from a real session; or a route that
renders with mock data in development. Stated here as a known gap rather than
implied to work — a tool that silently films a login screen instead of the
dashboard has produced a useless film.

---

# 41. WEBSITE TYPES

Urlume should be designed to support:

* SaaS
* landing pages
* dashboards
* eCommerce
* portfolios
* agency websites
* web applications
* AI applications
* documentation sites
* admin panels
* startup websites

The architecture must not assume every project is Next.js.

## 41.1 Where the beat sheet fits, and where it does not

The beat vocabulary (§14.2) is a **product** narrative: a problem, a product that
resolves it, proof, one action. That is the right shape for SaaS, dashboards, web
apps, AI applications and startup sites — which is most of the list, and the
product's target.

It fits less well elsewhere, and pretending otherwise produces bad films:

* **Portfolio or agency site** — the work is the argument. `hook`/`stakes` has
  nothing to attach to; the film wants to be a sequence of pieces.
* **eCommerce** — the problem is the product's absence, which is thin. Wants
  product, detail, price, action.
* **Documentation** — arguably should not be a film at all.

An alternative beat set is the honest fix, and it is deferred rather than faked. The
schema makes it cheap: `BEATS` is one enum, and the craft rules that depend on beat
identity are `payoff-hold` and `vary-beat-length`. The rules that carry most of the
quality — the film clock, camera discipline, cuts over crossfades, readable type —
are narrative-agnostic and would apply unchanged.

Until then, a portfolio site produces a technically clean film with a slightly
forced structure. Worth stating so the limitation is visible rather than
discovered.

---

# 42. WORDPRESS SUPPORT

WordPress needs no special support beyond a detector, because it is a **URL case,
not a framework case** (§43).

Detection: `wp-config.php`, `wp-content/`, or the `/wp-json/` endpoint answering.

There is no `pnpm dev` to run — a WordPress site is served by PHP and a web server
Urlume does not manage. So the detector's job is to recognise WordPress and then ask
for the URL where it is already running:

```text
✓ WordPress detected

There's no dev server to start. Where is this site running?

  Target URL:  http://localhost:8080
```

From there it is remote mode: navigate, analyze, extract brand, rebuild UI. Local
(Local by Flywheel, XAMPP, `wp-server`) and remote staging are the same path.

Remote URLs require explicit user configuration (§43.3).

## 42.1 The asset advantage

WordPress exposes `/wp-json/` on most installs, which gives structured access to
posts, pages, media and the site title — cleaner than scraping the DOM for the same
information. Worth using where available, but not required: DOM analysis works
regardless, and a hardened install may have the REST API disabled.

---

# 43. REMOTE WEBSITE MODE

```bash
urlume --url https://example.com
```

or:

```text
Create a video from https://example.com
```

Analyze a public website without source-code access. Local project mode remains the
primary use case.

## 43.1 Why this is a small change

Almost everything already works without source access. Page analysis and brand
extraction (§12, §36) read the live DOM, not the repo. The compiler consumes a
storyboard. The renderer consumes a film. **Source is only used for framework
detection, route discovery and asset directories** — and in remote mode all three
are replaced:

```text
framework      irrelevant; nothing is started
routes         crawled from links, or supplied by the user
dev server     skipped entirely
assets         fetched from the page rather than the filesystem
```

That makes remote mode a different front end on the same pipeline, which is a
consequence of §17.1 — the film is built from the rendered page, so it never needed
the source in the first place.

## 43.2 What gets worse

Route discovery. A filesystem walk finds `/dashboard` whether or not anything links
to it; a crawl only finds what is reachable from the homepage, which for most SaaS
sites means the marketing pages and not the product. So remote mode should ask which
routes matter rather than assume a crawl found them.

Authentication is the same wall as §40.2, and harder — there is no dev-mode mock
data to fall back on.

## 43.3 Explicit configuration required

A URL must be passed deliberately. Urlume does not follow off-host redirects,
crawl beyond the given origin, or film a site because it appeared in a config file.
The user is pointing a camera at something, and it should be the thing they meant.

---

# 44. VIDEO STYLE ENGINE

The draft proposed a `VideoStyle` object owning camera, lighting, transitions,
typography, animation and environment settings. The built system deliberately does
not have one, and the reason is worth recording because it looks like a
simplification and is not.

A style object that controls camera behaviour and animation timing puts pacing
decisions in a **swappable token**. That means switching preset changes how fast
the film moves — and the craft rules (§57) exist precisely because pacing is not a
matter of taste. `film-clock`, `camera-discipline`, `payoff-hold` and
`overlap-not-queue` would each have to be re-derived per style, or would have to
override the style, at which point the style's timing fields are dead weight that
still has to be maintained.

So responsibility is split by whether the decision is negotiable:

| Decision | Owner | Negotiable |
|---|---|---|
| ground, glass tint, rim, shadow depth, type scale | **preset** (`body[data-preset]`) | yes — taste |
| accent | **brand**, via `--accent` | yes — the product's |
| aspect, fps, resolution | **storyboard** | yes — the deliverable |
| beat order and structure | **beat sheet** | no — §14.2 |
| entrance durations, holds, overlap, stagger | **craft rules** | no — §57 |
| camera count per beat, zoom cap, lead | **craft rules** | no — §57 |

Extensibility comes from adding a preset (a block of CSS custom properties) rather
than from a settings interface. A new preset is a colour and material decision and
nothing else, which is why five of them cover the ground that ten mood-named
styles were meant to (§21).

---

# 45. QUALITY REQUIREMENT

Each of these is enforced somewhere, not merely aspired to. A quality goal with no
mechanism behind it is a preference.

### Smoothness

Fluid motion. Enforced by `no-linear-on-motion`, `film-clock` and
`overlap-not-queue`: entrances long enough to register, eases with acceleration,
and the next move starting at ~65% of the previous rather than queueing behind it.

### Cinematic camera movement

No random zooming. Enforced by `camera-discipline`: **one move per beat**, zoom
capped at 2.5x (past which text rasterises soft), and the camera leads the cursor
rather than chasing it. A camera has mass — `inOutCubic`, not `outExpo`.

### Visual hierarchy

The most important features get the most attention. Element ranking (§12.1) is
what feeds this, and the beat sheet spends its longest beat — `how` — on the
product's strongest feature.

### Consistency

All scenes feel like one film. Enforced by `scenes-overlap`, so motion carries
across a cut, and by `cuts-not-crossfades`: hard cuts, at most two dissolves in a
film. A crossfade between every scene is the clearest signal that no one decided
where the cuts belonged.

### Realism

Perspective and depth respect each other. Depth comes from layered parallax and
CSS `perspective`, not from a 3D scene graph (§16) — and a captured flat frame is
never orbited, because that reveals it is flat.

### Restraint

Do not overload the film with effects. Effect density is the most reliable tell of
a template, which is why the presets carry no animation settings at all (§44) and
why `single-cta` and `vary-beat-length` exist.

### Legibility

Body copy at 24px minimum, scaled by stage width (`readable-type`). Film type is
much larger than UI type; 16px body copy is a cheap tell and unreadable on a phone.
The floor scales with resolution rather than being a fixed pixel count, so a 1080-wide
vertical cut gets a proportionally correct floor instead of a 1920-derived one.

### Honesty

Every on-screen statistic carries its source (`attributed-stats`). An unsourced
number reads as marketing noise and discounts everything around it — including the
numbers that are true.

The goal:

> **Premium product launch video.**

Not:

> "AI-generated flashy animation."

The difference between those two outcomes is almost entirely structural, not
decorative. Which is why the funnel in §58 is the architecture.

---

# 46. MVP

Do NOT attempt every feature immediately.

The original draft ordered phases outside-in: CLI first, then browser, then AI,
with rendering fourth. Construction went the other way, and the revised order
below reflects it — **the contract and the renderer came first**, and the TUI came
last.

The reason is that everything upstream is defined by what the renderer can
consume. A TUI built before the schema existed would be a chat window with
nothing to say; a schema built before the renderer would encode guesses about
what the engine accepts. Building outside-in means discovering in phase 4 that the
storyboard shape from phase 3 cannot express what the engine needs, and by then
three layers are built on it.

## Phase 1 — The contract

* `storyboard/schema.ts` — Zod, cross-field validation, derived helpers
* `skills/` — loader, section index, laws, stage policy
* `storyboard/craft-rules.ts` — the rules, as executable checks
* unit tests for all three

Nothing runs yet. The point of this phase is that the shape of a film is settled
before anything is built to produce or consume one.

## Phase 2 — Deterministic rendering

* `scripts/extract-runtime.mjs` — engine out of the core skill
* `renderer/` — capture harness, hazard guards, ffmpeg encode
* `compiler/` — storyboard JSON -> film

**Milestone: a hand-written storyboard renders to an MP4.** No AI involved. This
is the phase that proves determinism, and everything after it is upstream
plumbing.

## Phase 3 — Project understanding

* `project/detect.ts` — framework, package manager, routes
* `project/dev-server.ts` — launch, port detection, clean shutdown
* `browser/analyze.ts` — element ranking
* `browser/brand.ts` — accent, scheme, typeface, radius, contrast repair

**Milestone: `urlume analyze` prints real routes, ranked elements and a brand.**

## Phase 4 — The AI director

* `providers/` — the adapters behind the interface
* `storyboard/generate.ts` — prompt assembly + validation loop
* `agent/` — loop and tool registry

**Milestone: a real project produces a validated storyboard, then an MP4.** This
is the first end-to-end run and the first phase where the product exists.

## Phase 5 — The interface

* `cli.ts` — Commander, subcommands
* `tui/` — Ink, streaming, slash commands, approvals, progress

Last, not first. Every layer beneath it is independently exercisable from a
subcommand, so the TUI is a presentation of a working system rather than
scaffolding for one.

## Phase 6 — Craft depth

* the remaining skills wired into stage policy
* conversational storyboard editing (§34)
* vertical and square reformatting (§20)
* sound cues and the music bed (§37)

## Phase 7 — Reach

* vision-model re-ranking of element importance
* voiceover (§38)
* remote URL mode (§43)
* WordPress (§42)
* opt-in Three.js scenes (§16.2)

---

# 47. INITIAL USER FLOW

The finished MVP should support:

```bash
cd my-project
urlume
```

Then:

```text
Urlume

> Create a premium product video for this project.
```

Urlume:

```text
✓ Next.js                    pnpm · 8 routes
  Urlume wants to run: pnpm dev
  Allow? [Y/n] y
✓ Dev server                 http://localhost:3001
✓ Analyzed 8 routes          247 elements ranked
✓ Brand                      #5b8cff on #0b0d12 · Inter · radius 16px

The AI generator is the strongest feature — it's the only route with a
composer, and /dashboard exists mostly to get you there.

Thesis: support teams answer the same question forty times a day.

  hook      inbox filling up          4.2s
  stakes    response time climbing    3.4s
  reveal    Acme                      2.8s
  how       AI generator drafting     9.6s
  payoff    sent, queue empty         4.4s
  proof     2 counted metrics         4.0s
  end       one CTA                   3.2s

  30.0s · 16:9 · 30fps · apple · ✓ 13 craft rules pass

Create this storyboard? [Y/n]
```

Then:

```text
✓ Storyboard validated       .urlume/storyboard/main.json
  ⤶ repaired: scene 2 stagger 40ms → 90ms  (stagger-range)
  ⤶ repaired: scene 5 hold 200ms → 700ms   (payoff-hold)
✓ Film compiled              .urlume/film/index.html

Preview it, or render? [preview/render/edit]
```

Then:

```text
Rendering  ████████████████████░░░░░░░░  612/900   68%   ~40s left

  ✓ hook    126   ✓ stakes  102   ✓ reveal   84
  ▸ how     204/300

✓ 900 frames · audio muxed · 6.2 MB

Saved:  .urlume/renders/acme-30s-16x9.mp4
```

Note what the repair lines do: they say what was changed and which rule required
it. A silent fix teaches nothing, and the next storyboard has the same problem.

---

# 48. PACKAGE DISTRIBUTION

The CLI should eventually be installable globally:

```bash
npm install -g urlume
```

or:

```bash
pnpm add -g urlume
```

Then:

```bash
urlume
```

should work from any project directory.

Consider future standalone binaries for:

* macOS
* Windows
* Linux

---

# 49. DOCUMENTATION

README should include:

```text
What is Urlume?
How it works                  the pipeline, and the two decisions that shape it
The skill system              tiers, craft rules
Installation
Quick Start
Supported Projects
AI Providers                  and where keys are stored, honestly
Commands / Slash Commands
Video Presets
Configuration
Verification status           what is built vs written vs unbuilt
Troubleshooting
Architecture
Development
Contributing
```

Include screenshots/GIFs of the CLI when available.

## 49.1 Documentation must state what is unverified

**Verification status is a required section, not a courtesy.** A README that
describes unbuilt features in the present tense is a lie with a plausible excuse,
and it costs whoever reads it next — including whoever wrote it, three weeks later.

The current README does this, and this specification does too (§60). The rule:
`written` and `working` are different words, and only one of them may be used
without having run something.

## 49.2 Document the hazards where they bite

§59's hazards are documented at their site in the code, not only in the README,
because that is where someone is standing when the hazard applies. The comment above
`buildArgs` explains why `-framerate` precedes `-i`; the comment in the compiler
explains why the cursor sits outside every scene.

Rationale ages better than instruction. A rule with its reason survives a refactor,
because the next person can tell whether the reason still holds — a bare rule just
looks like an obstacle.

---

# 50. CODE QUALITY

* TypeScript strict mode; no unnecessary `any`
* Zod validation at every boundary where untrusted data enters — model output,
  config files, credential store
* clear interfaces, modular architecture, one-way dependencies (§27)
* unit, browser and render tests, plus the mutation harness (§51)
* proper logging; graceful shutdown of dev server and browser on every exit path
* no giant files

## 50.1 Comments carry reasoning, not description

A comment restating what the line does is noise. A comment explaining **why the
line is that way** is the only durable form of documentation, because it is the part
a reader cannot recover from the code.

This codebase leans heavily on that, and the reason is specific: most of its
non-obvious decisions were forced by a failure mode that is silent. Nothing about
`-framerate` before `-i` looks important; nothing about the cursor's position in the
DOM looks load-bearing; nothing about `fonts.check()` versus `fonts.ready` looks like
a difference. Each one is a render lost.

So the standard is: **if getting it wrong fails silently, the reason goes next to
the code.** That is what makes the guards in §59 survive a refactor by someone who
was not there when they were written.

## 50.2 Cite the source of a rule

Every craft rule names the skill section it derives from (§57), so a rule can be
traced to the reasoning that justifies it. This is what stops the prose and the
executable check from drifting apart — and drift is otherwise inevitable, because
prose is edited by whoever is writing a film and code by whoever is fixing a bug.

## 50.3 State the trade rather than hiding it

Where a decision has a real cost, the code says so:
`~/.urlume/credentials.json` is not a keychain and `STORAGE_NOTICE` says why keytar
was rejected (§7.2); `UNGUARDED` lists the determinism holes that are not solved
(§19.5); `capture` mode documents that it goes soft past 1.5x (§14.3).

A documented limitation is a known quantity. An undocumented one is discovered by a
user, at the worst possible moment, and read as a bug.

---

# 51. TESTING

Three suites, split by **what they need to run**, not by unit-versus-integration.

```bash
npm run test:unit      # pure functions — Node, fast
npm run test:browser   # layout-dependent — real Chromium
npm run test:render    # the export pipeline end to end
npm run test:mutation  # do the craft rules actually fire
```

## 51.1 Unit — Node

Everything that is a pure function of its input:

```text
schema validation, including every superRefine case
craft rules: each rule fires on a violating storyboard, passes a clean one
repair: mechanical fixes produce a storyboard that then validates
skill loading, section indexing, retrieval
verifyPolicy() returns empty          ← a renamed heading fails CI
laws token budget
parsePort() against real output from each framework
package manager and dev command composition
extractJson() against fenced, prose-wrapped and truncated responses
explainStatus(), withRetry() on transient vs permanent failures
buildArgs(): -framerate before -i
contrastRatio(), ensureContrast()
maskKey(), redactSecrets()
```

## 51.2 Browser — real Chromium, not jsdom

**jsdom cannot test this code.** It has no layout engine, so `offsetParent`,
`offsetTop/Left` and `getBoundingClientRect` all return 0 and `getTotalLength()` is
unimplemented. Anything touching `point()`, `cursorTo()` or `draw()` is untestable
there, and worse, it would pass with zeros and prove nothing.

So the browser suite runs a real Chromium:

```text
seek(t) idempotence — forward, backward, and cold to the same t
element ranking against fixture pages
brand extraction: accent vote, modal radius, scheme
selector generation preference order
junk suppression on a page with a cookie banner
the engine mounts and publishes __EXPLAINER__
glass renders as glass, not flat
```

## 51.3 Render — the pipeline

```text
a known storyboard produces a known frame count
two renders of the same storyboard produce identical frames  ← determinism
hazard guards: a CSS animation is pinned, a video is paused
frame ranges: [0,100) + [100,200) equals [0,200)
ffmpeg produces a file ffprobe reads at the right duration and fps
```

The determinism test is the one that matters most. It is the property everything
else assumes, and it is the one that would break silently.

## 51.4 Mutation — do the rules fire?

A craft rule that never fires is indistinguishable from a craft rule that passes.
So the harness takes a clean storyboard, introduces one known violation per rule,
and asserts the corresponding rule catches it.

This is the test suite for the test suite: without it, a rule could be silently
broken by a refactor and every film after that point would be slightly worse with
nothing failing.

## 51.5 Vision and providers

Provider adapters are tested against recorded responses, not live APIs — a test
suite that needs four API keys does not run in CI, and one that spends money does
not run often. Live calls are a manual smoke check.

Tooling: **Vitest** for all suites; **Playwright** provides the browser.

---

# 52. DEVELOPMENT PRINCIPLE

**Do not fake functionality.**

Mark what is not implemented rather than building a UI that pretends. Every
implemented feature works end to end. Prefer a smaller functional MVP over a
collection of placeholders.

## 52.1 This applies to the documentation too

A spec or README describing unbuilt code in the present tense is the same failure as
a fake UI — it just fails later, and for the reader instead of the user. Hence §49.1
and §60: `written`, `tested` and `working` are three different claims, and only the
first is currently true of most of this system.

The uncomfortable version, stated plainly: **this document describes a system that
has never run.** The design is considered and the reasoning is recorded, but
`npm install` has not been executed, no film has been rendered, and the vendored
engine has never been opened in a browser. Nothing here should be read as an
observation.

## 52.2 A fake video is worse than no video

Specific to this product. A tool that renders *something* — a slideshow of
screenshots with crossfades — has produced an artefact that looks like success and
is worthless, and the user only finds out after showing it to someone.

Which is the reason for the whole funnel (§58). The craft rules do not exist to make
good films marginally better. They exist so that the failure mode is a **reported
violation** rather than a plausible bad film.

If Urlume cannot make a good film from a project, the correct output is saying so.

---

# 53. IMPORTANT ARCHITECTURAL PRINCIPLE

Separate:

```text
AI intelligence
```

from:

```text
deterministic rendering
```

The AI should decide:

```text
WHAT
WHEN
WHY
```

The renderer should decide:

```text
HOW
```

For example.

The AI emits:

```json
{
  "beat": "how",
  "duration": 4000,
  "camera": { "target": "analytics-card", "zoom": 1.8, "at": 600, "dur": 1200,
              "ease": "inOutCubic" },
  "hold": 700
}
```

The renderer decides: where `analytics-card` is in stage space, what the transform
is at frame 37, how the ease interpolates, which pixels result, how they encode.

## 53.1 The AI never emits HOW

This is the specific line, and it is stricter than it first appears. The model does
not emit CSS, HTML, transform strings, keyframes, pixel offsets, or code of any kind.
It emits a value that parses against the schema (§14) — a *description* of intent,
where every field is either an enum, a bounded number, or a reference the compiler
resolves.

That is why `camera.target` names an element rather than carrying coordinates: a
coordinate is a HOW, and letting the model compute one would put arithmetic it
cannot verify into the film (§19.3a).

## 53.1a The boundary is enforced at the string level

Every model-supplied string passes through `copyText()` on its way into markup:
escaped for `&`, `<`, `>` and `"`, with exactly one exception — `{br}` becomes
`<br>`.

So a model cannot inject markup or script into a film through a copy field, even
though its text ends up in an HTML document. The separation in §53 is not only an
architectural convention; it holds at the point where model output meets the page.

`{br}` exists because **line breaks must be explicit**. `splitText('lines')` splits on
literal breaks and deliberately does not measure rendered line boxes: font metrics
differ between the authoring browser and the headless renderer, so measuring would
make the export non-deterministic (§19.5). A `{br}` token is a decision the storyboard
records; a measured line break is a decision the export machine makes, differently.

## 53.2 Why this is not just tidiness

Three properties fall out of it, and none survives without it.

**Reproducibility.** Everything below validation is a pure function of the
storyboard, so the same JSON always produces the same MP4. A re-render is a build.

**Enforceability.** A rule can only be checked against a structure. "Never `linear`
on a moving element" is a mechanical check on an animation record and an unenforceable
suggestion about generated CSS. The entire craft-rule layer (§57) exists *because* the
model's output is structured — the funnel in §58 collapses the moment a model can
write markup directly.

**Editability.** "Make scene 2 slower" is a field change on a JSON document (§34).
Against generated code it means regenerating, and the user re-reviews a film they had
already approved.

This separation is essential for reproducibility — and it is also the thing that
makes quality controllable rather than hoped for.

---

# 54. FINAL PRODUCT VISION

The final experience should feel like:

```text
Claude Code
        +
Playwright
        +
a deterministic motion engine
        +
FFmpeg
        +
AI Video Director
```

but specialized for one purpose:

# TURN WEB PROJECTS INTO PREMIUM PRODUCT VIDEOS.

The killer feature is:

```bash
cd my-project
urlume
```

then:

```text
Create a premium video for this project.
```

Urlume should understand the project, understand the interface, choose what matters, create the cinematic direction, control the real website, and render the final video.

---

# 55. BUILD INSTRUCTIONS

Implement incrementally, in the order in §46 — **contract first, renderer second,
interface last.**

Before implementing each subsystem:

1. Define its interfaces.
2. Define its responsibilities.
3. Implement it independently.
4. Add tests.
5. Integrate it.
6. Verify the complete workflow.

Do not over-engineer the first version.

## 55.1 The immediate next step

Phases 1-3 are written and phase 4 is partly written. The gate in §60 now holds:
`npm test` is green and a hand-written storyboard renders to a playable MP4, so the
vendored engine is no longer an assumption — it has been opened in a browser, and
the three composition defects that surfaced are fixed (§60).

```bash
npm install
npx playwright install chromium
npm run extract        # populate runtime/ from the core skill
npm test
npm run demo           # compile + render examples/demo-film
```

The next subsystem is therefore the one directly above the compiler: `providers/`,
then `storyboard/generate.ts`, then the agent loop. Those can now be built on an
observed renderer rather than an assumed one — which was the whole reason for
doing it in this order.

## 55.2 The first real milestone

```text
urlume
    ↓
detect project
    ↓
start server                 [asks permission]
    ↓
Chromium
    ↓
analyze routes + brand
    ↓
AI generates storyboard      → Zod → craft rules → repair or re-ask
    ↓
compile film                 deterministic
    ↓
seek + screenshot every frame
    ↓
ffmpeg
    ↓
MP4
```

Once this works reliably, build the rest on top: vision re-ranking, voiceover,
remote mode, opt-in 3D scenes.

## 55.3 What "reliably" means

Not "produced an MP4 once." Specifically:

* `npm test` green, including the mutation harness (§51.4)
* two renders of the same storyboard produce **identical frames**
* a render on a second machine matches the first
* the film has been watched, and it does not read as a template

The last one is not automatable and is the only one that finally matters. Every rule
in §57 is a proxy for it.

The ultimate goal is for Urlume to become the **developer's AI video agent**: a terminal-native tool that can take an existing website or SaaS application and transform it into polished, cinematic marketing content with minimal manual work.

---

# 56. THE SKILL SYSTEM

Everything Urlume knows about video craft lives in `Skills/` as markdown, not in
prompt strings scattered through the code. Nineteen skills, each with YAML
frontmatter carrying a `name` and a `description` written to be read by a model
deciding whether it needs that skill.

`Skills/saas-explaner-motion.md` is the **core skill** — the animation engine's
source, the Liquid Glass component system, the beat sheet method, cursor
choreography, and the material rules. It is also where `runtime/` is extracted
from (§19.7).

The supporting skills:

```text
storyboard-schema              JSON as the model's only output; repair vs re-ask
ui-mockup-rebuild              rebuilding UI from glass components; density
brand-extraction               deriving a brand system from a live DOM
kinetic-typography             film-scale type, masked reveals, word budgets
data-viz-motion                counters, chart reveals, the one-number rule
device-mockups                 browser/laptop/phone chrome, real proportions
playwright-deterministic-capture  the seek-and-screenshot loop, hazards
ffmpeg-video-encoding          flag-by-flag encode reasoning, delivery specs
threejs-in-video               real 3D driven from t, and when not to
svg-shape-morphing             path morphing, and its cheaper alternatives
css-animations                 CSS technique, and when to reach for JS
framer-motion                  React animation patterns
motion-audio                   music selection, licensing, sourcing
voiceover-narration            whether to narrate; writing to a beat sheet
vertical-social-reformat       9:16, 4:5, 1:1 as re-composition
```

## 56.1 Availability is not enforcement

The central problem: **making a skill available to a model does not make the model
follow it.** A model that has read "cut, do not dissolve" will still crossfade
every scene, because nothing stopped it. Retrieval-on-request fails the same way —
it only fires when a model recognises it needs something, which is exactly the
case that does not apply to a rule it does not know it is about to break.

So the rules bind at four levels, and the last one is not advice at all.

## 56.2 Four tiers

| Tier | What | When | Cost |
|---|---|---|---|
| 0 | **Laws** — the non-negotiables | every prompt, always | ~2k tokens |
| 1 | **Index** — every skill's name + description | every prompt, always | ~1.3k tokens |
| 2 | **Retrieval** — one `##` section, on request | when the model asks | ~1k per section |
| 3 | **Policy** — sections injected per pipeline stage | unconditionally, per stage | ~2-8k |

**Tier 0** (`src/skills/laws.ts`) is not a summary of the skills. It is the subset
that must be *resident*, because a model that has to go and fetch "do not
crossfade" has already written the crossfade. Budget ~2000 tokens. When it grows
past that, the correct move is to demote a rule to Tier 3 — **never** to trim the
explanations, because a rule without its reason gets rationalised away the first
time it is inconvenient.

**Tier 1** (`renderIndex()`) is every skill's name and description and nothing else.
It is what makes Tier 2 possible at all: a model cannot ask for a section of a skill
it does not know exists.

Measured at **1295 tokens** for the 16 shipped skills, not the ~400 first estimated
here — that figure predates the descriptions, which are deliberately rich because the
`Use when…` clause is what a model routes on. The cost grows linearly with the
library (~1.5k at 19 skills, ~2.2k at 27), so past ~20 the move is to compact what
`renderIndex()` emits rather than to accept the growth: the first sentence names the
topic, and the full description stays on the skill for `renderContents()`.

**Tier 2** (`readSection()`) exists because the core skill is thousands of lines
and injecting it whole would crowd out the storyboard. Skills are indexed by
heading at load, so retrieval returns a section rather than a file. Subsections
stay attached to their parent deliberately — a `###` alone usually lacks the
context to be useful.

Lookup tries slug, then exact title, then substring — so a model that asks for
"liquid glass" or "Liquid Glass" or `liquid-glass` gets the same section. Calling it
with **no** section returns the preamble and a contents list, not the whole file:
handing back sixty thousand tokens because the caller omitted an argument is exactly
the failure this tier exists to prevent. An unknown skill name returns a
did-you-mean suggestion rather than an empty result.

## 56.2a Skills are overridable

Three directories load in order, later winning:

```text
packaged    the package's own Skills/
user        ~/.urlume/skills
project     <cwd>/.urlume/skills
```

A user or a project can override any packaged skill by name, or add new ones. That
is the intended customisation path: a studio with its own motion language edits the
prose rather than forking the tool, and because §57's rules cite the sections they
derive from, an override is traceable.

`origin` is recorded on each skill so an unexpected override can be diagnosed —
"why is my film crossfading" has a much better answer when the loader can say which
file the rule came from.

A malformed skill is collected into `errors` and skipped, never thrown. A broken
third-party skill must not stop the pipeline. Frontmatter is parsed without a YAML
dependency, which means anything more structured than `key: value` is unsupported and
returns null rather than being guessed at.

**Tier 3** (`src/skills/policy.ts`) is the tier that does the real work, and it
exists because Tier 2 has a blind spot. A model writing a camera move does not
think to ask about backdrop roots. So the camera section is injected at
scene-compile time, every time, whether it was asked for or not.

## 56.3 Stage policy

```text
analyze      what in the product is worth filming; what to extract
storyboard   beat sheet, the two clocks, continuity, cheap-vs-premium tells,
             craft rules  ← the largest injection
compile      cursor choreography (which carries the camera rules), Liquid Glass,
             precedence, the component vocabulary
style        Liquid Glass, typography, contrast
audio        silence first, sound effects, the cue vocabulary
edit         pacing, continuity
```

`storyboard` gets the most because that is where a film's structure is decided,
and structure is unrecoverable later — no amount of polish saves a film with no
spine.

Each stage's list is kept **short** on purpose. Injecting everything is the same
as injecting nothing: the rules that matter get lost among the ones that do not.

## 56.4 Policy references are verified

Section titles are matched case-insensitively by substring, so a reference
survives a heading being reworded. A reference that no longer resolves is skipped
silently by `collectSections` rather than failing the stage — a missing optional
section should not abort a render.

But that silence is the problem. A skipped reference is a rule that quietly stopped
being enforced, and the failure is invisible: films keep rendering, they just get
slightly worse, and nobody knows when it started.

So `verifyPolicy()` reports every unresolved reference — naming the stage, the
reference and whether the skill or the section was missing — and **the test suite
asserts it returns empty.** A renamed heading fails CI rather than silently degrading
every subsequent film.

The same asymmetry appears one level down: `readSection` on a miss returns an error
listing the sections that *do* exist, so a model or a developer who guessed a heading
gets the real list rather than nothing.

---

# 57. CRAFT RULES

`src/storyboard/craft-rules.ts` compiles skill prose into executable checks
against a parsed storyboard. This is Tier 4, and it is the only tier that does not
depend on the model cooperating.

Each rule cites the skill section it derives from, so a rule can be traced back to
the reasoning that justifies it — and the two cannot drift apart silently.

| Rule | Enforces |
|---|---|
| Rule | Enforces | Severity |
|---|---|---|
| `cuts-not-crossfades` | hard cuts; at most 2 dissolves per film | error |
| `no-linear-on-motion` | never `linear` on a moving element | error |
| `scenes-overlap` | consecutive ranges overlap ≥120ms; repaired to 300ms | warning |
| `stagger-range` | flags outside 50-200ms; repaired into 60-120ms | warning |
| `no-random-stagger-on-text` | `staggerFrom: random` never on text | error |
| `camera-discipline` | one move per scene, zoom ≤ 2.5×, leads the cursor | error |
| `payoff-hold` | the payoff beat holds 600-900ms before the cut | warning |
| `single-cta` | **exactly** one CTA — fires on zero as well as two | error |
| `attributed-stats` | a number with a unit or multiplier carries its source | error |
| `vary-beat-length` | adjacent beats differ by ≥150ms | warning |
| `readable-type` | body copy ≥ 24px × (width/1920) | warning |
| `film-clock` | flags moving entrances under 320ms; repairs to 480ms | warning |
| `overlap-not-queue` | flags >200ms of dead air between moves in a scene | warning |

`isMoving` decides what counts as motion for `no-linear-on-motion`: an animation
touching `x`, `y`, `scale` or `rotate`. An opacity-only or blur-only wash is not
moving, and `linear` is defensible there — which is why the rule tests the property
set rather than the ease name alone.

`camera-discipline` carries three checks, not one: zoom over 2.5×, a move that runs
past the end of its scene, and a camera that starts **after** the cursor. The third
is the interesting one — the camera should lead by 200-300ms, because moving in
lockstep with the cursor reads mechanical while a slight lead reads as anticipation.
Repair sets `camera.at` to `cursor.at - 260`.

The zoom cap appears in both the schema (`max(2.5)`) and this rule, deliberately.
The schema rejects a storyboard that arrives with 3.0; the rule catches the case
where an edit or a repair produced one, and can clamp instead of failing. Overlapping
guards at different layers is the intended design, not duplication.

`film-clock` carries the two-clock exception in code rather than in prose. An
animation is exempt when it lands within 200ms of a cursor gesture completing
(`c.at + c.travel + c.latency`), because that is a **UI response** — a fake button
clicked by a fake cursor must react on the UI clock, and forcing it to 480ms would
make the interface feel broken. Every other moving entrance under 320ms is a
flicker.

`cuts-not-crossfades` counts a scene as a dissolve if `kind === 'dissolve'` **or**
`fade > 0`, and repairs by resetting the transition to `{ kind: 'cut', fade: 0 }`.
Testing both fields matters: a `cut` with a non-zero fade is still a crossfade, and
it still makes the scene a backdrop root that flattens its own glass.

Note the two-band pattern on `stagger-range` and `scenes-overlap`: the **check** is
looser than the **repair**. A rule that flagged everything outside 60-120ms would
fire on a deliberate 130ms, so the check tolerates a margin and the repair lands in
the middle of the good band. Flagging is where false positives cost trust; repairing
is where precision is free.

`attributed-stats` distinguishes a claim from a number: `40%`, `3x`, `12 hours`, `4k`
are claims and need a source; a bare small integer (a row count, a step number) is
not. Matching every digit on screen would make the rule useless within one film.

## 57.1 Repair versus re-ask

The distinction is whether fixing the violation requires a judgement call.

**Repaired in place** (`repairCraft`): a `linear` ease on a moving element becomes
`outQuint`. A 40ms stagger becomes 90ms. A 250ms entrance becomes 500ms. A missing
`hold` after a payoff is added. These have exactly one correct answer, and asking a
model to apply it wastes a round trip.

**Sent back to the model** (`formatForModel`): a film with two calls to action, an
unattributed statistic, a beat with no content. Deleting one CTA silently would be
worse than asking — Urlume does not know which one the user wants, and picking
wrongly produces a film that is technically clean and commercially wrong.

## 57.2 Severity and shape

`error` blocks a render (`checkCraft().ok` is false when any error survives).
`warning` is reported and proceeds. A rule is an `error` only when the output would
be **visibly broken** rather than merely worse — hence `linear` on motion, a random
stagger on text and a missing CTA are errors, while pacing and stagger-band issues
are warnings.

```typescript
interface Violation {
  rule: string;
  severity: 'error' | 'warning';
  message: string;
  path: string;        // JSON path, e.g. `scenes[2].transition.fade`
  source: string;      // skill § section this rule derives from
  repairable: boolean;
}

interface CraftRule {
  id: string;
  severity: Severity;
  source: string;
  summary: string;                                    // one line, for the re-ask
  check(sb: Storyboard): Violation[];
  repair?(sb: Storyboard, violations: Violation[]): void;   // only where unambiguous
}
```

Two details make the loop work. `path` is a **real JSON path**, so a violation points
at the exact field rather than describing it in prose — that is what makes both
automatic repair and a precise re-ask possible. And `repair` is optional *per rule*
while `repairable` is a flag *per violation*, because the same rule can produce both
kinds: `single-cta` firing on zero CTAs is unfixable, and `scenes-overlap` is always
fixable.

`repairCraft` works on a `structuredClone`, diffs before against after by
`rule@path`, and reports what it actually fixed rather than what it attempted.

## 57.3 Rules are tested by mutation

A craft rule that does not fire is indistinguishable from a craft rule that
passes. So the mutation harness (`npm run test:mutation`) takes a clean
storyboard, introduces one known violation, and asserts the corresponding rule
catches it. A rule that stops working fails the suite instead of silently
approving bad films.

---

# 58. WHY VALIDATION IS THE ARCHITECTURE

Sections 56 and 57 exist because of one observation that shaped the whole system:

> A model given good instructions produces good output *most* of the time. A film
> is 900 frames of one continuous artefact, and one crossfade where a cut belonged
> is visible for its whole duration.

"Most of the time" is not good enough when the failure is that visible and the
artefact is that indivisible. There is no partial credit in a video.

Which is why the pipeline is built as a **funnel that narrows**:

```text
natural language        unconstrained
      ↓
laws + policy           the model is told, and cannot avoid being told
      ↓
Zod schema              it can only emit one shape
      ↓
craft rules             mechanical violations are repaired
      ↓
re-ask                  judgement violations come back with the rule
      ↓
compiler                deterministic — the model has no reach past here
      ↓
MP4                     reproducible
```

Each stage removes a class of failure permanently. By the time the compiler runs,
a bad film is not unlikely — for the classes of badness the rules cover, it is
unrepresentable.

This is also why the compiler emits HTML rather than the model emitting it. If a
model could write CSS directly, none of the tiers above would bind, and the whole
funnel would collapse into "ask nicely."

---

# 59. DOCUMENTED HAZARDS

Failure modes where the output looks plausible and is wrong. Each one is
documented at its site in the code, because the cost of rediscovering it is a
render.

| Hazard | What happens | Guard |
|---|---|---|
| CSS `transition`/`@keyframes` on a timeline-animated property | freezes at its initial value in export; perfect in preview; **no error** | Tier 0 law + policy injection + `hazards.ts` |
| `opacity < 1` on a scene | becomes a backdrop root; its glass silently flattens | `fade` defaults to 0; the dissolve cap |
| `reducedMotion: reduce` in headless | film CSS neutralises `.camera`; every push-in vanishes | set `no-preference` explicitly |
| Cursor inside a scene | the cut takes the cursor with it | compiler emits it as the last child of `.camera` |
| Wrong script order | engine never mounts; nothing animates | compiler owns the order; `waitForReady` explains it |
| `-framerate` after `-i` | resamples; 30fps of stutter | `buildArgs` places it before |
| `document.fonts.ready` resolving on failure | fallback metrics shift every line break | `fonts.check()` per face |
| `resolution` not matching `aspect` | preview centres correctly, export crops wrongly | schema `superRefine` |
| Unknown ease name | engine degrades to `outQuint`; motion looks *almost* right | schema rejects unknown names |
| `backdrop-filter: url(#lens)` from an external file | never resolves | filter defs inlined in the document |
| Odd frame dimensions | H.264 cannot encode without a scale filter | schema rejects |
| Animated GIF/WebP | keeps advancing while everything else is pinned | **unguarded** — no seek API exists |
| `Math.random()` in film code | non-reproducible | **unguarded** — the engine seeds its own |

The last two are in `UNGUARDED` so nobody assumes coverage that is not there.

---

# 60. IMPLEMENTATION STATUS

The pipeline **runs end to end**: `urlume create <url> --prompt "..."` crawls a
site, analyses it, has a model write a storyboard, validates and repairs it,
compiles a film and renders an MP4. `npm test` is green at 226 tests. What remains
unbuilt is the conversational surface — the interactive agent (§4). The Ink TUI
(§25) exists as a config and doctor surface but does not yet render pipeline
progress.

## Executed and tested

```text
src/storyboard/schema.ts             the contract          28 tests
src/storyboard/craft-rules.ts        13 rules + repair     (same suite)
src/storyboard/generate.ts           the validation loop   20 tests
src/skills/{laws,library,policy}.ts  tiers 0-3             24 tests
src/compiler/{index,scenes,cursor,escape}.ts               23 tests
src/compiler/{theme,layouts}.ts      brand + composition   29 tests
src/providers/{anthropic,openai,gemini}.ts                 27 tests
src/shared/{broadcast,contrast}.ts   US/UK delivery, WCAG  61 tests
src/renderer/captions.ts             WebVTT + SubRip       (same suite)
src/tui/{banner,pickers,doctor}                            13 tests
scripts/extract-runtime.mjs          7 files, 3756 lines
src/browser/{analyze,brand,crawl}.ts run against live sites
src/browser/svg-sanitize.ts          logo markup, untrusted
src/renderer/{index,encode,flash,hazards,errors}.ts         588 frames -> MP4
src/pipeline.ts, src/cli.ts          URL -> MP4
examples/demo-film/storyboard.json   hand-written, 0 craft violations
```

One adapter covers OpenAI, Mistral, and every OpenAI-compatible endpoint (Ollama,
vLLM, LM Studio, OpenRouter, a gateway). §6 lists those as separate providers, but
the wire format is identical and duplicating it would mean fixing each bug five
times.

## Written, typechecks, not wired to the CLI

```text
src/project/{detect,dev-server}.ts   local project mode — remote mode ships first
src/agent/tools.ts                   the tool registry, awaiting the agent loop
```

## Not started

```text
src/agent/loop.ts      the conversational agent (§4, §29)
src/tui/app.tsx        wired to the CLI, but not to PipelineEvent
src/browser/session.ts
tests/{render,mutation}/
3 of the 19 planned skills
```

## Verified how

Every stage was run against a live site (linear.app, stripe.com, vitest.dev) rather
than only unit-tested. The exception is the vendor HTTP call itself, which is
covered by stubbed transports asserting each vendor's request shape — chosen because
those shapes fail silently rather than loudly: a `role: 'system'` entry in
Anthropic's `messages` array is a 400, and Gemini accepts `assistant` while quietly
dropping the turn from the model's view of the conversation.

## Measured

On the demo film (19.6s, 588 frames, 1920x1080, headless Chromium, Windows):

* **~12.7 frames/sec** captured; 46s capture, 122s wall clock with `-preset slow`.
  §31.2 listed this as unmeasured.
* **Two renders produce byte-identical frames** (§55.3, second criterion).
* Glass composites in headless — specular rim and background bleed-through both
  present. Pixel-identical `backdrop-filter: url(#lens)` against *headed* mode
  remains unverified; that needs a headed comparison run.

## What opening a browser actually found

The engine's documentation was right that its visual composition was unverified.
Three defects surfaced on first watch, and all three were in this document's own
compiler rather than in the engine:

1. Four of five element renderers wrote `left`/`top` onto elements with no
   `position`, so every card, metric, button and badge ignored its coordinates and
   stacked in normal flow. `.abs` is what makes a coordinate mean anything.
2. The background wash used three class names the stylesheet does not define
   (`bg-wash`, `bg-orb`, `bg-grain` against the real `bg-aurora`, `bg-vignette`,
   `bg-grid`) *and* sat outside the `.stage` that gets rasterised, so every export
   was a flat black field and the glass had nothing to refract.
3. `cursorTo` only ever fades the cursor in. With one pair for the whole film it
   stayed parked on the payoff and the end card.

Each read as correct source. Each is invisible to a type checker and to every unit
test that does not rasterise. This is the argument for §52 stated as evidence
rather than as principle.

## What a second look found

The same method, applied to a generated film (`clinza33.mp4`) rather than to the
hand-written demo, by sampling it at 1fps into a contact sheet:

```bash
ffmpeg -i film.mp4 -vf "fps=1,scale=440:-1,tile=4x6:padding=6" -frames:v 1 sheet.jpg
```

The film does **not** read as a generic template — palette, layouts, icons and copy
are the actual product, across six distinct compositions. One defect was severe
enough to fix immediately: a `payoff` beat carrying a single metric had been typed
`dashboard`, and `layoutFor` tested content shape only under `feature` and `zoom`.
So the shot the film exists to land — `+40%` — rendered at body size in the corner
of a squat, near-empty browser frame. `statLayout` had been written for precisely
that shot and was unreachable from `dashboard`. The test now sits above the type
switch: **the declared type is the model's word for a scene, the elements are what
it actually contains, and when they disagree the elements are right.**

Four composition defects remain open and are recorded in `MEMORY.md`: vertical dead
space in most scenes, static holds through the middle two beats, web-scale rather
than film-scale type in the grid, and headline position drifting between cuts.

A fifth finding is about the harness rather than the films. Four separate results —
`conformance()`, the flash report, `describeFlashReport`, and `compiled.notes` —
were each computed correctly, cited their standard, and reached no one. Every one
of them looked wired, because the producing code was right and only the consuming
end was missing. **A check that nothing prints is not a check**, and neither a type
checker nor a green suite will say so.

## The gate

`npm install && npm run extract && npm test` passing, then a hand-written
storyboard rendering to a playable MP4 — **both hold.** The last criterion in
§55.3 — that a film has been watched and does not read as a template — now
**partly** holds: a generated film has been looked at end to end and judged not
generic, with the defects above logged rather than fixed. That criterion is not
automatable and is still the only one that finally matters.

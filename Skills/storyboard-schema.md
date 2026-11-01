---
name: storyboard-schema
description: Structuring a film as validated JSON instead of free-form AI text — the schema, the beat vocabulary, mechanically checkable craft rules, and the repair-versus-reask decision. Use when generating, validating, or conversationally editing a storyboard, or when deciding what a model is allowed to emit.
---

# The Storyboard as Data

A model that emits HTML and CSS for a film gives you something that renders once.
A model that emits validated JSON gives you something you can check, diff, edit,
repair, and render identically a year later.

The split: **the AI decides WHAT, WHEN and WHY. The renderer decides HOW.** The
model never writes markup, CSS, or timing code. A deterministic compiler turns
JSON into the film.

## Why free-form output cannot drive a renderer

Four reasons, in order of how much they cost you:

**You cannot validate prose.** "Zoom into the dashboard for four seconds" has no
failure mode short of reading it. `{"camera": {"zoom": 1.8, "dur": 900}}` either
parses or does not.

**You cannot edit prose surgically.** "Remove scene 3" against a JSON document
is an array splice. Against generated code it is a re-generation, and every other
scene changes too because the model does not reproduce its own output.

**You cannot enforce craft rules on prose.** Nothing can check whether a
paragraph crossfades too much. A `transition.kind` field can be counted.

**You cannot reproduce it.** Two calls with the same prompt produce different
code. The same JSON produces the same film forever.

## The schema

The implementation is `src/storyboard/schema.ts`. Its shape:

```ts
{
  version: 1,
  product: string,
  thesis?: string,          // the one idea the film carries
  duration: number,         // ms, authoritative — frame count derives from it
  fps: 24 | 30 | 60,
  aspect: '16:9' | '1:1' | '9:16' | '4:5',
  resolution: { width, height },
  preset: 'apple' | 'light' | 'midnight' | 'warm' | 'mono',
  brand: { accent, scheme, productName, tagline?, fontDisplay?, radius?, logoSvg? },
  scenes: Scene[],
  audio: { enabled, bed }
}
```

And a scene:

```ts
{
  id: string,
  beat: 'hook' | 'stakes' | 'reveal' | 'how' | 'payoff' | 'proof' | 'end',
  type: 'hero' | 'dashboard' | 'feature' | 'scroll' | 'zoom' | 'device'
      | 'text' | 'logo' | 'cta' | 'transition' | 'capture',
  mode: 'rebuild' | 'capture',
  start: number,            // absolute ms; ranges deliberately OVERLAP
  duration: number,
  route?: string,
  transition: { kind: 'cut' | 'dissolve' | 'match' | 'whip', fade: number },
  camera?: { target?, zoom, at, dur, ease },
  copy?: { eyebrow?, headline?, body?, cta?, bodySize? },
  elements: Element[],
  animations: Animation[],
  cursor: CursorGesture[],
  cues: Cue[],
  hold: number              // stillness before the cut
}
```

Three fields carry more weight than their size suggests.

**`mode`.** `rebuild` reconstructs the UI from components using content harvested
from the real site: it can zoom, respond to a cursor, and animate a row sliding
in. `capture` composites real captured frames — pixel-exact, but flat. It goes
soft past about 1.5× push-in and cannot respond to a cursor, so it is the
fallback for pages too custom to rebuild, never the default.

**`start` overlaps deliberately.** Scene ranges are allowed to overlap so the
outgoing scene's motion is still resolving as the incoming one begins. The engine
derives an exclusive *paint window* separately, so an overlap never
double-paints. Do not "fix" an overlap; the overlap is what keeps the film from
stopping at every cut.

**`hold`.** Dead air is a feature. A cut landing the instant motion stops feels
clipped.

## Validate at the schema level where you can

Some errors are cheaper to catch as a parse failure than as a rule:

```ts
// Aspect and resolution must agree, or the preview centres correctly and the
// export crops wrongly — a bug you only find after a full render.
if (sb.resolution.width !== ASPECT_DIMENSIONS[sb.aspect].width) { ... }

// H.264 cannot encode odd dimensions. Better at parse time than at minute nine
// of an encode.
if (sb.resolution.width % 2 !== 0) { ... }

// Scenes must be in timeline order, so a paint window can be derived from
// neighbours.
// The last scene must not run past `duration`, or its tail is cut off.
```

**Enumerate every ease name.** The engine silently falls back to `outQuint` on an
unknown name, so `outExpoo` produces motion that looks *almost* right and never
errors. A schema enum turns that into a parse failure.

## The beat vocabulary

The order is problem-first, and that is the point:

| Beat | Job | Failure mode |
|---|---|---|
| `hook` | **Show** the pain | Opening on your logo |
| `stakes` | One number going the wrong way | Three numbers |
| `reveal` | Hard cut. Product name + one line | A feature list |
| `how` | The only beat with real UI. A crop | The whole app |
| `payoff` | It worked. Let it land | Rushing past it |
| `proof` | Counted numbers, attributed | Unsourced stats |
| `end` | One action, held long enough to read | Three buttons |

**Why problem-first:** a viewer who has not felt the problem has no slot to put
the product into. They hear "AI-powered support automation" and file it next to
forty other tools. Show six identical password-reset tickets stacking up and they
think *"that's my Tuesday"* — now the product answers a question they are already
asking. Recognition → tension → relief.

Not every film uses every beat. The order is what matters.

## Craft rules as validation

This is the part that makes the system work. The rules live in
`src/storyboard/craft-rules.ts`, each citing the skill section it derives from so
the rule and its reasoning cannot drift apart silently.

| Rule | Check | Repairable |
|---|---|---|
| `cuts-not-crossfades` | ≤ 2 dissolves per film | yes |
| `no-linear-on-motion` | No `linear` where x/y/scale/rotate animate | yes |
| `scenes-overlap` | Consecutive ranges overlap ≥ 120ms | yes |
| `film-clock` | Moving entrances ≥ 320ms | yes |
| `overlap-not-queue` | < 200ms dead air between moves | no |
| `stagger-range` | Stagger in 50–200ms | yes |
| `camera-discipline` | Zoom ≤ 2.5×, camera leads the cursor | yes |
| `payoff-hold` | Payoff holds ≥ 600ms | yes |
| `single-cta` | Exactly one CTA | **no** |
| `attributed-stats` | Every statistic has a source | **no** |
| `vary-beat-length` | No two adjacent beats within 150ms | no |
| `readable-type` | Body copy ≥ 24px, scaled by resolution | yes |
| `no-random-stagger-on-text` | No `staggerFrom: random` on text | yes |

Two rules carry exemptions worth understanding, because a validator that fires on
correct work gets switched off.

**`film-clock` exempts UI responding to a cursor.** Film motion runs 1.5–2.5×
slower than UI motion, because the viewer's gaze needs 200–300ms just to cross a
1920px frame. But when a fake cursor clicks a fake button, that button must
respond on the *UI* clock — 90–240ms — because the viewer knows what software
feels like. So the rule skips any animation landing near a cursor's
`at + travel + latency`.

**`attributed-stats` only fires on claims.** A number with a unit or multiplier
is a claim: `3.2×`, `14 hours`, `40%`. A bare small integer is a row count or a
step number. Matching every digit would flag `Ticket 4` and train people to
ignore the validator.

### Writing a checkable rule

```ts
const noLinearOnMotion: CraftRule = {
  id: 'no-linear-on-motion',
  severity: 'error',
  source: 'saas-explainer-motion § Easing',
  summary: 'Never `linear` on a moving element — it is the most recognisable ' +
           'amateur tell. Entrances ease out.',
  check(sb) {
    const out = [];
    sb.scenes.forEach((scene, si) => {
      scene.animations.forEach((a, ai) => {
        const moves = a.x || a.y || a.scale || a.rotate;
        if (a.ease === 'linear' && moves) {
          out.push({ path: `scenes[${si}].animations[${ai}].ease`, /* ... */ });
        }
      });
    });
    return out;
  },
  repair(sb, violations) { /* set ease to outQuint */ },
};
```

Four things every rule needs:

- **`source`** — the skill section it comes from. A rule without one cannot be
  traced back to the reasoning that justifies it.
- **`summary`** — one line, sent to the model on a re-ask. This is what the model
  reads, so it must state the rule *and* why.
- **`path`** — a JSON path, so the model knows exactly where to fix.
- **`severity`** — `error` blocks the render; `warning` is reported.

Note that `linear` on a pure opacity fade is *fine*. Linear is only a tell on
something that moves, because a fade has no start or stop to shape. A rule that
banned it outright would be wrong.

## Repair versus re-ask

```ts
const { storyboard, repaired, remaining } = repairCraft(draft);
if (remaining.length) {
  const response = await provider.generate({
    messages: [...history, { role: 'user', content: formatForModel(remaining) }],
  });
}
```

**Repair what is unambiguous.** A `linear` ease has one correct replacement. A
zoom of 3.2× clamps to 2.5. A missing payoff hold becomes 750ms. Nothing is lost
by fixing these silently.

**Send content decisions back.** Two calls to action is a violation, but *which
one to keep* is a decision about the film's purpose. Deleting one arbitrarily
could remove the one the whole film was built toward. Same for an unsourced
statistic: only the author knows whether a source exists or the claim should be
cut.

**Repair must not mutate its input.** Clone first. A caller comparing before and
after needs both.

**Repair one scene without moving the rest.** When opening a scene overlap, shift
starts — never durations. Changing a duration to fix an overlap silently
re-times every animation inside that scene.

## Prompting for JSON that validates

Raise the odds, then validate anyway:

- **Use the provider's JSON mode** where it exists. It stops prose wrappers; it
  does not guarantee your schema.
- **Give one complete example** in the prompt. Models match a demonstrated shape
  far more reliably than a described one.
- **Send the rules with the request**, not just on failure. The rule text in
  Tier 3 policy is cheaper than a repair round trip.
- **Low temperature.** The *film* is creative; the JSON is a structured document.
- **Extract defensively.** Models wrap JSON in prose and fences regardless of
  instructions. Brace-match rather than regex, and be string-aware — a `}` inside
  a copy string will otherwise end the object early.

## Versioning

`version: 1` is a literal in the schema, and a stored storyboard carries it.

Bump it only when a change would stop an existing storyboard from rendering.
Adding an optional field does not; renaming a scene type does. On a bump, write a
migration from the previous version rather than failing — someone's approved
storyboard from last month should still render.

## Common mistakes

| Symptom | Cause |
|---|---|
| Film feels like a slideshow | Every transition is a dissolve; cut instead |
| Motion stops at every cut | Scene ranges butt-join instead of overlapping |
| Elements from the previous scene linger | Paint windows not derived; ranges overlapping *is* correct |
| A move reads as generic despite a named ease | Ease name misspelled; the engine fell back to `outQuint` |
| Preview centres correctly, export crops wrongly | `aspect` and `resolution` disagree |
| Encode fails after a long render | Odd dimensions; validate at parse time |
| The last second is missing | Scenes run past `duration` |
| Numbers on screen read as marketing | Unattributed statistics |
| Viewer does not act | Two calls to action; they make neither |
| Motion feels twitchy | UI-clock timings on film motion |
| A validator gets switched off | It fires on correct work — check the exemptions |
| Editing a scene re-times the whole film | Regenerating instead of mutating the structure |
| Repair changed something it should have asked about | A content decision was treated as repairable |

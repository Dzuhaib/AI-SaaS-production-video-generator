---
name: kinetic-typography
description: Type as motion in a product film — film-scale type, word budgets, masked line reveals, word and char stagger, typewriter effects, and the determinism constraint on line splitting. Use when animating headlines, body copy or numbers, or when text in a film feels small, cluttered or cheap.
---

# Kinetic Typography

Text in a film is not text on a page. It is on screen for two seconds, at a
distance, often at a quarter of its authored size in a feed, and competing with
motion for the same attention. Everything below follows from that.

## Film type is much larger than UI type

| Token | Size | Use |
|---|---|---|
| `--fs-hero` | 104px | One phrase, once |
| `--fs-display` | 72px | Scene headlines |
| `--fs-title` | 48px | Section titles |
| `--fs-headline` | 34px | Card headings |
| `--fs-body` | 24px | **The floor for anything that matters** |
| `--fs-caption` | 18px | Attribution, labels |
| `--fs-label` | 14px | Inside mocked UI only |

**Body copy never goes below 24px on a 1920 stage.** Text at 16px is one of the
clearest tells of a template — it is a web size, not a film size, and it signals
that nobody thought about the medium.

`--fs-label` at 14px exists for labels *inside* a mocked interface, where small
type is realistic. It is not for the film's own copy.

## Six to nine words per screen

The viewer is watching motion. Anything longer competes with the animation and
loses.

**Reading time is a hard constraint on how long a beat can hold.** A reader
processes roughly 4–5 words per second when scanning, and needs 200–300ms just to
move their gaze to where the text appeared. Nine words therefore needs about two
seconds on screen minimum — before you add the entrance animation or the hold.

If a line will not fit in nine words, the beat contains two ideas. Split it.

## Tracking and line height move opposite ways

As size grows, tracking tightens and line height falls.

| Size | Tracking | Line height |
|---|---|---|
| Hero 104px | `-0.045em` | 1.03 |
| Display 72px | `-0.032em` | 1.06 |
| Title 48px | `-0.021em` | 1.15 |
| Body 24px | `-0.010em` | 1.5 |
| Eyebrow 14px | `+0.085em` | 1.2 |

**Why:** letter spacing that looks correct at 16px looks loose at 104px, because
the gaps scale with the glyphs while the eye's tolerance does not. The `--track-*`
tokens already encode this.

**When you bring in a new display face, check its tracking at hero size.** The
tokens are calibrated for SF Pro Display. Most faces need less negative tracking,
and serifs often need none at all — Instrument Serif at `-0.045em` collides.

## One display face, one text face

Three faces reads as indecision. Weight and size give you all the hierarchy you
need.

```css
:root {
  --font-display: "Instrument Serif", Georgia, serif;
  --font-text: "Inter", -apple-system, sans-serif;
}
```

**Self-host the woff2.** `document.fonts.ready` resolves when loading *finishes* —
including when it finishes by failing. So a CDN link that 404s on the render
machine reports ready, renders in a fallback with different metrics, and changes
every line break in the film. No error appears anywhere.

## Reveal techniques, ranked

### 1. Masked line reveal — the workhorse

A clipping parent with the text sliding up inside it. The line appears to emerge
from behind an invisible edge, which reads as deliberate rather than as a fade.

```html
<div class="line-mask"><span>Every password reset,</span></div>
<div class="line-mask"><span>handled.</span></div>
```

```js
s.add('.line-mask > span', {
  at: 300, dur: 900, ease: 'outExpo',
  stagger: 90,
  y: [110, 0],       // percentage of its own height, set in CSS as a translate
});
```

The mask is `overflow: hidden` on the parent. **Do not put `opacity` on the
parent** — if the text sits over glass, an ancestor below 1 opacity becomes a
backdrop root and flattens the material.

### 2. Word stagger

For a phrase where the individual words carry meaning.

```js
const words = splitText('[data-el="headline"]', 'words');
s.add(words, {
  at: 400, dur: 620, ease: 'outQuint',
  stagger: 70, staggerFrom: 'start',
  opacity: [0, 1], y: [24, 0],
});
```

70ms is the useful stagger for words. Below 50 they read as simultaneous; above
120 the sentence feels like a list.

### 3. Character stagger — sparingly

Char stagger fragments meaning. The viewer decodes letters instead of reading
words, which is the opposite of what a headline is for.

Use it on a single short word — a product name, a number — and never on a
sentence.

### 4. Whole-block fade and rise

The honest default when the text is not the point.

```js
s.add('[data-el="body"]', { at: 600, dur: 700, ease: 'outQuart',
                            opacity: [0, 1], y: [18, 0] });
```

### 5. Gradient text — one phrase per film

`.t-grad` on one phrase is a highlight. On two it is a pattern; on three it is a
template.

## Never random stagger on text

```js
staggerFrom: 'random'   // never on text
```

Random order destroys reading direction. The eye cannot assemble a sentence whose
words arrive out of sequence, and the viewer spends the beat re-reading instead of
listening.

`start` is correct almost always. `end` works when the eye should finish at the
top. `center` and `edges` suit symmetric layouts. `random` is for decorative
particles, not language.

## `splitText('lines')` splits on markup, not measurement

```js
splitText(el, 'lines');   // splits on literal <br> and \n only
```

**It deliberately does not measure rendered line boxes.** Measuring would depend
on font metrics, which differ between your authoring browser and the headless
renderer — and that would make the export non-deterministic: the film would break
lines differently in the video than in the preview.

So **author your line breaks by hand**:

```html
<div class="t-display">Every password reset,<br>handled.</div>
```

This is more work and it is why the export is reliable. A hand-authored break is
also usually a better break than an automatic one, because you can break on
meaning.

## Typewriter effects

```js
tl.type('[data-el="prompt"]', {
  at: 1200, dur: 1600, ease: 'linear', caret: true,
});
```

`linear` is correct here — typing has constant rate, and there is no start or stop
to shape. This is one of the two places `linear` belongs.

**When a typewriter is honest:** a code editor, a search box, an AI prompt.
Something the viewer believes a person is typing.

**When it is a gimmick:** a headline. A headline is not typed, and animating it
character by character reads as a screensaver.

**Give the container a fixed width**, or reflow shoves the surrounding layout on
every character:

```css
[data-el="prompt"] { width: 720px; }
```

The caret blinks off `t`, so it never desyncs under export. Do not add a CSS
blink animation — it would freeze at whatever phase it had reached.

## Let the visual land before the words

Roughly 600ms.

**Why:** the copy should confirm what the viewer already noticed, which reads as
agreement. Text arriving first makes the same sentence an assertion, and the
viewer has to take it on trust rather than having just seen it.

```js
s.add('[data-el="ticket"]',  { at: 300,  dur: 620, ease: 'outExpo', stagger: 190, /* ... */ });
s.add('[data-el="headline"]', { at: 1400, dur: 800, ease: 'outQuint', /* ... */ });
```

Six near-identical tickets stack up, *then* the headline names the problem.

## Numbers need `.tnum`

```html
<div class="t-display tnum" data-el="metric">0</div>
```

Without tabular figures, digit widths differ — a `1` is narrower than a `4` — so a
counting number changes width on every tick and the whole line wobbles.

## Orphans at hero size

A single word alone on the last line of a hero headline is far more visible at
104px than at 16px. Fix it with an explicit break or a non-breaking space, not by
rewording something that already reads well.

## Text over photos

**Use a scrim, never lowered image opacity.** A dark gradient over the image under
the text preserves the photograph; reducing the image's opacity greys the whole
frame and makes the film look washed.

And a scrim is a wrapper concern: fading the image itself is fine, fading a
wrapper that contains glass flattens the glass.

Check contrast against the *composited* result, not against the image's average.

## The 25% test

Shrink the film to a quarter size and watch it. That is roughly a phone in a feed.

Every word that matters must still be legible. Anything that fails at 25% either
grows or goes.

## Common mistakes

| Symptom | Cause |
|---|---|
| Film looks like a template | Body copy at 16px; the floor is 24px |
| Text feels cluttered | More than nine words on screen |
| Viewer cannot finish reading before the cut | Reading time not budgeted into the hold |
| Hero type looks loose | Tracking not tightened at size, or a new face using SF-calibrated tokens |
| Line breaks differ between preview and export | Relied on measured line splitting, or a webfont fell back |
| Headline reads as a screensaver | Character stagger on a sentence |
| Sentence unreadable | `staggerFrom: 'random'` on text |
| Counting number makes the line wobble | Missing `.tnum` |
| Layout jumps on every typed character | Typewriter container has no fixed width |
| Caret frozen in the export | CSS blink animation instead of the engine's `t`-derived caret |
| Copy reads as a claim rather than an observation | Text landed before the visual it names |
| Glass behind text went flat | `opacity` animated on the mask or a wrapper |
| Whole frame looks washed out | Lowered image opacity instead of a scrim |
| Words illegible in a feed | Never checked at 25% scale |

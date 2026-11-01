---
name: vertical-social-reformat
description: Taking a 16:9 film to 9:16, 4:5 and 1:1 — why a vertical cut is a re-composition rather than a crop, safe areas per platform, type scale steps, and re-shooting camera moves for a tall frame. Use when a film needs a vertical or square version, or when deciding aspect ratio before laying out scenes.
---

# Vertical and Social Reformats

**Settle the aspect ratio before writing any scenes.** Positions inside a scene
are hand-placed pixels, so changing aspect afterwards means re-laying out every
scene in the film. It is the one decision that is genuinely expensive to change
late.

## The aspects

| Aspect | Pixels | Where |
|---|---|---|
| `16:9` | 1920×1080 | Landing pages, YouTube, decks. Default. |
| `1:1` | 1080×1080 | Square feed |
| `9:16` | 1080×1920 | Stories, Reels, Shorts, TikTok |
| `4:5` | 1080×1350 | Portrait feed |

Set it in two places, and keep them in agreement:

```html
<html lang="en" data-preset="apple" data-aspect="9:16">
```
```js
var tl = new Timeline({ duration: 24000, fps: 60, width: 1080, height: 1920 });
```

`data-aspect` sets the canvas on first paint and steps the type scale down. The
Timeline dimensions are the source of truth for export. **If the two disagree you
get a correctly-centred preview and a wrongly-cropped video** — the engine warns in
the console, and the export follows the Timeline.

## A vertical cut is a re-composition, not a crop

Cropping 1920×1080 to 9:16 leaves you two bad options:

- **Crop the width.** You keep a 608px-wide strip of a 1920px composition. Two
  thirds of every scene is gone, including most of what was placed deliberately.
- **Scale to fit the width.** The whole 1920px frame becomes 1080px wide — a
  0.56× scale — so 104px hero type renders at 58px and 24px body copy at 13px.
  Illegible in a feed.

Neither is a reformat. Both are a damaged version of the original.

**Two cuts share one timeline and are two compositions.** Same beats, same
durations, same cues, same audio — different layout per scene. Structure the film
so the timing lives in one `SCENES` table and each cut has its own positions.

## What changes when you go tall

**Stack what was side-by-side.** A hero with copy left and a device right becomes
copy above, device below. This is the main structural move, and it is why the type
below the fold has to be shorter.

**Narrow text blocks from ~940px to ~880px.** A 1080-wide frame with an 80px safe
area each side leaves 920px; 880px keeps a margin so the text does not touch the
guides.

**Keep an 80px safe area top and bottom.** Platform UI eats it — captions,
usernames, action buttons, progress bars.

**Step the type scale down.** `data-aspect` does this automatically, but check the
result: 104px hero type that reads at 1920 wide is absurd at 1080 wide. Roughly
0.7× is the right neighbourhood, with body copy holding at 24px minimum because
that is a legibility floor, not a proportion.

**Fewer elements per scene.** A tall frame has less horizontal room for a
supporting column, so a scene that held a headline, three feature cards and a
device now holds a headline and two cards.

## Safe areas by platform

Verify against current platform docs before a launch — these change, and I cannot
check them from here. Treat them as the neighbourhood, not as gospel.

| Platform | Frame | Top | Bottom | Sides |
|---|---|---|---|---|
| Instagram Stories | 1080×1920 | ~250px | ~250px | ~60px |
| Instagram Reels | 1080×1920 | ~120px | ~380px | ~60px |
| TikTok | 1080×1920 | ~130px | ~480px | ~70px |
| YouTube Shorts | 1080×1920 | ~110px | ~330px | ~60px |
| Instagram feed 4:5 | 1080×1350 | ~60px | ~60px | ~40px |
| Square feed | 1080×1080 | ~50px | ~50px | ~40px |

**Reels and TikTok have deep bottom exclusions** — caption text, the audio
attribution, and a column of action buttons on the right. Never put a CTA in the
bottom third of a 9:16 cut.

The right column matters too: action buttons occupy roughly the right 140px on
TikTok and Reels. Keep anything load-bearing out of it.

## Camera moves need reconsidering

A horizontal push that worked in 16:9 often does not read in 9:16.

- **A horizontal pan has almost nowhere to go.** In a 1080-wide frame there is not
  enough lateral room for a pan to feel like travel.
- **Vertical moves work better.** A tall frame invites a push down a list or up a
  page, which is also what the format's viewers do with their thumbs.
- **Zooms translate directly.** A push-in on a component works in any aspect;
  re-aim the target, since the component sits somewhere else now.

Re-derive camera targets from `tl.point()` on the element rather than reusing
coordinates — the numbers from the 16:9 cut are wrong by construction.

## Duration and attention

| Context | Length | Behaviour |
|---|---|---|
| Landing-page hero loop | 6–12s, loops | Muted, glanced at, seen repeatedly |
| Feed video | 15–30s | Muted, thumb hovering, one chance |
| YouTube | 30–90s | Sound likely on, chose to watch |

A feed viewer did not choose to watch. **The first second decides everything**, and
motion must begin before frame 15 in a vertical cut — sooner than the frame 30 that
suffices in 16:9.

## Muted by default

Vertical formats autoplay muted, so **on-screen text is not optional** the way it
sometimes is in a 16:9 film with narration.

Every claim the voice would have made needs a visual or a caption. And the copy has
to be shorter than the 16:9 cut's, because a tall frame has less room per line and
the viewer is moving faster.

## When square is the pragmatic answer

`1:1` is the compromise that works everywhere: it does not waste as much space as
16:9 in a vertical feed, and it does not need the full re-composition 9:16 does.

Use it when there is budget for two cuts rather than three, or when the film will
be posted across several platforms with no time to tailor each. It is nobody's
favourite aspect and it is never badly wrong.

## Working across two cuts

Keep timing in one place and positions in two:

```js
// shared.js — one source of truth for the film's timing
export const SCENES = {
  hook:   [0,     5200],
  reveal: [4900,  4600],
  how:    [9200, 10000],
  end:    [18800, 3800],
};
export const CUES = [{ name: 'pop', at: 300 }, /* ... */];
```

```js
// timeline.16x9.js  /  timeline.9x16.js
// Same beats, same times. Different positions, different type scale,
// different camera targets.
```

**Do not try to make one file serve both with a CSS switch.** Positions differ per
scene, elements are dropped in the vertical cut, and camera moves are re-aimed. A
conditional in every `add()` call is harder to read than two files, and it hides
which cut you are actually looking at.

## Common mistakes

| Symptom | Cause |
|---|---|
| Vertical cut is unreadable | Scaled a 16:9 composition to fit 1080 wide |
| Two thirds of every scene is missing | Cropped instead of re-composing |
| Preview centres correctly, export crops wrongly | `data-aspect` disagrees with the Timeline dimensions |
| CTA hidden behind platform UI | Placed in the bottom third of a 9:16 frame |
| Copy overlaps the action buttons | Ignored the right-column exclusion on Reels/TikTok |
| Hero type looks absurd | Type scale not stepped down for the narrower frame |
| Body copy illegible in a feed | Fell below 24px; that is a floor, not a proportion |
| Pans feel pointless | Horizontal camera moves in a tall frame |
| Camera lands off target | Reused 16:9 coordinates instead of re-deriving from the element |
| Viewers scroll past | Motion starts too late for a feed |
| Nothing makes sense muted | Relied on narration in an autoplay-muted format |
| Every scene feels cramped | Same element count as the 16:9 cut |
| Timing drifts between cuts | Scene times duplicated instead of shared |

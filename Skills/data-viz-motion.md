---
name: data-viz-motion
description: Animating numbers, charts and metrics in a product film — counters, bar and line reveals, progress rings, the one-number rule, and statistic attribution. Use when a film shows data, a metric, a chart or a KPI, or when numbers on screen read as marketing noise.
---

# Data in Motion

A number on a slide is a fact the viewer skims. The same number counting up is an
event they watch. The difference costs three lines of code and is most of what
makes a proof beat land.

## One number, not three

**Two numbers halve the impact of each. Three is a dashboard, and nobody feels
anything about a dashboard.**

A `stakes` beat is one metric going the wrong way. A `proof` beat is one metric
going the right way. If a second number seems necessary, it is usually because the
first one is not carrying the argument — fix the first.

The exception is a *comparison*: two values that exist only in relation to each
other (before/after, us/them). That reads as one idea with two halves, not as two
ideas.

## Attribution is not optional

An unattributed statistic is worse than no statistic. "3.2× faster responses"
with no source reads as marketing noise, and it quietly discounts everything else
on screen — including the claims that *are* true.

```html
<div class="t-display tnum" data-el="metric">0</div>
<div class="t-caption" data-el="source">internal data, 240 teams, Q2 2025</div>
```

Numbers on a marketing site are claims, not facts. If one goes on screen,
attribute it as the site does. **With no source available, use a qualitative
beat** — show the outcome happening rather than asserting a multiple.

## Counters

```js
tl.count('[data-el="metric"]', {
  at: s.start + 400,
  dur: 1600,
  ease: 'outExpo',
  from: 0,
  to: 3.2,
  decimals: 1,
  suffix: '×',
});
```

**`.tnum` on the element is mandatory.** Without tabular figures a `1` is
narrower than a `4`, so the number changes width on every tick and the whole line
wobbles. This is the most common defect in animated metrics.

**1200–1800ms** for the run-up. Faster and the viewer sees a flicker rather than a
count; slower and they finish reading the final value before it arrives.

**`outExpo`** so it decelerates into its final value. The number should feel like
it is *settling* on an answer. `linear` counting reads as a loading spinner, and
`outBack` overshoots past the real figure, which is actively misleading.

Note `tl.count` is called on `tl` with an absolute time — the scene helper does
not proxy it.

## Bars

Animate `scaleY`, not `height`.

```html
<div class="chart" data-el="chart">
  <div class="bar" data-el="bar" style="left:0px;   height:180px;"></div>
  <div class="bar" data-el="bar" style="left:96px;  height:240px;"></div>
  <div class="bar" data-el="bar" style="left:192px; height:140px;"></div>
  <div class="bar" data-el="bar" style="left:288px; height:300px;"></div>
</div>
```

```css
.bar { transform-origin: 50% 100%; }   /* grow from the baseline, not the centre */
```

```js
s.add('[data-el="bar"]', {
  at: 300, dur: 720, ease: 'outQuart',
  stagger: 90, staggerFrom: 'start',
  scaleY: [0, 1],
});
```

**Why not `height`:** `height` triggers layout on every frame; `scaleY` is a
compositor property. At four bars the difference is invisible, but the habit
matters — and `scale` composes with other transforms while `height` does not.

**`transform-origin: 50% 100%` is load-bearing.** Without it the bar grows from
its centre in both directions and appears to sink into the axis.

**Put labels outside the bar.** `scaleY` distorts everything inside it, so a value
label within the bar stretches from 0 to its real height. Position labels as
siblings, and fade them in rather than scaling them.

## Line charts

```html
<svg class="chart" viewBox="0 0 480 240">
  <path class="chart-line" data-el="line"
        d="M0 200 L120 150 L240 168 L360 90 L480 40"
        fill="none" stroke="var(--accent)" stroke-width="3"/>
</svg>
```

```js
tl.draw('[data-el="line"]', { at: s.start + 400, dur: 1100, ease: 'outQuart' });
```

`tl.draw` measures the path with `getTotalLength()`, sets `stroke-dasharray`, and
animates `stroke-dashoffset` from full length to zero — so the line draws itself
left to right.

Two requirements: the path needs a **stroke**, and it must have **no
`stroke-dasharray` of its own** or the measurement is meaningless. A zero-length
path is skipped silently.

**Do not use `<use>`.** A `<symbol>` instantiated with `<use>` clones into a
shadow tree, so `querySelectorAll` cannot reach the cloned `<path>` — `tl.draw`
finds nothing to measure and does nothing, with no error. Paste the real path in.

## Area fills

Reveal with a `clip-path` wipe rather than fading:

```js
s.add('[data-el="area"]', {
  at: 500, dur: 1000, ease: 'outQuart',
  clipPath: ['polygon(0% 0%, 0% 0%, 0% 100%, 0% 100%)',
             'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)'],
});
```

**Vertex counts must match** — four points in both shapes. Structural
interpolation lerps the numbers pairwise, so a three-point shape against a
four-point shape cannot interpolate.

A wipe reads as the data arriving. A fade reads as an image loading.

## Progress rings

```html
<svg viewBox="0 0 120 120">
  <circle class="donut-track" cx="60" cy="60" r="52" fill="none" stroke-width="10"/>
  <circle class="donut-fill" data-el="ring" cx="60" cy="60" r="52"
          fill="none" stroke-width="10" stroke-linecap="round"
          transform="rotate(-90 60 60)"/>
</svg>
```

```js
const C = 2 * Math.PI * 52;   // 326.7

s.add('[data-el="ring"]', {
  at: 400, dur: 1400, ease: 'outExpo',
  '@stroke-dasharray': [`0 ${C}`, `${C * 0.78} ${C}`],   // fills to 78%
});
```

The `@` prefix writes via `setAttribute` rather than as a style. `rotate(-90)`
starts the arc at twelve o'clock, which is where a viewer expects a gauge to
begin.

Compute the circumference from the radius rather than hard-coding it, or the
animation silently breaks the first time someone resizes the ring.

## Series stagger

70–110ms between members of a series. The eye then reads the chart left to right
as a sequence rather than taking the whole thing as one flash.

Never `staggerFrom: 'random'` on a chart — the order carries meaning.

## Chart furniture at film scale

Axis labels and gridlines are usually too small and too dark when carried over
from a web chart.

- Axis labels: `--fs-caption` (18px) minimum. 11px axis text is texture.
- Gridlines: barely visible. `--label-4` alpha. They orient the eye; they are not
  content.
- **Four or five data points, not twenty.** A film chart makes one point.
- Drop the legend. If a chart needs a legend, it has too many series for a film.

## Do not animate a chart nobody has been given a reason to read

A chart that appears with no setup is furniture. The viewer sees "a chart" and
waits for the next thing.

Give it a reason first — the claim, the question, the metric name — and *then*
animate the chart as the answer. The order is the same as everywhere else in a
film: the visual confirms something the viewer is already wondering about.

## Common mistakes

| Symptom | Cause |
|---|---|
| Counting number makes the line wobble | Missing `.tnum` tabular figures |
| Counter reads as a loading spinner | `linear` easing; use `outExpo` |
| Counter overshoots past the real figure | `outBack` on a number — misleading, not playful |
| Bars sink into the axis as they grow | `transform-origin` not set to `50% 100%` |
| Bar labels stretch | Label inside the bar being `scaleY`'d; move it outside |
| Chart animation stutters | Animating `height` instead of `scaleY` |
| `tl.draw` does nothing | Path has no stroke, has its own dasharray, or is inside a `<use>` |
| Area fill snaps at the midpoint | Mismatched vertex counts in the two `clip-path` shapes |
| Ring fills from the wrong angle | Missing `rotate(-90)` |
| Ring breaks after a resize | Circumference hard-coded instead of computed from `r` |
| Nobody remembers any of the numbers | Three metrics shown; use one |
| Numbers read as marketing | No attribution |
| Chart reads as furniture | Animated before the viewer had a reason to read it |
| Axis text unreadable | Web-scale chart furniture carried into a film |

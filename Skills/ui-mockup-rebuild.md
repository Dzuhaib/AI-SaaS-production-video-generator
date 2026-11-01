---
name: ui-mockup-rebuild
description: Rebuilding a real product's interface out of animatable glass components — density reduction, the component vocabulary, data-el hooks, the backdrop-root trap, and when to composite a screenshot instead. Use when building the UI shown in a film, or when a mocked interface reads as a wireframe or a screenshot.
---

# Rebuilding Product UI

A screenshot cannot zoom, cannot respond to a cursor, cannot animate a row
sliding in, and goes soft the moment the camera pushes past ~1.5×. Rebuilding the
interface out of live components is more work, and it is the entire difference
between a demonstration and a slideshow.

The division of labour: **the real site supplies truth** — real copy, real
labels, real accent, real layout shape. **The rebuild supplies motion.**

## Reproduce their layout, simplify their density

This is the rule that most affects whether the result reads.

A real app has forty rows, nineteen nav items, six toolbar buttons and a
breadcrumb. The rebuild has **four rows and five nav items.**

**Why:** a full app screenshot at 1920px wide renders every label at 11px. On
screen, at a glance, that is texture — not information. Forty rows is a
screenshot; four rows is a demonstration, because the eye can actually read them.

| Real app | Rebuild |
|---|---|
| 40 table rows | 4 rows |
| 19 nav items | 5 nav items |
| 8 metric cards | 3 cards |
| Full page | Sidebar + rows + one focal panel |

Keep their *structure* and their *labels*. Cut their *quantity*.

## Show a crop, not the app

The `how` beat is the only one with real interface, and it is the one most often
ruined by showing everything. Sidebar, four rows, one focal panel. Enough to read
as software; few enough that the eye knows where to look.

If a beat needs the whole app to make sense, it is two beats.

## The component vocabulary

These class names exist in the engine's stylesheet. Use them; do not invent
parallel ones.

| Group | Classes |
|---|---|
| Browser | `.browser` `.browser-bar` `.browser-url` `.dot` |
| App shell | `.app` `.sidebar` `.side-brand` `.nav-item` `.topbar` `.content` |
| Surfaces | `.card` `.metric` `.badge` |
| Controls | `.btn` `.btn-primary` `.field` `.switch` `.avatar` |
| Lists | `.rows` `.row-item` `.th` |
| Kanban | `.board` `.col` `.kcard` |
| Charts | `.chart` `.bar` `.chart-line` `.chart-area` `.donut-track` `.donut-fill` |
| Code | `.code` `.tok-key` `.tok-str` |
| Overlays | `.toast` `.tooltip` |
| Cursor | `.cursor` `.click-ring` |
| Progress | `.bar-track` `.bar-fill` `.skeleton` |
| Mobile | `.phone` `.phone-screen` |
| Lockup | `.logo-lockup` |

**`.browser-frame` and `.panel` do not exist.** The real names are `.browser` and
`.card`. Older notes reference the wrong ones.

Everything reads from CSS custom properties — `--accent`, `--bg-elev-1..4`,
`--label-1..4`, `--r-sm/md/lg/xl`, `--fs-*`, `--glass-fill` — so setting one
accent restyles the whole mockup.

## Components are drawn at ~1.35× native

Body 17px, labels 13px, row height 52px. A real app's 14px body text becomes
noise at film scale.

**Nothing below ~13px for text that matters.** If a label must be smaller than
that to fit, the layout is too dense — cut something.

## A dashboard crop

```html
<div class="browser" data-el="frame" style="left:210px; top:150px; width:1500px;">
  <div class="browser-bar">
    <span class="dot dot-r"></span>
    <span class="dot dot-y"></span>
    <span class="dot dot-g"></span>
    <span class="browser-url">relay.app/tickets</span>
  </div>

  <div class="app">
    <aside class="sidebar">
      <div class="side-brand"><span class="side-mark"></span> Relay</div>
      <div class="nav-item is-active" data-el="nav-1"><span class="ico"></span> Inbox</div>
      <div class="nav-item" data-el="nav-2"><span class="ico"></span> Tickets</div>
      <div class="nav-item" data-el="nav-3"><span class="ico"></span> Customers</div>
      <div class="nav-item" data-el="nav-4"><span class="ico"></span> Reports</div>
      <div class="nav-item" data-el="nav-5"><span class="ico"></span> Settings</div>
    </aside>

    <div class="content">
      <div class="topbar">
        <h3>Tickets</h3>
        <button class="btn btn-primary" data-el="send-btn">Send reply</button>
      </div>

      <div class="rows" data-el="rows">
        <div class="row-item" data-el="row"><span class="name">Password reset</span>
          <span class="badge badge-warn">Waiting</span></div>
        <div class="row-item" data-el="row"><span class="name">Cannot log in</span>
          <span class="badge badge-warn">Waiting</span></div>
        <div class="row-item" data-el="row"><span class="name">Reset link expired</span>
          <span class="badge badge-warn">Waiting</span></div>
        <div class="row-item" data-el="row"><span class="name">2FA code not arriving</span>
          <span class="badge badge-ok">Resolved</span></div>
      </div>

      <div class="card glass" data-el="draft">
        <div class="t-caption">Suggested reply</div>
        <div class="t-body" data-el="draft-text"></div>
      </div>
    </div>
  </div>
</div>
```

Note what the labels are doing. Four near-identical password tickets *are* the
argument of the hook beat — the repetition carries it, and the headline only names
what the viewer already noticed.

## Hook animation targets with `data-el`

Classes are for styling and get reused; `data-el` names a thing the timeline
drives.

```js
s.add('[data-el="row"]', { at: 200, dur: 640, ease: 'outQuint',
                           stagger: 90, opacity: [0, 1], y: [20, 0] });
```

One selector, four rows, staggered. If those rows were targeted by `.row-item`,
the same selector would also catch rows in every other scene.

## Keep the DOM shallow

Every ancestor between `.stage` and a glass panel is a chance to break it.

**The backdrop-root trap:** any element with `opacity < 1`, `filter`, `mask`,
`clip-path`, or `will-change` on those properties becomes a backdrop root, and
every `backdrop-filter` beneath it silently goes flat. No error — the glass just
turns into a grey rectangle.

This produces one concrete authoring rule:

> **Animate `transform` on the wrapper. Animate `opacity` on the glass element
> itself.**

```js
// Wrong — fading the wrapper flattens the glass inside it for the whole fade.
s.add('[data-el="card-wrap"]', { at: 0, dur: 800, opacity: [0, 1], y: [24, 0] });

// Right — the wrapper moves, the glass element fades.
s.add('[data-el="card-wrap"]', { at: 0, dur: 800, ease: 'outQuint', y: [24, 0] });
s.add('[data-el="card"]',      { at: 0, dur: 600, ease: 'outQuart', opacity: [0, 1] });
```

`transform` is safe: it does *not* create a backdrop root, which is why the
camera can push in freely.

## A cursor makes it a demonstration

Without a cursor, a mockup is a picture of software. With one, someone is being
shown something.

```js
const c = tl.cursorTo('[data-el="send-btn"]', { at: s.start + 6300 });

tl.add('[data-el="send-btn"]', { at: c.pressAt, dur: 110, ease: 'outCubic',
                                 scale: [1.04, 0.96] });
tl.cue('click', c.pressAt);
// respondAt already includes the latency beat — do not add another.
tl.add('[data-el="draft"]', { at: c.respondAt, dur: 620, ease: 'outQuint',
                              opacity: [0, 1], y: [16, 0] });
```

**Aim at elements, never coordinates.** Hand-written arithmetic — *frame at
(160,88) + bar 46 + sidebar 232* — is correct exactly once, and then someone adds
a nav item and every click in the film lands two pixels off a button edge. It
never looks like a bug; it looks sloppy.

## When to composite a screenshot instead

Rebuilding is the default. Fall back to `mode: 'capture'` when:

- The UI is a canvas, a map, a 3D viewport, or a video editor timeline
- The page is genuinely bespoke and a rebuild would misrepresent it
- The beat is about *breadth* — "look how much is here" — rather than a detail

What you give up: the camera cannot push past ~1.5× before it goes soft, the
cursor cannot drive anything, nothing can animate in, and the accent cannot be
adjusted for contrast.

So keep captured content in wide shots and static holds, and never push into it.

## Common mistakes

| Symptom | Cause |
|---|---|
| Mockup reads as a wireframe | No icons, no real labels, everything grey |
| Labels unreadable on screen | Real app density; cut to 4 rows and 5 nav items |
| Reads as a screenshot | Whole app shown instead of a crop |
| Glass panels look like grey rectangles | An ancestor has `opacity < 1`, `filter`, `mask` or `clip-path` |
| Glass flattens only during an entrance | Fading the wrapper; fade the glass element instead |
| Animation hits elements in other scenes | Targeted by class, not `data-el` |
| Click ring blooms beside the cursor | Hand-written coordinates, or a cursor whose tip is not at the path origin |
| UI responds instantly and reads as fake | No latency; use `respondAt` |
| Content goes soft when the camera pushes in | Captured screenshot instead of a rebuild |
| Text in a phone frame is illegible | Not scaled for the frame; keep above ~13px on screen |
| Mockup looks nothing like the product | Invented labels instead of harvesting real ones |
| Camera push breaks the material | A transform ancestor carries `will-change: filter` |

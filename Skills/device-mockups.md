---
name: device-mockups
description: Framing product UI in browser, laptop, phone and tablet chrome — when a frame earns its place, real proportions and corner radii, CSS perspective tilts instead of WebGL, weight and shadow, and animating a device into frame. Use when a film shows an interface inside a device, or when a mockup looks flat or subtly wrong.
---

# Device Mockups

A device frame does three things: it says "this is real software", it gives the
camera something to push into, and it makes a mobile app read as mobile. When it
is not doing one of those, it is spending pixels on decoration.

## When a frame earns its place

| Use a frame | Skip it |
|---|---|
| Establishing that this is a product | A beat about one feature |
| The first UI shot of the film | Every subsequent UI shot |
| A mobile app, so it reads as mobile | Text or logo beats |
| The camera will push into it | Content already filling the frame |

**Never nest device in device.** A phone inside a browser inside a laptop is a
stock illustration, not a shot.

And once a frame has established "this is software", later beats can drop it and
show the UI full-bleed. The viewer remembers.

## Proportions and radii

Getting these wrong is the difference between a mockup that reads as a device and
one that reads as a rounded rectangle. The eye recognises real hardware
proportions without being able to name them.

| Device | Aspect | Corner radius (at 1× scale) |
|---|---|---|
| Modern phone | 19.5:9 | ~44px |
| Tablet | 4:3 | ~26px |
| Laptop screen | 16:10 | ~12px (top corners) |
| Browser window | any | ~10px |

**A phone drawn with a 24px radius when the real one is ~44px reads subtly
wrong.** Nothing is identifiably broken; it just looks like a drawing of a phone.
Scale the radius with the frame: a phone rendered 620px tall in a 1080-tall stage
needs its radius scaled by the same factor.

The bezel matters too. A modern phone bezel is thin and even — 10–14px at
mockup scale — and a thick bezel dates the device by a decade.

## Browser chrome

```html
<div class="browser" data-el="frame" style="left:210px; top:150px; width:1500px;">
  <div class="browser-bar">
    <span class="dot dot-r"></span>
    <span class="dot dot-y"></span>
    <span class="dot dot-g"></span>
    <span class="browser-url">relay.app/tickets</span>
  </div>
  <!-- live DOM, not an image -->
</div>
```

**The URL bar is a storytelling opportunity.** `relay.app/tickets` says this is a
shipped product on its own domain. `localhost:3000` says this is a screenshot from
a developer's laptop, and it undoes the work the frame was doing.

Use the product's real domain and a plausible path. Match the path to the beat —
if the scene is about invoices, the URL says `/invoices`.

Keep the chrome minimal: three dots and a URL. Tab strips, bookmark bars,
extension icons and profile avatars are noise at film scale, and every one of them
is a place the viewer's eye can get stuck.

## Phone

```html
<div class="phone" data-el="phone" style="left:1380px; top:220px;">
  <div class="phone-notch"></div>
  <div class="phone-screen">
    <!-- live DOM again -->
  </div>
</div>
```

Two realism details that cost nothing:

- **A status bar.** Time, signal, battery. Its absence is oddly noticeable.
- **A believable time.** Not 12:00, and not the current time — pick something
  neutral like 9:41.

**Type inside a phone frame must stay above ~13px on screen.** A phone screen
occupying 400px of a 1920 stage is showing content at roughly a fifth of native
scale, so 14px app text renders at under 3px. Rebuild the phone UI at film scale
with fewer, larger elements — three rows, not twelve.

## Laptop

A lid and a base, with the base as a shallow trapezoid:

```html
<div class="laptop" data-el="laptop">
  <div class="laptop-lid">
    <div class="laptop-screen"><!-- live DOM --></div>
  </div>
  <div class="laptop-base"></div>
</div>
```

```css
.laptop-lid {
  border-radius: 12px 12px 2px 2px;   /* bottom corners nearly square */
  padding: 12px 12px 14px;            /* bezel, slightly deeper at the chin */
  background: var(--bg-elev-2);
}
.laptop-base {
  height: 14px;
  margin: 0 auto;
  width: 108%;                        /* base is wider than the lid */
  clip-path: polygon(0 0, 100% 0, 97% 100%, 3% 100%);
  background: linear-gradient(var(--bg-elev-3), var(--bg-elev-1));
}
```

The base being wider than the lid, and tapering, is what makes it read as a
laptop rather than a monitor. **`clip-path` on the base creates a backdrop root**,
so keep it off any element containing glass.

## Use CSS perspective, not WebGL

This is the important one. A convincing 3D tilt needs no Three.js:

```css
.stage-3d { perspective: 1600px; }
```

```js
s.add('[data-el="frame"]', {
  at: 0, dur: 1000, ease: 'softLand',
  rotateX: [8, 3],
  rotateY: [-12, -4],
  scale: [0.94, 1],
});
```

**Why this is usually right:** the read is nearly identical, it composites on the
GPU, it costs nothing per frame, it stays perfectly deterministic, and the screen
remains live DOM — so text stays sharp at any zoom and a cursor can still click
things inside it. A WebGL plane gives you a texture: fixed resolution, soft under
push-in, and inert.

Reach for real 3D only when the shot needs something a plane cannot do — a device
rotating through 180°, or genuine reflections on curved glass.

Keep tilts modest. Past about 15° of `rotateY`, text on the far edge goes soft and
the mockup starts to read as a stock image. And **perspective belongs on an
ancestor**, not on the element itself, or each element gets its own vanishing
point and the composition falls apart.

## Weight

A device with no shadow floats, which reads as a graphic rather than an object.

```css
.phone, .browser, .laptop-lid {
  box-shadow:
    0 2px 8px rgba(0,0,0,.28),      /* contact — tight and dark */
    0 24px 60px rgba(0,0,0,.32),    /* body */
    0 60px 140px rgba(0,0,0,.22);   /* ambient */
}
```

Three layers, increasing radius and decreasing opacity. **One hard shadow is the
clearest tell of a cheap mockup** — real objects cast a tight contact shadow and a
broad soft one at the same time.

A faint reflection below a device sells it further, but keep it under 12% opacity
and fade it out within about 40% of the device's height. Anything stronger reads as
a 2008 product page.

## Animating a device into frame

```js
// The frame arrives.
s.add('[data-el="frame"]', { at: 0, dur: 1000, ease: 'softLand',
                             scale: [0.94, 1], y: [30, 0] });
s.add('[data-el="frame-glass"]', { at: 0, dur: 700, ease: 'outQuart',
                                   opacity: [0, 1] });

// Contents lag 40-80ms behind the frame.
s.add('[data-el="row"]', { at: 80, dur: 640, ease: 'outQuint',
                           stagger: 90, opacity: [0, 1], y: [16, 0] });
```

**The lag is what gives the shot depth.** Frame and contents arriving in perfect
lockstep looks like a printed image being slid around; a small delay reads as an
object with things inside it.

Note the split: `scale`/`y` on the wrapper, `opacity` on the glass element. Fading
a wrapper that contains glass makes it a backdrop root and flattens the material
for the whole entrance.

`scale: [0.94, 1]` — not from 0.5. A device growing from nothing reads as a UI
transition; a device settling the last 6% reads as a camera finding it.

## The screen is a live DOM crop

Never a flat image.

A screenshot inside a device frame cannot be pushed into past ~1.5× before it goes
soft, cannot respond to a cursor, and cannot animate a row sliding in — which
means the device frame is now the only thing in the shot doing any work.

Rebuild the screen content at film scale with fewer elements. That is what makes
the camera move worth making.

## Common mistakes

| Symptom | Cause |
|---|---|
| Phone reads as a rounded rectangle | Corner radius too small for the real device |
| Device looks a decade old | Bezel too thick |
| Mockup looks like a stock illustration | Nested device in device, or `rotateY` past ~15° |
| Device floats | Single hard shadow instead of three layers |
| Shot undoes its own credibility | URL bar shows `localhost:3000` |
| Eye gets stuck in the chrome | Tab strip, bookmarks and avatars at film scale |
| Text inside a phone is illegible | App-scale type in a frame rendered at a fifth size |
| Content goes soft on push-in | Screen is a flat image, not live DOM |
| Glass flattens during the entrance | `opacity` animated on the wrapper |
| Glass flat under a laptop base | `clip-path` on an ancestor created a backdrop root |
| Composition falls apart in 3D | `perspective` on each element instead of a shared ancestor |
| Entrance looks like a UI transition | Scaled from 0.5 rather than 0.94 |
| Shot feels flat despite motion | Contents arriving in lockstep with the frame |
| Status bar absence feels wrong | No status bar, or a placeholder 12:00 |

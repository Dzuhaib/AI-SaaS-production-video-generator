---
name: threejs-in-video
description: Using Three.js inside a deterministic seek-based film — driving a scene from t instead of a clock, closed-form camera paths, seeded randomness, canvas readback for capture, and when a CSS perspective transform is the better answer. Use when a film needs real 3D, or when a WebGL scene renders differently in the export than in preview.
---

# Three.js in a Deterministic Film

Three.js assumes a render loop: `requestAnimationFrame`, a clock, a delta, repeat.
A seek-based film has no loop — it has `seek(t)`, called once per frame in
arbitrary order. Everything below follows from reconciling those two models.

**Read the last section first if you are deciding whether to use 3D at all.** Most
shots that seem to need it do not.

## Drive the scene from `t`, never from a clock

This is the rule that everything else depends on.

```js
// WRONG — every one of these breaks the export.
const clock = new THREE.Clock();
function animate() {
  const dt = clock.getDelta();
  mesh.rotation.y += dt * 0.5;        // accumulates
  camera.position.lerp(target, 0.08);  // frame-rate dependent
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
```

```js
// RIGHT — a pure function of t, rendered on demand.
tl.loop(function (t) {
  mesh.rotation.y = (t / 1000) * 0.5;              // computed, not accumulated
  camera.position.copy(cameraPathAt(t));           // closed form
  renderer.render(scene, camera);
});
```

**Why each of the wrong forms fails.** `getDelta()` returns wall-clock time since
the last call — under frame-by-frame capture that is however long the screenshot
took, so rotation depends on machine speed. `+=` accumulates, so seeking backward
does not unwind it and seeking to the same `t` twice gives two different results.
`lerp(target, 0.08)` moves a fraction of the remaining distance *per call*, so its
position depends on how many calls have happened, not on `t`.

Never call `requestAnimationFrame`. `tl.loop` is the frame loop.

## Closed-form camera paths

Damping and lerp-toward-target are the standard way to move a camera smoothly, and
both are unusable here. Write the path as a function instead:

```js
const A = new THREE.Vector3(0, 1.2, 6);
const B = new THREE.Vector3(1.8, 0.6, 2.4);

function cameraPathAt(t) {
  const p = clamp01((t - 2000) / 1400);      // the move runs 2000-3400ms
  const e = Ease.inOutCubic(p);              // same eases as the rest of the film
  return A.clone().lerp(B, e);
}
```

`Ease` is the engine's easing library, so a 3D camera move shares timing language
with every other move in the film. A `CatmullRomCurve3` works the same way —
`curve.getPoint(easedProgress)` is closed form.

## Seed every random value

```js
// WRONG — a different particle field every render.
for (let i = 0; i < 400; i++) {
  positions[i * 3] = (Math.random() - 0.5) * 20;
}
```

```js
// RIGHT — deterministic from an index.
function hashRand(i, seed) {
  let x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

for (let i = 0; i < 400; i++) {
  positions[i * 3 + 0] = (hashRand(i, 1) - 0.5) * 20;
  positions[i * 3 + 1] = (hashRand(i, 2) - 0.5) * 20;
  positions[i * 3 + 2] = (hashRand(i, 3) - 0.5) * 20;
}
```

This matters even for geometry generated once at setup: a parallel render splits
frame ranges across separate browser instances, each of which runs setup
independently. Unseeded randomness gives every worker a different particle field,
and the seams appear at the range boundaries.

## Canvas readback for capture

A WebGL canvas can appear blank in a screenshot even though it renders correctly on
screen, because the drawing buffer may be cleared after compositing.

```js
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,   // required for screenshot capture
  alpha: true,                   // so DOM layers behind it show through
});
```

`preserveDrawingBuffer: true` costs performance and is normally discouraged. Here
it is mandatory.

**I have not been able to verify WebGL capture under headless Chromium in this
environment** — no browser was available to test against. Treat this as reasoned
from how the drawing buffer works, not as measured. If exported frames show a
blank canvas, this flag is the first thing to check; software rasterisation
(`--swiftshader`) is the second.

## Colour space and tone mapping

A mismatch here shifts every colour in the film, and it is easy to miss because
both the preview and the export are internally consistent.

```js
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
```

**Set both explicitly.** Three.js has changed its defaults across versions, so an
unset value is a version dependency. And a tone-mapped WebGL layer sitting next to
untone-mapped CSS content produces two different renderings of the same accent
colour in one frame — the mismatch reads as a rendering bug rather than a choice.

If you do want tone mapping for a lit 3D scene, apply the same transform to the
CSS side or keep the two visually separated.

## A page screenshot as a texture

```js
const texture = new THREE.TextureLoader().load('screenshot.png');
texture.colorSpace = THREE.SRGBColorSpace;
texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
texture.generateMipmaps = true;
texture.minFilter = THREE.LinearMipmapLinearFilter;

const plane = new THREE.Mesh(
  new THREE.PlaneGeometry(16, 9),
  new THREE.MeshBasicMaterial({ map: texture })
);
```

`anisotropy` is what keeps text legible when the plane is viewed at an angle;
without it, glancing angles blur badly. Mipmaps prevent shimmer as the plane
scales.

**A captured page as a flat texture goes soft past roughly 1.5× push-in**, and no
filtering setting fixes that — the pixels are not there. Capture at 2× the
intended on-screen size if you must push in, and accept the memory cost. Or do not
push in.

`MeshBasicMaterial` rather than `MeshStandardMaterial`: a UI screenshot should not
be lit. Lighting it makes the interface look like a printed poster.

## Shadows, DOF and reflections cost per frame

Every effect multiplies across the whole render. At 900 frames, 40ms per frame is
36 seconds; 200ms per frame is three minutes.

| Feature | Cost | Verdict |
|---|---|---|
| `MeshBasicMaterial`, no lights | negligible | Default |
| One directional light, no shadows | low | Fine |
| Shadow maps | moderate | Only if the shot needs contact |
| `EffectComposer` + bloom | moderate–high | One pass, maybe |
| Depth of field (bokeh) | high | Fake it with a CSS blur on a layer behind |
| SSR / real reflections | very high | Use a mirrored, faded copy instead |

Export is not real-time, so a slow frame does not drop — it just makes the render
longer. That is a budget, not a wall, but it is a budget worth spending
deliberately.

## When 3D actually earns its cost

Be honest about this. Most "3D" shots in product films are a panel with
perspective, and **CSS does that better than WebGL**:

```css
.stage-3d { perspective: 1600px; }
```

```js
s.add('[data-el="panel"]', {
  at: 0, dur: 1000, ease: 'softLand',
  rotateX: [8, 3], rotateY: [-12, -4], scale: [0.94, 1],
});
```

The CSS version wins on nearly every axis: the screen stays **live DOM**, so text
is sharp at any zoom and a cursor can still click things inside it; it composites
on the GPU for free; it is deterministic with no extra work; and it keeps the glass
material, which a WebGL plane cannot have.

| Shot | Use |
|---|---|
| Panel tilted in space | **CSS perspective** |
| Device rotating slightly | **CSS perspective** |
| Card flip | **CSS `rotateY` + `backface-visibility`** |
| Parallax layers | **CSS transforms on separate layers** |
| Device rotating through 180° | Three.js |
| Genuine reflections on curved glass | Three.js |
| Particle system, thousands of elements | Three.js |
| Data visualised in real 3D space | Three.js |
| Camera orbiting a solid object | Three.js |

The test: **does the shot need geometry the browser cannot express?** If the answer
is "it needs to look 3D", that is CSS. If it is "the camera must travel around an
object", that is Three.js.

## Integration checklist

- Canvas inside `.stage` so it is captured and scales with the film
- `renderer.setSize(film.width, film.height)` — not window size
- `renderer.setPixelRatio(1)` — pin it, do not read `devicePixelRatio`
- All motion inside `tl.loop(t)`; no `requestAnimationFrame` anywhere
- `renderer.render()` called from inside that loop
- Every random value seeded
- Textures loaded and decoded before `__EXPLAINER__.ready` flips
- No `THREE.Clock`, no `getDelta()`, no `+=` on an animated property

## Common mistakes

| Symptom | Cause |
|---|---|
| Motion speed differs between renders | `getDelta()` or accumulated `+=` |
| Seeking backward does not restore the scene | State accumulates instead of computing from `t` |
| Camera ends somewhere different each run | `lerp` toward a target instead of a closed-form path |
| Particle field differs between parallel workers | Unseeded randomness in setup |
| Canvas is blank in exported frames | `preserveDrawingBuffer` not set |
| Colours differ between the WebGL layer and the DOM | `outputColorSpace` / `toneMapping` unset or mismatched |
| Text on an angled plane is illegible | No `anisotropy` |
| Texture shimmers as it scales | Mipmaps disabled |
| Screenshot texture soft on push-in | Captured at 1×; capture at 2× or do not push in |
| A UI screenshot looks like a printed poster | Lit with `MeshStandardMaterial` |
| Render takes hours | DOF or SSR enabled across 900 frames |
| Cursor cannot click the interface | UI is a WebGL texture; use CSS perspective on live DOM |
| Glass material missing on a 3D panel | It is a WebGL plane; glass needs `backdrop-filter` on DOM |
| First frames missing a texture | Loaded asynchronously after `ready` flipped |

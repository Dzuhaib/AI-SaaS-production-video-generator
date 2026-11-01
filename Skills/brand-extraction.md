---
name: brand-extraction
description: Deriving a brand system from a live DOM — accent colour, typeface, radius, scheme, real copy and labels — so a generated video reads as an extension of the product. Use when analysing a website to build a film from it, or when a film's colours or type do not match the product.
---

# Brand Extraction

A film built from a generic dashboard is a film about nothing. A film that uses
the product's real name, real feature copy, real nav labels and real accent
colour is a film about *that product*, and the difference is visible in the first
two seconds.

The rule that governs everything here: **the site supplies truth.** You are
harvesting facts, not generating a design. Never improve their copy, never
substitute a nicer accent, never invent a tagline.

The implementation is `src/browser/brand.ts`. This documents what it does and why.

## What to extract, in priority order

1. **Product name and tagline**, exactly as written. Do not rewrite their
   positioning; they have thought about it more than you have.
2. **The top features in the site's own words.** These become the scenes.
3. **Accent colour.** One hex is enough — the preset derives the rest.
4. **Typeface.** A Google Fonts family you can load, or the closest available
   substitute, *named as a substitute*.
5. **Layout shape.** Sidebar or top nav, cards or table, light or dark, rounded
   or square.
6. **Real labels.** "Invoices / Customers / Settings" is worth ten times
   "Item One".
7. **Numbers, with the attribution the site gives them.** A number on a marketing
   site is a claim, not a fact. If it goes on screen, attribute it as they do.

## The accent colour

**Do not take the most common colour.** The most common colour is always the
background, because the background is most of the pixels.

What identifies a brand is the colour a designer chose to put on the elements
they wanted noticed. So weight candidates by *where* they appear rather than how
often:

```js
const consider = (el, weight) => {
  const style = getComputedStyle(el);
  for (const [value, factor] of [
    [style.backgroundColor, 1],
    [style.color, 0.6],
    [style.borderColor, 0.3],
  ]) {
    const rgb = parseRgb(value);
    if (!rgb) continue;
    const [r, g, b, a] = rgb;
    if (a < 0.5) continue;
    if (saturation(r, g, b) < 0.18) continue;      // greys are never the accent
    const lum = luminance(r, g, b);
    if (lum > 0.94 || lum < 0.03) continue;        // near-white, near-black
    bump(toHex(r, g, b), weight * factor);
  }
};

document.querySelectorAll('button, a[class*="btn"], [role="button"]')
  .forEach((el) => consider(el, 3));   // primary buttons carry it most reliably
document.querySelectorAll('a').forEach((el) => consider(el, 1));
document.querySelectorAll('nav [aria-current], nav [class*="active"]')
  .forEach((el) => consider(el, 2));
```

**The saturation gate is the load-bearing line.** Without it, `#ffffff` and
`#0a0a0a` dominate every ranking and you get a "brand colour" of white. HSL
saturation below ~0.18 is a grey, whatever its hue claims.

**Skip invisible elements.** A hidden mobile menu contributes colours nobody
sees. Check `display`, `visibility`, `opacity` and a non-zero bounding box.

**Keep the runners-up.** Return a ranked list, not a single value. The top
candidate is occasionally a destructive-action red or a promotional badge, and a
human glancing at three options catches that instantly.

## Contrast: check before using

An accent was chosen against *that site's* background. A film's background is
usually near-black. An accent that passed WCAG on a white page can land at 2:1
here and become unreadable.

```js
const { colour, adjusted, ratio } = ensureContrast(accent, '#0A0A0A', 4.5);
```

**Adjust toward the accent's own hue, do not replace it.** Stepping the colour
lighter or darker in 4% increments preserves recognisable brand identity;
swapping in a different colour does not. Report when you adjusted and by how
much — a designer will want to know their blue was lightened.

## Typeface, and the trap

`getComputedStyle(el).fontFamily` returns the **declared stack**, not the face
that rendered. A site declaring `"Söhne", Inter, sans-serif` with a failed Söhne
load still reports Söhne.

```js
const style = getComputedStyle(el);
const first = style.fontFamily.split(',')[0].trim().replace(/["']/g, '');
if (!document.fonts.check(`${style.fontWeight} 16px "${first}"`)) {
  // Declared but not loaded. Whatever rendered was the fallback.
}
```

**Why this matters here specifically:** if you extract a face the site never
actually rendered, you reproduce a design nobody has seen. And the same trap
appears again at export — `document.fonts.ready` resolves even when loading
*fails*, so a render can silently substitute metrics.

Sample the display face from the first `h1`/`h2` and the text face from a `p`.
Those two are all a film needs; a third face reads as indecision.

**Licensing.** A Google Fonts family (OFL/Apache-2.0) can be embedded and shipped.
A foundry face usually cannot. If the product uses a licensed face, pick the
nearest permissive substitute and *say which you substituted* rather than
shipping a woff2 you have no right to distribute.

## Radius and shadow

**Use the mode, not the mean.** A site with mostly 12px corners and one 9999px
pill averages to something it never uses. The mode is a value that actually
appears in the design.

```js
const radii = new Map();
document.querySelectorAll('button, [class*="card"], input').forEach((el) => {
  const r = Math.round(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0);
  if (r > 0 && r < 40) radii.set(r, (radii.get(r) ?? 0) + 1);  // exclude pills
});
const radius = [...radii.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
```

Excluding values above 40px is deliberate: a pill radius describes a shape, not
the design system's scale.

For shadows, a boolean is enough — what fraction of components have a non-`none`
`box-shadow`. Above about 30%, the product uses elevation, and a flat film will
not look like it.

## Light or dark

```js
const bg = parseRgb(getComputedStyle(document.body).backgroundColor);
const scheme = luminance(...bg) < 0.4 ? 'dark' : 'light';
```

Use WCAG relative luminance, not a naive RGB average — green contributes far more
perceived brightness than blue, and an average misclassifies saturated
backgrounds.

This picks the preset. Getting it wrong is the most visible possible error: a
dark film for a product whose site is white does not read as *their* product.

## Copy and labels

```js
const productName =
  meta('og:site_name') ||
  text('[class*="logo"]').slice(0, 40) ||
  document.title.split(/[|\-–—]/)[0] ||
  null;

const tagline =
  meta('description') ||
  text('h1 + p, h1 ~ p') ||
  null;
```

`og:site_name` first because it is explicitly the product's name, where
`document.title` is a page title that often carries marketing suffixes.

Collect nav labels (filter to under ~24 characters — anything longer is a
sentence, not a nav item), headings, and CTA labels. Deduplicate. These populate
the rebuilt UI, and they are the single cheapest thing that makes a mockup look
like the real product.

## The logo

**Inline SVG only.**

```js
const el = document.querySelector('header svg, [class*="logo"] svg, a[href="/"] svg');
if (el && el.outerHTML.length < 24_000) logoSvg = el.outerHTML;
```

A raster logo cannot be recoloured for a dark film or scaled for a hero shot. And
**never redraw a logo by hand** — a slightly wrong logo is worse than no logo,
because it reads as counterfeit. With no SVG available, use a text lockup in the
brand's display face.

The size cap keeps an illustration-sized SVG out of the film.

## When the page is an empty shell

An SPA served as a bare `<div id="root">` yields nothing. Options, in order:

1. **Wait for hydration** — `networkidle` plus a real selector, not a fixed sleep.
2. **Try a different route.** A marketing page usually renders server-side even
   when the app does not.
3. **Ask.** One question about the product beats a film built on nothing.

**Do not invent a brand and proceed silently.** If you must assume, state the
assumption in one line and build — but say so.

## A worked result

```json
{
  "productName": "Relay",
  "tagline": "Every password reset, handled.",
  "accent": "#3B82F6",
  "accentCandidates": [
    { "colour": "#3B82F6", "weight": 14.2 },
    { "colour": "#8B5CF6", "weight": 3.6 },
    { "colour": "#EF4444", "weight": 1.8 }
  ],
  "background": "#0B0F19",
  "scheme": "dark",
  "fontDisplay": "Inter",
  "fontText": "Inter",
  "radius": 12,
  "hasShadows": true,
  "navLabels": ["Inbox", "Tickets", "Customers", "Reports", "Settings"],
  "ctaLabels": ["Start free trial", "Book a demo"],
  "logoSvg": "<svg viewBox=\"0 0 24 24\">…</svg>",
  "fontWarnings": []
}
```

Note the third accent candidate is a destructive red, and two CTAs are present —
the film must pick one. Both are things a ranked list surfaces and a single value
would have hidden.

## Common mistakes

| Symptom | Cause |
|---|---|
| Extracted accent is white or near-black | No saturation gate; background dominated the ranking |
| Accent is a destructive red | Sampled a delete button; check the candidate list |
| Accent unreadable on the film's background | Not contrast-checked against the *film*, only the site |
| Brand no longer recognisable after adjustment | Colour replaced instead of stepped toward its own hue |
| Film uses a face the site never rendered | Trusted `fontFamily` without `fonts.check()` |
| Radius looks wrong on every component | Used the mean; pill radii skewed it |
| Dark film for a light product | Luminance from an RGB average, not WCAG |
| Logo looks counterfeit | Redrawn by hand instead of using inline SVG |
| Nothing extracted | SPA shell; waited on a timer instead of a selector |
| Nav labels are sentences | No length filter |
| Numbers on screen read as marketing | Extracted without the site's own attribution |
| Legal complaint about a font | Shipped a licensed woff2; substitute and disclose instead |

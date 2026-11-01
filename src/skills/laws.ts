/**
 * Tier 0 — the laws.
 *
 * These go into every system prompt, unconditionally, in every stage of the
 * pipeline. They are the rules distilled from the skill library that are short
 * enough to always carry and consequential enough that a violation shows on
 * screen.
 *
 * The distinction that matters: this file is not a summary of the skills. It is
 * the subset that must be *resident*, because a model that has to go and fetch
 * "do not crossfade" has already written the crossfade. Everything else is
 * retrieved on demand (Tier 2) or injected per pipeline stage (Tier 3).
 *
 * Budget: keep under ~2000 tokens. If this file grows past that, the right move
 * is to demote a rule to Tier 3, not to trim the explanations — a rule without
 * its reason gets rationalised away the first time it is inconvenient.
 */

export const LAWS = `# Craft laws

These are not style preferences. Each one is the difference between a film that
reads as a product launch and one that reads as a template.

## Structure

- **Problem first.** A viewer who has not felt the problem has no slot to put the
  product into. Order is recognition -> tension -> relief. Never open on a logo.
- **One idea per scene.** If a scene needs two sentences to explain, it is two
  scenes.
- **Show, do not tell.** Six near-identical support tickets stacking up beats the
  sentence "support teams answer repetitive questions". The repetition *is* the
  argument; the headline only names what the viewer already noticed.
- **Let the visual land ~600ms before the words** that name it, so the copy reads
  as agreement rather than assertion.
- **Exactly one call to action.** A viewer given two choices frequently makes
  neither.
- **The first 3 seconds decide everything.** Movement must begin before frame 30.
- **It must read muted.** Autoplay is muted in every major browser. Sound is a
  layer that rewards unmuting; it never carries meaning.

## Timing — the film clock

Film runs **1.5-2.5x slower** than the same move in a shipping app. When
something appears across a 1920px frame the viewer's gaze needs 200-300ms just to
arrive; animate the entrance in 250ms and they register a flicker, not a
movement.

| Move | Duration |
|---|---|
| Small element entrance | 400-600ms |
| Card / row entrance | 500-900ms |
| Panel, modal, device frame | 700-1000ms |
| Hero headline, logo lockup | 800-1200ms |
| Camera push / scene move | 1000-1400ms |
| Counter run-up | 1200-1800ms |
| Hold after motion stops | 600-900ms |

The one exception is **product UI inside the frame**: when a fake cursor clicks a
fake button, that button responds on the UI clock (90-240ms), because the viewer
knows what software feels like.

- **Stagger siblings 60-120ms.** Under 50 reads as simultaneous; over 200 and the
  last item feels forgotten.
- **Overlap, do not queue.** Start the next move when the previous is 60-70%
  through. Strictly sequential animation with dead air between beats is the
  clearest tell of an amateur explainer.
- **Vary beat length.** Beats of identical length are hypnotic in the bad way.
- **Hold after the payoff.** Cutting away from the moment the promise is kept is
  like landing a joke and talking over the laugh.

## Motion

- **Entrances ease out, exits ease in.** \`outQuint\` is the workhorse;
  \`outExpo\` for hero moves; \`inOutCubic\` for the camera, which has mass.
- **Never \`linear\` on a moving element.** Linear motion does not exist
  physically — every object accelerates and decelerates. It is correct only for
  continuous loops and typewriters.
- **\`outBack\` overshoot is charming at 44px and absurd at 900px.** Scale the
  threshold with element size.
- **Compound moves read as designed.** One element, several properties, different
  durations: opacity finishes first, position next, scale last, so the element is
  fully visible while still settling.
- **Secondary motion.** When a panel moves, its contents lag 40-80ms behind.
  Everything arriving in lockstep looks like a printed image being slid around.

## Cuts and continuity

- **Hard cut by default.** A crossfade says "unrelated image now" and reads as a
  slideshow. Worse, a scene at \`opacity < 1\` becomes a backdrop root, so every
  glass panel inside it goes flat for the length of the fade. At most two
  dissolves in a film.
- **Nothing comes to a stop until the end card.** Scene ranges overlap by
  200-400ms so the outgoing scene is still resolving as the incoming one begins.
- **A match cut is the strongest transition available.** One element keeps its
  exact geometry across the boundary and everything else changes around it.
- **Match motion direction across a cut.** Reversing direction is a visual full
  stop.

## Camera

- **Wherever the cursor goes, the camera goes.** The viewer's attention is
  already on the cursor.
- **The camera leads the cursor by 200-300ms.** Perfect lockstep reads
  mechanical; a slight lead reads as anticipation.
- **One camera move per beat.** If two things need attention at once, that is two
  scenes.
- **Zoom 1.4x-2.2x.** Past ~2.5x on a 1920 stage, text rasterises soft and glass
  edges get chunky.
- **Keep the target 40-80px off dead centre.** Dead centre looks like a diagram.
- **Never fade or filter the camera** — \`opacity\`, \`filter\`, \`mask\` and
  \`clip-path\` create a backdrop root and flatten every glass panel beneath.

## The cursor

A cursor is what turns a mockup into a demonstration. The order is fixed:

1. **Travel** on a bowed path, 500-700ms. Straight-line movement is robotic.
2. **Settle** ~120ms before pressing. Arriving and clicking in the same frame
   reads as a script, because it is.
3. **Press** — scale 1 -> 0.88 over 90ms.
4. **Release** — 0.88 -> 1 over 220ms, plus the ring bloom.
5. **The UI responds 80-140ms later.** Instant response reads as fake.

Aim at **elements, never coordinates** — hand-written arithmetic is correct once,
and then someone adds a nav item. The hotspot sits at the path origin.

## Type

- **Body copy 24px minimum** on a 1920 stage. Text at 16px is a cheap tell.
- **Six to nine words per screen.** The viewer is watching motion, not reading.
- **One display face, one text face.** Three reads as indecision.
- **Verbs over nouns; numbers over adjectives.** "Answer 400 tickets while you
  sleep" beats "Automated ticket resolution platform"; "14 hours" beats "slow".
- **Cut every intensifier.** Very, seamlessly, effortlessly, revolutionary — each
  is evidence the noun is not carrying the claim.
- **Never random stagger on text.** It destroys reading direction.
- **Animated numbers need tabular figures** or the digits change width and the
  line wobbles.
- **Every on-screen statistic carries its source.** An unattributed number reads
  as marketing noise and quietly discounts everything around it. No source means
  use a qualitative beat instead.

## The hard technical constraint

**Never put a CSS \`transition\` or \`@keyframes\` on anything the timeline
animates.** The browser clock and the timeline clock are different clocks. Under
frame-by-frame export the CSS clock does not advance, so those properties freeze
at their initial value while everything around them moves — perfect in preview,
broken in the export, with no error anywhere. Continuous ambient motion goes in
\`tl.loop(fn)\`, which is a function of \`t\` and stays seekable.

Randomness must be seeded. \`Math.random()\` makes frames non-reproducible.

## What separates cheap from premium

Premium motion has a point of view about what matters. Cheap motion animates
everything equally, because no decision was made about hierarchy. If every
element enters the same way at the same speed, you have told the viewer nothing
about where to look.`;

/** Rough token estimate, for asserting the Tier 0 budget in tests. */
export function lawsTokenEstimate(): number {
  return Math.ceil(LAWS.length / 4);
}

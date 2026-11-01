---
name: voiceover-narration
description: Adding narration to a product film — deciding whether to narrate at all, writing to a beat sheet, word budgets from words-per-second, aligning to the timeline, and caching TTS output so renders stay reproducible. Use when a film needs a voiceover or narration script, or when narration and picture are out of sync.
---

# Voiceover and Narration

Start with the decision, not the script: **most product films are stronger
silent.** A film that demonstrates does not need a voice explaining what the
viewer is already watching, and narration is the most common way a confident film
becomes a corporate one.

## The film must work muted regardless

Autoplay is muted in every major browser, and feed viewers keep it that way. So
narration is a layer that **rewards** unmuting — never one that carries meaning
alone.

The test: watch the film with the sound off. If a beat becomes incomprehensible,
that beat is relying on the voice, and it needs a visual or a caption instead.

This is not a stylistic preference. It is the default delivery condition.

## When narration earns its place

| Narrate | Stay silent |
|---|---|
| A concept the UI cannot show (why, not what) | A feature walkthrough — show it |
| A long-form film someone chose to watch | A landing-page hero loop |
| A named human giving a perspective | A feed video, watched muted |
| Technical detail with no visual form | Anything under ~15 seconds |

## Write to the beat sheet, not the other way round

Write the beats first, then a line per beat. A script written whole, then
illustrated, produces a film of pictures that accompany talking — and every beat
runs as long as its sentence rather than as long as its idea.

```
hook    (5.2s)  —  [silent. six tickets stack up.]
stakes  (4.1s)  —  "Fourteen hours to a first reply."
reveal  (4.6s)  —  "Relay answers them for you."
how    (10.0s)  —  "It drafts from your own past replies. You approve."
payoff  (3.4s)  —  [silent. the toast lands.]
end     (3.9s)  —  "Start free at relay.app."
```

Note two beats with no line. **Silence is a tool.** The payoff especially: let the
moment land without talking over it.

## Words per second is the real unit

A measured product read runs **2.2–2.8 words per second.** Faster reads as an
advert; slower drags.

That converts a beat duration into a word budget:

```
words ≈ (beat_seconds − 0.8) × 2.5
```

The 0.8s subtraction is breathing room — you cannot start speaking on frame 1 of a
scene or end on its last frame.

| Beat | Word budget |
|---|---|
| 3.5s | ~7 words |
| 5.0s | ~10 words |
| 8.0s | ~18 words |
| 12.0s | ~28 words |

**A 30-second film holds about 60 words of narration.** That is far less than
anyone expects, and it is the number that keeps a script from bloating the film.

## Read it aloud

Then cut it.

- **If you run out of breath, the line is too long.** A line that needs a mid-
  sentence breath needs to be two lines or fewer words.
- **Contractions.** "It's" not "it is". Written prose reads as written prose.
- **One clause.** A subordinate clause in a 4-second beat is a line the viewer
  processes after the picture has changed.
- **Cut every intensifier.** Seamlessly, effortlessly, revolutionary — each is
  evidence the verb is not carrying the claim, and each costs words you do not
  have.

## Do not duplicate on-screen copy verbatim

If the headline says "Every password reset, handled" and the voice says "Every
password reset, handled", the viewer reads it in about 400ms, then waits 1.6
seconds for the voice to finish saying what they already know.

**Let them complement.** The headline names the thing; the voice adds what the
headline could not fit:

```
On screen:  "Every password reset, handled"
Voice:      "It drafts from your own past replies."
```

## Pauses are timeline events

A pause is not absence of narration; it is a placed beat. Write them explicitly so
the picture can use them:

```js
tl.cue('pad', s.start);                    // bed lifts
// 0-1200ms: no voice. The tickets stack.
// 1200ms: line begins, after the visual has landed.
```

The same rule as on-screen copy applies: **let the visual land ~600ms before the
words that name it.** The voice then reads as agreement rather than assertion.

## A provider-agnostic TTS interface

```ts
interface Voice {
  id: string;
  name: string;
}

interface Synthesis {
  audio: Buffer;            // WAV or MP3
  durationMs: number;
  words: { word: string; startMs: number; endMs: number }[];
}

interface TTSProvider {
  listVoices(): Promise<Voice[]>;
  synthesize(text: string, voice: string): Promise<Synthesis>;
}
```

ElevenLabs, OpenAI, Azure Speech, Google Cloud TTS and Piper (local) all fit
behind this. **I have not tested any of them in this environment**, so treat the
following as what to check rather than as measured fact:

- **Word-level timings are not universal.** Some providers return per-word
  timestamps, some return per-character, some return nothing. The interface should
  treat `words` as possibly empty and fall back.
- **Quality varies most on product names and technical terms.** That is exactly
  what a product film says most often.
- **Local models (Piper) trade quality for reproducibility and cost.** For a draft
  pass while timing the film, that trade is usually right.

## Aligning narration to picture

**Preferred: word-level timestamps.** Snap a visual beat to the word that names
it.

```js
const timings = narration.words;
const word = timings.find((w) => w.word.toLowerCase() === 'drafts');

tl.add('[data-el="draft-card"]', {
  at: narrationStart + word.startMs,
  dur: 620, ease: 'outQuint',
  opacity: [0, 1], y: [16, 0],
});
```

**Fallback: forced alignment.** Given audio and a transcript, tools like Whisper
(with word timestamps) or Montreal Forced Aligner produce the same data. Slower,
and an extra dependency.

**Last resort: hand-place from a waveform.** Works, does not survive a script
edit.

### The practical order

Fighting audio into pre-set beat durations is the wrong way round, because a line
that runs 200ms long forces either a rushed read or a re-timed scene.

Instead:

1. Write the script to the beat sheet, with word budgets as a guide.
2. Synthesise it.
3. **Measure the real audio per line.**
4. Set scene durations from the measured lengths, plus the holds you want.

The film then fits the voice, and no line is ever clipped or padded.

## Cache the audio, or the film changes every render

**A TTS call is not reproducible.** The same text and voice can return slightly
different audio between calls — different length, different word boundaries. If
the render pipeline synthesises on the fly, the film changes every time it renders
and no two exports match.

Treat synthesis as a **build step** producing committed artefacts:

```
narration/
  script.json          the lines, with beat ids
  hook.wav             synthesised audio
  hook.timings.json    word-level timings
  ...
```

The render reads the WAV and the timings. Re-synthesise only when the script
changes, and commit the result so a colleague's render matches yours.

## Loudness

- **Voice at −16 LUFS** for web, peaking around **−3 dBTP**.
- **Duck the music under the voice** rather than lowering it statically — see the
  `motion-audio` skill for the `sidechaincompress` invocation.
- **Normalise the voice before mixing**, not after, or the ducking threshold is
  chasing a moving level.

## Pronunciation

Product names are where synthetic voices fail most visibly, and a mispronounced
product name in a product film is worse than no narration.

Most providers accept SSML:

```xml
<speak>
  Try <phoneme alphabet="ipa" ph="ˈriːleɪ">Relay</phoneme> free today.
</speak>
```

SSML support and phoneme alphabets differ per provider — check theirs. Where SSML
is unavailable, a respelling in the input text ("Ree-lay") often works and is
worth trying before giving up.

Always listen to the product name in isolation before accepting a take.

## The honest note

**A synthetic voice on a premium film is a visible compromise.** Current TTS is
good enough that most viewers will not consciously identify it, and it still lacks
the timing choices a human reader makes — the slight pause before the important
word, the lift at the end of a claim.

If the film matters, a human read costs little and sounds like a decision rather
than a default. Use TTS to time the film and prototype the script; consider
replacing it for the final cut.

## Common mistakes

| Symptom | Cause |
|---|---|
| Film incomprehensible muted | Narration carrying meaning instead of adding to it |
| Every beat runs as long as its sentence | Script written first, pictures found afterwards |
| Read sounds like an advert | Above ~2.8 words/second |
| Viewer waits through the voice | On-screen copy duplicated verbatim |
| Script does not fit the beats | No word budget; ~60 words per 30 seconds |
| A line is clipped at a cut | Beat durations set before the audio was measured |
| Visual and voice miss each other | Hand-placed timings that a script edit invalidated |
| The film changes every render | TTS called at render time instead of cached |
| Music buries the voice | Static level instead of sidechain ducking |
| Levels jump between lines | Normalised after mixing rather than before |
| Product name mispronounced | No SSML phoneme or respelling |
| Payoff feels rushed | Talking over the moment; leave it silent |
| Voice sounds synthetic | It is; consider a human read for the final cut |

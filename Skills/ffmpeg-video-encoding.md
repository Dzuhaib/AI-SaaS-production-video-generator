---
name: ffmpeg-video-encoding
description: Encoding a rendered frame sequence to a deliverable MP4 — flag-by-flag reasoning, codec choice, platform delivery specs, audio muxing and loudness, and verifying output with ffprobe. Use when encoding video, choosing codecs or bitrates, or debugging a file that plays in one player but not another.
---

# FFmpeg for Rendered Video

You have a PNG sequence and a WAV. This is about turning them into a file that
plays everywhere, looks like what you rendered, and starts instantly on the web.

Screen content is not camera footage. It is flat colour, hard edges and small
text, with no grain. That changes almost every encoding decision below.

## The baseline command

```bash
ffmpeg -y \
  -framerate 30 -start_number 0 -i frames/%06d.png \
  -i audio.wav \
  -c:v libx264 -preset slow -crf 18 -tune stillimage \
  -pix_fmt yuv420p \
  -c:a aac -b:a 192k -shortest \
  -movflags +faststart \
  out.mp4
```

Every flag earns its place:

**`-framerate 30` before `-i`** sets the rate the input is *interpreted* at. The
same number after `-i` (or `-r`) resamples instead, duplicating or dropping
frames to hit a target. That is how a 30fps render becomes 30fps of stutter.
Position is the whole difference.

**`-start_number 0`** because ffmpeg assumes sequences begin at 1. A range render
starting at frame 0 silently loses its first frame otherwise.

**`-crf 18`** is visually lossless for UI. See the CRF section below.

**`-preset slow`** buys roughly 10–15% smaller files for a few times the encode
time. On a 900-frame render that is seconds, and worth it.

**`-tune stillimage`** weights the encoder toward preserving sharp edges over
temporal smoothness. Designed for slideshows, and it suits screen content for
the same reason: the enemy is ringing around type, not motion judder.

**`-pix_fmt yuv420p`** is the only chroma subsampling with universal decoder
support. Encode `yuv444p` and Safari and QuickTime open the file, show a black
frame, and report no error. This is the single most common "works on my machine"
video bug.

**`-shortest`** ends the file with the shorter input. A procedural soundtrack
often carries a reverb tail past the last cue; without this the video is padded
to match it.

**`-movflags +faststart`** moves the moov atom (the index) to the front of the
file. Without it a browser must download the whole file before it can start
playing — the classic hosted video that spins forever. It costs one extra pass
over the output and is never wrong for web delivery.

## Even dimensions are mandatory

H.264 with 4:2:0 chroma cannot encode odd width or height. An odd stage size
fails at the very end of a long render:

```bash
-vf "scale=trunc(iw/2)*2:trunc(ih/2)*2"
```

Better to catch it before rendering, but keep the filter as a safety net.

## CRF for screen content

CRF is constant *quality*: lower is better, and the encoder spends whatever
bitrate that takes. Screen content compresses far better than camera footage at
the same CRF because it has no grain.

| CRF | Use | Notes |
|---|---|---|
| 14 | Master / archive | Effectively transparent. Large. |
| 18 | **Delivery default** | Visually lossless for UI |
| 20–21 | Long films where size matters | Slight softening on 1px lines |
| 23 | ffmpeg's default | Visibly soft on rim highlights |
| 26+ | Draft previews | Fine for checking timing |

The thing that degrades first in screen content is **thin bright lines on dark
backgrounds** — exactly where a glass material's rim highlights live. Judge a
CRF on a glass panel edge, not on a flat area.

**Two-pass bitrate** exists for a different problem: hitting a size target.

```bash
ffmpeg -y -framerate 30 -i frames/%06d.png -c:v libx264 -b:v 8M -pass 1 -an -f null /dev/null
ffmpeg -y -framerate 30 -i frames/%06d.png -c:v libx264 -b:v 8M -pass 2 -c:a aac out.mp4
```

Use it when a platform imposes a hard cap. Otherwise CRF gives better quality per
byte, because it spends bits where they are needed instead of spreading them
evenly.

## Codec choice

| Codec | Encode | Support | When |
|---|---|---|---|
| **H.264** | Fast | Universal | Default. Always ship one. |
| H.265/HEVC | ~2× slower | Safari yes, Chrome patchy | Only with a fallback |
| VP9 | ~5× slower | Chrome/Firefox/Edge | WebM alongside H.264 |
| AV1 | Very slow | Modern browsers | Large libraries, not one-offs |

For a landing-page hero, H.264 alone is the right answer. The bandwidth AV1 saves
does not repay a ten-minute encode or the compatibility risk.

```bash
# VP9 WebM, offered before the MP4 in a <video> with two <source> elements
ffmpeg -i out.mp4 -c:v libvpx-vp9 -crf 32 -b:v 0 -row-mt 1 out.webm
```

`-b:v 0` is required for VP9 constant-quality mode; without it `-crf` is ignored
and you get constrained-quality instead.

## Platform delivery

Verify these against current platform docs before a launch — they change, and I
cannot check them from here.

| Target | Resolution | Notes |
|---|---|---|
| Web hero loop | 1920×1080 | Muted, no audio track at all, `+faststart` |
| YouTube | 1920×1080 or 3840×2160 | Accepts high bitrates; upload the master |
| LinkedIn | 1920×1080 or 1080×1080 | 10 min cap, 5GB |
| X / Twitter | 1280×720 | 2:20 cap, 512MB, H.264 + AAC only |
| Instagram feed | 1080×1080 or 1080×1350 | 60s cap |
| Instagram story / Reels | 1080×1920 | 90s cap |
| TikTok | 1080×1920 | Prefers ≥ 720p |

**Upload the highest-quality file the platform accepts.** Every platform
re-encodes. Pre-compressing to "save bandwidth" means their encoder works from
your artefacts and adds its own.

## A silent variant for autoplay

Browsers only autoplay muted video. Strip the audio track entirely rather than
setting volume to zero — bytes you ship and nobody hears:

```bash
ffmpeg -i out.mp4 -c:v copy -an hero-muted.mp4
```

`-c:v copy` remuxes without re-encoding: instant, and no generation loss.

## Poster frame

```bash
ffmpeg -i out.mp4 -vf "select=eq(n\,45)" -vframes 1 -q:v 2 poster.jpg
```

Pick a frame where the composition has settled, not frame 0 — the first frame of
a film is usually mid-entrance and reads as broken when it sits as a static
poster.

## Audio

**Normalise loudness.** Inconsistent levels between cues are what separate a
mixed film from a pile of clips.

```bash
ffmpeg -i audio.wav -af loudnorm=I=-16:TP=-1.5:LRA=11 -c:a aac -b:a 192k audio.m4a
```

`-16 LUFS` is the web/streaming target; `-14` matches Spotify; `-23` is EBU R128
broadcast. `TP=-1.5` leaves true-peak headroom so lossy encoding does not clip.

Single-pass `loudnorm` is an estimate. For a final master, run the two-pass form:
measure with `-af loudnorm=print_format=json`, then feed the measured values back
via `measured_I`, `measured_TP`, `measured_LRA` and `measured_thresh`.

**Mux without re-encoding** when the audio is already correct:

```bash
ffmpeg -i video.mp4 -i audio.m4a -c copy -shortest final.mp4
```

## Verify, do not trust

An encode can succeed and still be wrong. Read back what was written:

```bash
ffprobe -v quiet -print_format json -show_streams -show_format out.mp4
```

Assert on four things:

- **`pix_fmt`** is `yuv420p` — the compatibility trap
- **`r_frame_rate`** matches the render, e.g. `30/1`
- **`width`/`height`** match the film
- **`duration`** matches frames ÷ fps, within a frame

For faststart specifically, check that `moov` precedes `mdat`:

```bash
ffprobe -v trace -i out.mp4 2>&1 | grep -o -m2 -E 'type:.(moov|mdat)'
```

## ffmpeg-static

A system ffmpeg cannot be assumed, and asking a user to install one before their
first render is a bad first minute.

```js
import ffmpegPath from 'ffmpeg-static';
spawn(ffmpegPath, args);
```

Two caveats. `ffmpeg-static` resolves to `null` when its postinstall download was
skipped or blocked — check for that and say so, rather than spawning `null`. And
it ships **ffmpeg only, not ffprobe**, so a verification step needs its own
binary (`ffprobe-static`) or must fall back gracefully.

## Reading errors

ffmpeg writes everything to stderr, including progress, and a long render
produces megabytes of it. Keep the tail, not the whole stream, and surface the
last few lines — that is where the actual error is.

The exit code alone tells you nothing beyond success or failure.

## Common mistakes

| Symptom | Cause |
|---|---|
| Black video, no error, in Safari/QuickTime | `yuv444p`; must be `yuv420p` |
| Web video spins before playing | Missing `-movflags +faststart` |
| Playback stutters despite a smooth render | `-r` after `-i` resampled; use `-framerate` before `-i` |
| Encoding fails at the end of a long render | Odd dimensions; add the `scale=trunc` filter |
| First frame missing | Sequence starts at 0; add `-start_number 0` |
| Thin bright lines look soft | CRF too high for screen content; try 18 |
| Video padded with a still at the end | Audio longer than video; add `-shortest` |
| Cues jump in volume | No `loudnorm` pass |
| Audio muddy after editing | Re-encoded lossy → lossy; work from WAV |
| "ffmpeg is not recognised" | Assumed a system binary; use `ffmpeg-static` |
| `ffprobe` missing but ffmpeg works | `ffmpeg-static` ships ffmpeg only |
| Uploaded video looks worse than local | Pre-compressed before upload; send the master |
| Autoplay does not start | Video has an audio track; ship a muted variant |

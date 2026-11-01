import { Section, Table, Panel, Code } from './ui';
import { PROFILES, FRAME_RATES } from '../content/delivery';

export function Delivery() {
  return (
    <Section
      id="delivery"
      label="Delivery"
      title="Deliverable, not merely playable"
      intro="Pick a profile and the encoder, the compiler and the caption writer all read the same numbers. Conformance is reported before a frame is rendered, because the expensive mismatches are all knowable up front."
    >
      <Table head={['Profile', 'Cadence', 'Loudness', 'True peak', 'Standard']}>
        {PROFILES.map((p) => (
          <tr key={p.id}>
            <td>
              <code>{p.id}</code>
            </td>
            <td className="n">{p.cadence}</td>
            <td className="n">{p.loudness}</td>
            <td className="n">{p.truePeak}</td>
            <td>
              {p.standard}
              <span className="sub">{p.gloss}</span>
            </td>
          </tr>
        ))}
      </Table>

      <div className="notice" style={{ marginTop: 18 }}>
        The US and UK figures are kept apart rather than averaged. A film delivered at −23 LUFS
        to a US network is 1 LU hot for ATSC A/85, and one delivered at 29.97 to a UK broadcaster
        is the wrong cadence entirely.
      </div>

      <div className="grid2" style={{ marginTop: 34 }}>
        <Panel title="Frame rates are rationals">
          <p>
            NTSC&rsquo;s colour subcarrier forced a 1000/1001 pulldown in 1953, so
            &ldquo;30fps&rdquo; US video is <Code>30000/1001</Code> and never 29.97 exactly.
            ffmpeg parses <Code>-framerate 29.97</Code> as 2997/100 and writes a timebase that is
            not a legal MP4 cadence for US delivery.
          </p>
          <p className="rates">{FRAME_RATES}</p>
        </Panel>

        <Panel
          title={
            <>
              Photosensitivity <span className="badge ok">checked</span>
            </>
          }
        >
          <p>
            Every render is analysed for flashes against ITU-R BT.1702, the Ofcom Broadcasting
            Code §2.12 and WCAG 2.2 SC 2.3.1 — which agree on the numbers. Maximum{' '}
            <strong>3 flashes per second</strong>, counted only once the flashing region covers
            about a quarter of the frame. The red rule is separate and stricter.
          </p>
          <p>A film that cannot be assessed is reported as unassessed, never as a pass.</p>
        </Panel>

        <Panel title="Safe areas">
          <p>
            EBU R95 and SMPTE RP 218 agree for 16:9 HD: graphics safe at <strong>3.5%</strong> in
            from each edge, title safe at <strong>5%</strong>. On 1920×1080 that is a 1728×972 box
            at (96, 54).
          </p>
          <p>
            Social is harsher: a 9:16 story loses roughly the top 12% and bottom 20% to the
            app&rsquo;s own chrome.
          </p>
        </Panel>

        <Panel title="Captions">
          <p>
            WebVTT and SubRip sidecars, built from the storyboard&rsquo;s narration — never from
            the on-screen titles, which reviewers treat as non-compliant padding. 160 wpm, at most
            2 lines of 37 characters, held between 1 and 7 seconds.
          </p>
          <p>
            A film with no narration gets no file at all. An empty track asserts &ldquo;this has
            been captioned&rdquo; and is worse than its absence.
          </p>
        </Panel>

        <Panel title="Colour">
          <p>
            BT.709 primaries, transfer and matrix, limited range. Tagging is not decoration: an
            untagged H.264 file is interpreted by the player&rsquo;s guess, and the common guess
            is BT.601 — which shifts every saturated colour, most visibly in greens and in brand
            accents near the gamut edge.
          </p>
        </Panel>

        <Panel title="H.264 level">
          <p>
            A function of resolution and frame rate, not a free choice. 1080p up to 30fps fits
            Level 4.0; above that it needs 4.2, and a decoder is entitled to refuse a stream that
            overruns its declared level.
          </p>
        </Panel>
      </div>
    </Section>
  );
}

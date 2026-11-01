import { Section, Panel, Code } from './ui';
import { SKILLS } from '../content/delivery';

export function Craft() {
  return (
    <Section
      id="craft"
      label="Craft"
      title="The rules bind, they aren’t just available"
      intro="Making a skill available to a model does not make the model follow it. A model that has read “cut, do not dissolve” will still crossfade every scene, because nothing stopped it. So the rules bind at four levels, and the last one is not advice."
    >
      <div className="grid2">
        <Panel title="Validated, then repaired or re-asked">
          <p>
            The storyboard is checked against a schema and 13 craft rules before it compiles.
            Fixable violations — a stray ease name, a hold too short to read — are repaired in
            place. Structural ones are re-asked with the failure attached.
          </p>
          <p>
            Rules carry severity. An <span className="badge no">error</span> never reaches the
            renderer; a <span className="badge ok">warning</span> prints and does not block.
          </p>
        </Panel>

        <Panel title="Deterministic below the storyboard">
          <p>
            The engine is driven from one clock, seeded, and seeked frame by frame. Nothing reads
            wall-clock time, nothing fetches at runtime, and CSS that would freeze under
            frame-by-frame export is rejected rather than degraded.
          </p>
          <p>Two renders of the same storyboard produce byte-identical frames.</p>
        </Panel>
      </div>

      <h3 style={{ margin: '32px 0 4px' }}>The craft library</h3>
      <p
        style={{
          color: 'var(--ink-soft)',
          fontSize: 14.5,
          margin: '0 0 14px',
          maxWidth: '60ch',
        }}
      >
        Sixteen skills in markdown, not prompt strings scattered through the code. Read any
        section with <Code>videoai skills &lt;name&gt; &lt;section&gt;</Code>.
      </p>
      <div className="skills">
        {SKILLS.map((s) => (
          <div key={s.name}>
            <code>{s.name}</code>
            <span>{s.gloss}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

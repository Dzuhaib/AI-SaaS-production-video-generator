import { Section, Table, Cmd, Prompt, F, S, C, Code } from './ui';
import { SUBCOMMANDS, CREATE_FLAGS, SLASH } from '../content/commands';

export function Commands() {
  return (
    <Section
      id="commands"
      label="Commands"
      title="The whole surface"
      intro={
        <>
          Run <Code>videoai</Code> with no arguments for the interactive interface, or drive any
          stage directly.
        </>
      }
    >
      <h3 style={{ marginBottom: 12 }}>Subcommands</h3>
      <Table head={['Command', 'What it does']}>
        {SUBCOMMANDS.map((r) => (
          <tr key={r.name}>
            <td style={{ width: 230 }}>
              <code>{r.name}</code>
            </td>
            <td>{r.detail}</td>
          </tr>
        ))}
      </Table>

      <h3 className="subhead">
        Flags for <Code>create</Code>
      </h3>
      <Table head={['Flag', 'Values', 'Notes']}>
        {CREATE_FLAGS.map((f) => (
          <tr key={f.flag}>
            <td style={{ width: 150 }}>
              <code>{f.flag}</code>
            </td>
            <td className="n" style={{ width: 240 }}>
              {f.values}
            </td>
            <td>{f.note}</td>
          </tr>
        ))}
      </Table>

      <h3 className="subhead">Inside the interactive interface</h3>
      <Table head={['Input', 'What it does']}>
        {SLASH.map((r) => (
          <tr key={r.name}>
            <td style={{ width: 230 }}>
              <code>{r.name}</code>
            </td>
            <td>{r.detail}</td>
          </tr>
        ))}
      </Table>

      <h3 className="subhead">Re-running one stage</h3>
      <Cmd>
        <C># storyboard only, then read it before rendering</C>
        {'\n'}
        <Prompt />
        videoai storyboard <S>https://your-saas.com</S> <F>--duration</F> 22{'\n'}
        <Prompt />
        videoai check .videoai/storyboard/main.json{'\n\n'}
        <C># render a slice while iterating</C>
        {'\n'}
        <Prompt />
        videoai render .videoai/film/index.html <F>--from</F> 588 <F>--to</F> 640 <F>--draft</F>
        {'\n\n'}
        <C># vertical cut of the same storyboard</C>
        {'\n'}
        <Prompt />
        videoai create <S>https://your-saas.com</S> <F>--aspect</F> 9:16 <F>--out</F> story.mp4
      </Cmd>
    </Section>
  );
}

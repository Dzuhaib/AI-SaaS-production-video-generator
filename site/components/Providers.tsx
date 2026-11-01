import { Section, Table, Cmd, Prompt, F, S, C, Code } from './ui';
import { PROVIDER_KEYS } from '../content/commands';

export function Providers() {
  return (
    <Section
      id="providers"
      label="Providers"
      title="One key, from whichever vendor you already pay"
      intro="One adapter covers OpenAI, Mistral and every OpenAI-compatible endpoint — Ollama, vLLM, LM Studio, OpenRouter, or a gateway. The wire format is identical, and duplicating it would mean fixing each bug five times."
    >
      <div className="grid2">
        <div>
          <h3>First-party</h3>
          <Table head={['Provider', 'Env var']} narrow>
            {PROVIDER_KEYS.map((p) => (
              <tr key={p.name}>
                <td>
                  <code>{p.name}</code>
                </td>
                <td className="n">{p.detail}</td>
              </tr>
            ))}
          </Table>
        </div>

        <div>
          <h3>Anything OpenAI-compatible</h3>
          <Cmd>
            <Prompt />
            videoai config <F>--provider</F> custom <F>\</F>
            {'\n    '}
            <F>--key</F> sk-... <F>\</F>
            {'\n    '}
            <F>--base-url</F> <S>https://gateway.example/v1</S> <F>\</F>
            {'\n    '}
            <F>--model</F> claude-opus-5 <F>\</F>
            {'\n    '}
            <F>--header</F> <S>&quot;user-agent: my-client/1.0&quot;</S>
            {'\n\n'}
            <C># a local model needs no key at all</C>
            {'\n'}
            <Prompt />
            videoai config <F>--provider</F> custom <F>\</F>
            {'\n    '}
            <F>--base-url</F> <S>http://localhost:11434/v1</S> <F>\</F>
            {'\n    '}
            <F>--model</F> qwen2.5:32b
          </Cmd>
          <p style={{ color: 'var(--ink-soft)', fontSize: 14, marginTop: 14 }}>
            <Code>--header</Code> exists because some gateways authenticate the client as well
            as the key, and reject an unrecognised user-agent with a 401 that reads exactly like
            a bad key.
          </p>
        </div>
      </div>
    </Section>
  );
}

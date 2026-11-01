import { Section, Cmd, Prompt, F, S, C, Code } from './ui';

export function Install() {
  return (
    <Section
      id="install"
      label="Install"
      title="Two commands and one API key"
      intro="Nothing about the site you film needs to be yours, beyond it being publicly reachable."
    >
      <div className="grid2">
        <div>
          <h3>Global install</h3>
          <Cmd>
            <Prompt />
            npm install -g videoai-cli{'\n'}
            <Prompt />
            npx playwright-core install chromium{'\n'}
            <C># ~150MB, once</C>
            {'\n\n'}
            <Prompt />
            videoai doctor{'\n'}
            {'  node       v24.19.0\n'}
            {'  chromium   found\n'}
            {'  ffmpeg     bundled\n'}
            {'  provider   anthropic'}
          </Cmd>

          <div className="notice" style={{ marginTop: 18 }}>
            <strong>
              It is <Code>playwright-core</Code>, not <Code>playwright</Code>.
            </strong>{' '}
            Each Playwright release expects one exact browser revision, so the generic installer
            can leave this one still looking for a revision that was never downloaded.
          </div>
        </div>

        <div>
          <h3>Store a key</h3>
          <Cmd>
            <C># any one of these is enough</C>
            {'\n'}
            <Prompt />
            export ANTHROPIC_API_KEY=sk-...{'\n'}
            <Prompt />
            export OPENAI_API_KEY=sk-...{'\n'}
            <Prompt />
            export GEMINI_API_KEY=...{'\n'}
            <Prompt />
            export MISTRAL_API_KEY=...{'\n\n'}
            <C># or keep it in the credential store</C>
            {'\n'}
            <Prompt />
            videoai config <F>--provider</F> anthropic <F>--key</F> sk-...{'\n\n'}
            <Prompt />
            videoai providers{'\n'}
            <Prompt />
            videoai models
          </Cmd>
          <p style={{ color: 'var(--ink-soft)', fontSize: 14, marginTop: 14 }}>
            ffmpeg ships with the package. Chromium is the only download.
          </p>
        </div>
      </div>
    </Section>
  );
}

export function Start() {
  return (
    <Section id="start" label="Start" title="Film a site in the next two minutes">
      <Cmd>
        <Prompt />
        npm install -g videoai-cli{'\n'}
        <Prompt />
        npx playwright-core install chromium{'\n'}
        <Prompt />
        export ANTHROPIC_API_KEY=sk-...{'\n'}
        <Prompt />
        videoai create <S>https://your-saas.com</S> <F>--prompt</F>{' '}
        <S>&quot;24 second launch film&quot;</S> <F>--draft</F>
      </Cmd>
      <p
        style={{
          color: 'var(--ink-soft)',
          fontSize: 14.5,
          marginTop: 16,
          maxWidth: '60ch',
        }}
      >
        Start with <Code>--draft</Code> while you iterate on the prompt, then drop the flag for
        the master.
      </p>
    </Section>
  );
}

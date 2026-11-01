const ITEMS = [
  {
    q: 'Do I need to own the site?',
    a: 'No. It only has to be publicly reachable.',
  },
  {
    q: 'Which model writes the storyboard?',
    a: 'Anthropic, OpenAI, Gemini, Mistral — or any OpenAI-compatible endpoint.',
  },
  {
    q: 'What do I get back?',
    a: 'A 1080p H.264 master with captions, a loudness report and safe-area checks.',
  },
] as const;

export function Faq() {
  return (
    <div className="faq">
      {ITEMS.map((item, index) => (
        <details className="faq-item" key={item.q}>
          <summary>
            <span className="faq-index mono">{String(index + 1).padStart(2, '0')}</span>
            <span className="faq-q">{item.q}</span>
            <span className="faq-x" aria-hidden="true">
              <i />
              <i />
            </span>
          </summary>
          <p className="faq-a">{item.a}</p>
        </details>
      ))}
    </div>
  );
}

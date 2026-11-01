'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button
      type="button"
      className={`copy ${copied ? 'is-copied' : ''}`}
      onClick={copy}
      aria-label={copied ? 'Copied to clipboard' : `Copy ${label}`}
    >
      <svg className="copy-icon" viewBox="0 0 16 16" aria-hidden="true">
        {copied ? (
          <path d="m3 8.5 3.2 3.2L13 4.7" />
        ) : (
          <>
            <rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.6" />
            <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
          </>
        )}
      </svg>
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

function lineNodes(line: string): ReactNode {
  if (line.trimStart().startsWith('#')) {
    return <span className="tok-com">{line}</span>;
  }
  const parts = line.split(/(--[\w-]+|https?:\/\/\S+|"[^"]*")/g);
  return parts.map((part, index) => {
    if (part.startsWith('--')) {
      return (
        <span className="tok-flag" key={index}>
          {part}
        </span>
      );
    }
    if (part.startsWith('http')) {
      return (
        <span className="tok-url" key={index}>
          {part}
        </span>
      );
    }
    if (part.startsWith('"')) {
      return (
        <span className="tok-str" key={index}>
          {part}
        </span>
      );
    }
    return part;
  });
}

export function CommandBlock({
  lines,
  title = 'terminal',
  note,
}: {
  lines: readonly string[];
  title?: string;
  note?: string;
}) {
  return (
    <div className="cmd-block">
      <div className="cmd-head">
        <span className="cmd-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="cmd-title">{title}</span>
        <CopyButton text={lines.join('\n')} label={title} />
      </div>
      <pre className="cmd-body" aria-label={title}>
        {lines.map((line, index) => (
          <span className="cmd-line" key={index}>
            {line.trimStart().startsWith('#') ? null : (
              <span className="cmd-prompt" aria-hidden="true">
                ${' '}
              </span>
            )}
            {lineNodes(line)}
            {'\n'}
          </span>
        ))}
      </pre>
      {note ? <p className="cmd-note">{note}</p> : null}
    </div>
  );
}

export function CopyPill({ text, children }: { text: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className={`copy-pill ${copied ? 'is-copied' : ''}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
    >
      <span className="copy-pill-label">{children}</span>
      <span className="copy-pill-dot" aria-hidden="true" />
      <span className="copy-pill-state">{copied ? 'copied' : 'copy'}</span>
    </button>
  );
}

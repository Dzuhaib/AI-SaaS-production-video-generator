import type { ReactNode } from 'react';

/** A shell command block. `<Prompt />` marks the `$` so it is not selectable. */
export function Cmd({ children }: { children: ReactNode }) {
  return <pre className="cmd">{children}</pre>;
}

export function Prompt() {
  return <span className="p">$ </span>;
}

/** A flag, e.g. --prompt. */
export function F({ children }: { children: ReactNode }) {
  return <span className="f">{children}</span>;
}

/** A string literal or URL argument. */
export function S({ children }: { children: ReactNode }) {
  return <span className="s">{children}</span>;
}

/** A shell comment. */
export function C({ children }: { children: ReactNode }) {
  return <span className="c">{children}</span>;
}

/** Inline code inside running text. */
export function Code({ children }: { children: ReactNode }) {
  return <code className="inline">{children}</code>;
}

export function Section({
  id,
  label,
  title,
  intro,
  children,
  first,
}: {
  id: string;
  label: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  first?: boolean;
}) {
  return (
    <section id={id} className="section" style={first ? { borderTop: 'none' } : undefined}>
      <div className="wrap">
        <div className="shead">
          <span className="snum">{label}</span>
          <h2>{title}</h2>
          {intro ? <p>{intro}</p> : null}
        </div>
        {children}
      </div>
    </section>
  );
}

export function Panel({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="panel">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Table({
  head,
  children,
  narrow,
}: {
  head: readonly string[];
  children: ReactNode;
  narrow?: boolean;
}) {
  return (
    <div className={narrow ? 'tscroll tnarrow' : 'tscroll'}>
      <table>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

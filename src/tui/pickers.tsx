/**
 * Selection components for the interactive interface.
 *
 * One keyboard-driven list, reused for every choice: slash commands, providers,
 * base URLs, models. A single implementation means arrow keys, filtering, paging and
 * escape behave identically everywhere, which is the difference between a tool that
 * feels learned and one that has to be re-learned per screen.
 *
 * Ink has no built-in list that filters, so this is hand-rolled. The parts that look
 * fussy — the window arithmetic, the clamped index — are what stop a 40-model
 * catalogue from painting past the bottom of a terminal.
 */

import { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

export interface Choice {
  /** Returned to the caller on select. */
  value: string;
  /** Shown in the list. */
  label: string;
  /** Dimmed, after the label. */
  hint?: string;
  /** Matched against the filter as well as the label. */
  keywords?: string;
}

interface SelectProps {
  title: string;
  choices: Choice[];
  onSelect: (value: string) => void;
  onCancel: () => void;
  /** Show a filter input. Worth it past ~8 rows. */
  filterable?: boolean;
  /** Rows visible at once. */
  height?: number;
  footer?: string;
}

export function Select({
  title,
  choices,
  onSelect,
  onCancel,
  filterable = false,
  height = 9,
  footer,
}: SelectProps): JSX.Element {
  const [index, setIndex] = useState(0);
  const [filter, setFilter] = useState('');

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return choices;
    return choices.filter((c) =>
      `${c.label} ${c.value} ${c.keywords ?? ''}`.toLowerCase().includes(needle)
    );
  }, [choices, filter]);

  // Filtering can strip the list out from under the cursor, so the index is clamped
  // whenever the visible set changes rather than only on keypress.
  useEffect(() => {
    setIndex((i) => Math.max(0, Math.min(i, visible.length - 1)));
  }, [visible.length]);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow || (key.ctrl && input === 'p')) {
      setIndex((i) => (i <= 0 ? visible.length - 1 : i - 1));
      return;
    }
    if (key.downArrow || (key.ctrl && input === 'n')) {
      setIndex((i) => (i >= visible.length - 1 ? 0 : i + 1));
      return;
    }
    if (key.return) {
      const chosen = visible[index];
      if (chosen) onSelect(chosen.value);
      return;
    }
    // Number shortcuts, but only unfiltered — otherwise typing "4o" to find a model
    // would select row 4 instead.
    if (!filterable && /^[1-9]$/.test(input)) {
      const chosen = visible[Number(input) - 1];
      if (chosen) onSelect(chosen.value);
    }
  });

  // A window rather than the whole list: a long catalogue would otherwise scroll the
  // prompt off the screen.
  const start = Math.max(0, Math.min(index - Math.floor(height / 2), visible.length - height));
  const window = visible.slice(Math.max(0, start), Math.max(0, start) + height);
  const offset = Math.max(0, start);

  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>

      {filterable ? (
        <Box>
          <Text color="gray">filter </Text>
          <TextInput value={filter} onChange={setFilter} placeholder="type to narrow" />
        </Box>
      ) : null}

      {visible.length === 0 ? (
        <Text color="yellow">  nothing matches</Text>
      ) : (
        window.map((choice, i) => {
          const active = offset + i === index;
          return (
            <Box key={choice.value}>
              {/* `color` is spread rather than passed as undefined: under
                  exactOptionalPropertyTypes an explicit undefined is not the same as
                  an absent prop, and Ink's default colour is the absent case. */}
              <Text {...(active ? { color: 'cyan' as const } : {})}>
                {active ? '❯ ' : '  '}
                {!filterable && offset + i < 9 ? `${offset + i + 1}. ` : ''}
                {choice.label}
              </Text>
              {choice.hint ? <Text color="gray">{`  ${choice.hint}`}</Text> : null}
            </Box>
          );
        })
      )}

      {visible.length > height ? (
        <Text color="gray">{`  … ${visible.length - height} more`}</Text>
      ) : null}

      <Text color="gray">{footer ?? '  ↑↓ move · enter select · esc cancel'}</Text>
    </Box>
  );
}

/* ------------------------------------------------------------------ *
 * Text prompt
 * ------------------------------------------------------------------ */

interface AskProps {
  title: string;
  placeholder?: string;
  /** Render as dots. Used for keys, so one is never left on screen. */
  mask?: boolean;
  initial?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  footer?: string;
}

export function Ask({
  title,
  placeholder,
  mask = false,
  initial = '',
  onSubmit,
  onCancel,
  footer,
}: AskProps): JSX.Element {
  const [value, setValue] = useState(initial);

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      <Box>
        <Text color="cyan">❯ </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={() => {
            const trimmed = value.trim();
            if (trimmed) onSubmit(trimmed);
          }}
          {...(placeholder !== undefined ? { placeholder } : {})}
          // A pasted key stays out of the scrollback and off the screen.
          {...(mask ? { mask: '•' } : {})}
        />
      </Box>
      <Text color="gray">{footer ?? '  enter confirm · esc cancel'}</Text>
    </Box>
  );
}

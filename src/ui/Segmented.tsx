// A segmented choice (style: .segmented, .segment): a row of options with an underline under the
// chosen one. Built on native radios, so arrow keys move between options and screen readers announce
// it as a radio group. Options can optionally be reordered by dragging one onto another.

import type { ComponentChildren } from 'preact';
import { useId, useState } from 'preact/hooks';
import { cx } from './cx';

export interface Segment<T extends string> {
  value: T;
  label: ComponentChildren;
  /** A number shown after the label in a quieter tone. */
  count?: ComponentChildren;
  /** Can be dragged onto another movable option to reorder them (needs `onReorder`). */
  movable?: boolean;
}

interface SegmentedProps<T extends string> {
  /** The group's accessible name (not shown). */
  legend: string;
  options: ReadonlyArray<Segment<T>>;
  value: T;
  onChange: (value: T) => void;
  /** `moved` was dropped on `target`: move it to the target's place. */
  onReorder?: (moved: T, target: T) => void;
}

export function Segmented<T extends string>({
  legend,
  options,
  value,
  onChange,
  onReorder,
}: SegmentedProps<T>) {
  const name = useId();
  const [dragged, setDragged] = useState<T | null>(null);
  const [over, setOver] = useState<T | null>(null);
  const end = () => {
    setDragged(null);
    setOver(null);
  };

  return (
    <fieldset class="segmented">
      <legend class="visually-hidden">{legend}</legend>
      {options.map((option) => {
        const movable = option.movable === true && onReorder !== undefined;
        const target = movable && dragged !== null && dragged !== option.value;
        return (
          // The label wraps the radio that keyboards and screen readers use; dragging is an extra
          // for the mouse, so the drag listeners sit on the label, the element being dragged.
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
          <label
            class={cx(
              'segment',
              dragged === option.value && 'is-dragged',
              over === option.value && 'is-drop-target',
            )}
            key={option.value}
            draggable={movable}
            onDragStart={(event) => {
              if (!movable || event.dataTransfer === null) return;
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', option.value);
              setDragged(option.value);
            }}
            onDragOver={(event) => {
              if (!target) return;
              event.preventDefault();
              if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move';
              setOver(option.value);
            }}
            onDragLeave={() => setOver((current) => (current === option.value ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              if (target) onReorder(dragged, option.value);
              end();
            }}
            onDragEnd={end}
          >
            <input
              class="visually-hidden"
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            {option.label}
            {option.count !== undefined && <span class="segment-count">{option.count}</span>}
          </label>
        );
      })}
    </fieldset>
  );
}

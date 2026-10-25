// A segmented choice (style: .segmented, .segment): a row of options with an underline under the
// chosen one. Built on native radios, so arrow keys move between options and screen readers announce
// it as a radio group.

import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';

export interface Segment<T extends string> {
  value: T;
  label: ComponentChildren;
  /** A number shown after the label in a quieter tone. */
  count?: ComponentChildren;
}

interface SegmentedProps<T extends string> {
  /** The group's accessible name (not shown). */
  legend: string;
  options: ReadonlyArray<Segment<T>>;
  value: T;
  onChange: (value: T) => void;
}

export function Segmented<T extends string>({
  legend,
  options,
  value,
  onChange,
}: SegmentedProps<T>) {
  const name = useId();
  return (
    <fieldset class="segmented">
      <legend class="visually-hidden">{legend}</legend>
      {options.map((option) => (
        <label class="segment" key={option.value}>
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
      ))}
    </fieldset>
  );
}

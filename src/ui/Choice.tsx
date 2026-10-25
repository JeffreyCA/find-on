// Native radio groups and checkboxes with labels and optional hints (style: .choices, .choice).

import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';
import { cx } from './cx';

export interface RadioOption<T extends string> {
  value: T;
  label: ComponentChildren;
  /** A short line under the label. */
  hint?: ComponentChildren;
}

interface RadioGroupProps<T extends string> {
  /** The group's accessible name (not shown: a heading or label next to it says it). */
  legend: ComponentChildren;
  options: ReadonlyArray<RadioOption<T>>;
  /** The checked option; null leaves every option unchecked (nothing chosen yet). */
  value: T | null;
  onChange: (value: T) => void;
  /** Lay the options out in a row. */
  inline?: boolean;
  class?: string;
}

export function RadioGroup<T extends string>({
  legend,
  options,
  value,
  onChange,
  inline = false,
  class: extra,
}: RadioGroupProps<T>) {
  const name = useId();
  return (
    <fieldset class={cx('choices', inline && 'is-inline', extra)}>
      <legend class="visually-hidden">{legend}</legend>
      {options.map((option) => {
        const hintId = option.hint === undefined ? undefined : `${name}-${option.value}-hint`;
        return (
          <label class="choice" key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              aria-describedby={hintId}
              onChange={() => onChange(option.value)}
            />
            <span class="choice-label">{option.label}</span>
            {option.hint !== undefined && (
              // Hidden from the name (it is inside the label) but still read as the description.
              <span class="choice-hint" id={hintId} aria-hidden="true">
                {option.hint}
              </span>
            )}
          </label>
        );
      })}
    </fieldset>
  );
}

interface CheckboxProps {
  label: ComponentChildren;
  hint?: ComponentChildren;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Checkbox({ label, hint, checked, onChange }: CheckboxProps) {
  const hintId = useId();
  return (
    <label class="choice">
      <input
        type="checkbox"
        checked={checked}
        aria-describedby={hint === undefined ? undefined : hintId}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span class="choice-label">{label}</span>
      {hint !== undefined && (
        // Hidden from the name (it is inside the label) but still read as the description.
        <span class="choice-hint" id={hintId} aria-hidden="true">
          {hint}
        </span>
      )}
    </label>
  );
}

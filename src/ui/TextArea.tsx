// A monospace text area that grows with its content (CSS field-sizing), for one-entry-per-line lists.

import type { TextareaHTMLAttributes } from 'preact';
import { cx } from './cx';

type TextAreaProps = Omit<TextareaHTMLAttributes, 'class' | 'className' | 'value' | 'onInput'> & {
  value: string;
  onInput: (value: string) => void;
  class?: string;
};

export function TextArea({ value, onInput, class: extra, ...rest }: TextAreaProps) {
  return (
    <textarea
      class={cx('textarea', extra)}
      spellcheck={false}
      autocomplete="off"
      autocapitalize="off"
      value={value}
      onInput={(event) => onInput(event.currentTarget.value)}
      {...rest}
    />
  );
}

// Buttons and button-styled links. Variants: "default" (outlined), "primary" (filled ink) and
// "text" (an underlined action that sits inside a line of text).

import type { ButtonHTMLAttributes, ComponentChildren, PartialAnchorHTMLAttributes } from 'preact';
import { cx } from './cx';

export type ButtonVariant = 'default' | 'primary' | 'text';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  default: 'btn',
  primary: 'btn btn-primary',
  text: 'btn-text',
};

type ButtonProps = Omit<ButtonHTMLAttributes, 'class' | 'className'> & {
  variant?: ButtonVariant;
  class?: string;
};

export function Button({
  variant = 'default',
  class: extra,
  type = 'button',
  ...rest
}: ButtonProps) {
  return <button type={type} class={cx(VARIANT_CLASS[variant], extra)} {...rest} />;
}

type LinkButtonProps = Omit<
  PartialAnchorHTMLAttributes<HTMLAnchorElement>,
  'class' | 'className' | 'role'
> & {
  href: string;
  children: ComponentChildren;
  variant?: ButtonVariant;
  class?: string;
};

/** A real link (`href`) that looks like a button. */
export function LinkButton({
  variant = 'default',
  class: extra,
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <a class={cx(VARIANT_CLASS[variant], extra)} {...rest}>
      {children}
    </a>
  );
}

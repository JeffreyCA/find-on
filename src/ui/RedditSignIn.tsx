// Reddit sign-in status with its one action, for the options and welcome pages.

import { redditLoginUrl, type RedditHost } from '@/core/links';
import { Button, LinkButton } from './Button';
import type { RedditSignIn } from './hooks';
import { StatusText } from './StatusText';

interface Props {
  status: RedditSignIn;
  check: () => void;
  host: RedditHost;
}

export function RedditSignInStatus({ status, check, host }: Props) {
  const again = (label: string) => (
    <Button variant="text" onClick={check}>
      {label}
    </Button>
  );
  return (
    <span class="reddit-sign-in" aria-live="polite">
      {status === 'unknown' && again('Check sign-in')}
      {status === 'checking' && <StatusText>Checking</StatusText>}
      {status === 'signed-in' && (
        <>
          <StatusText tone="ok">Signed in</StatusText>
          {again('Check again')}
        </>
      )}
      {status === 'signed-out' && (
        <>
          <StatusText>Not signed in</StatusText>
          <LinkButton variant="text" href={redditLoginUrl(host)} target="_blank" rel="noreferrer">
            Sign in on reddit.com
          </LinkButton>
          {again('Check again')}
        </>
      )}
      {status === 'error' && (
        <>
          <StatusText tone="attention">Couldn't check</StatusText>
          {again('Try again')}
        </>
      )}
    </span>
  );
}

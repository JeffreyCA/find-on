// The GitHub mark, linking to Find On's repository (options and welcome pages).

import { cx } from './cx';
import { GitHubIcon } from './icons';

export const REPO_URL = 'https://github.com/JeffreyCA/find-on';

export function RepoLink({ class: extra }: { class?: string }) {
  return (
    <a
      class={cx('icon-btn', extra)}
      href={REPO_URL}
      target="_blank"
      rel="noreferrer"
      aria-label="Find On on GitHub"
      title="GitHub"
    >
      <GitHubIcon />
    </a>
  );
}

// The welcome page, opened on install: what is sent where, how pages are checked,
// and whether Reddit has a sign-in to use. Picking how pages are checked is the whole confirmation:
// it saves at once and automatic checks can start.

import { browser } from '#imports';
import { useEffect, useState } from 'preact/hooks';
import { onboardedItem, type Settings } from '@/platform/settings';
import { Logo } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { RadioGroup } from '@/ui/Choice';
import { disclosure } from '@/ui/disclosure';
import { updateSettings, useRedditSignIn, useSettings, useStorageItem } from '@/ui/hooks';
import { RedditSignInStatus } from '@/ui/RedditSignIn';
import { RepoLink } from '@/ui/RepoLink';
import { StatusText } from '@/ui/StatusText';

type Mode = 'auto' | 'manual';

export function Welcome() {
  const settings = useSettings();
  const onboarded = useStorageItem(onboardedItem);
  // The choice shows the stored state once there is one, so wait for both reads.
  if (settings === undefined || onboarded === undefined) return null;
  return <WelcomePage settings={settings} onboarded={onboarded} />;
}

function WelcomePage({ settings, onboarded }: { settings: Settings; onboarded: boolean }) {
  // The option just clicked, shown until the stored values catch up.
  const [picked, setPicked] = useState<Mode | null>(null);
  const [saved, setSaved] = useState<boolean | null>(null);
  const reddit = settings.sources.reddit;
  const stored: Mode | null = onboarded ? (settings.autoCheck ? 'auto' : 'manual') : null;
  useEffect(() => {
    if (picked !== null && picked === stored) setPicked(null);
  }, [picked, stored]);

  const choose = (next: Mode) => {
    setPicked(next);
    updateSettings({ autoCheck: next === 'auto' })
      .then(() => onboardedItem.setValue(true))
      .then(
        () => setSaved(true),
        (error: unknown) => {
          console.error('Find On: saving the choice failed', error);
          setPicked(null);
          setSaved(false);
        },
      );
  };

  const counts = settings.badge === 'comments' ? 'comment' : 'discussion';

  return (
    <main class="page welcome">
      <header class="welcome-head">
        <Logo size={40} />
        <h1>Find On</h1>
        <RepoLink class="welcome-repo" />
      </header>
      <p class="welcome-lede">
        {disclosure(settings.sources) ?? 'No sources are enabled in settings, so nothing is sent.'}
      </p>

      <section class="welcome-section" aria-labelledby="check-heading">
        <div class="welcome-section-head">
          <h2 id="check-heading">Lookup mode</h2>
          <output class="welcome-status">
            {saved === true && <StatusText tone="ok">Saved</StatusText>}
            {saved === false && <StatusText tone="attention">Couldn't save. Try again</StatusText>}
          </output>
        </div>
        <RadioGroup
          legend="Lookup mode"
          class="welcome-modes"
          // Nothing is chosen until the user picks one (here, in the popup or in settings).
          value={picked ?? stored}
          onChange={choose}
          options={[
            {
              value: 'auto',
              label: 'Automatic',
              hint: `Looks up page as it loads, subject to the site filter. The toolbar badge shows the ${counts} count.`,
            },
            {
              value: 'manual',
              label: 'Manual',
              hint: 'Looks up the current page only when you click the toolbar button or use the keyboard shortcut.',
            },
          ]}
        />
      </section>

      {reddit && <RedditSection settings={settings} />}

      <footer class="welcome-foot">
        <Button
          variant="text"
          onClick={() => {
            browser.runtime.openOptionsPage().catch((error: unknown) => {
              console.error('Find On: opening settings failed', error);
            });
          }}
        >
          All settings
        </Button>
      </footer>
    </main>
  );
}

/** Checked on open and again whenever the user comes back to this tab (e.g. after signing in). */
function RedditSection({ settings }: { settings: Settings }) {
  const { status, check } = useRedditSignIn({ auto: true, onFocus: true });
  return (
    <section class="welcome-section" aria-labelledby="reddit-heading">
      <h2 id="reddit-heading">Reddit</h2>
      <RedditSignInStatus status={status} check={check} host={settings.redditHost} />
      {status === 'signed-out' && (
        <p class="hint">Until you sign in, only Hacker News is searched.</p>
      )}
    </section>
  );
}

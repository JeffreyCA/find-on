# Find On

Find On is a Chrome and Edge extension that shows Hacker News and Reddit discussions of the page you're on. It can look up each page as it loads and show the discussion count on the toolbar badge, or look up pages only when you click the toolbar button.

![The Find On popup listing Hacker News and Reddit discussions of xkcd.com/927](store/screenshots/1-results.png)

## Install

- [Chrome Web Store](https://chromewebstore.google.com/detail/dhbjhlhecoimpegffjpmagkhiflkbepe)
- [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/find-on-reddit-hacker/pokgoanaapnbijafopjbgfbcjhhimknl)

Reddit results require a signed-in reddit.com session in the same browser profile.

## How matching works

- Before a lookup, Find On cleans the URL. It removes tracking parameters (`utm_*`, `fbclid` and the rest of Brave's and Firefox's lists), parameters that look like secrets (tokens, keys, signatures, session IDs) and the `#` fragment. It also unwraps AMP, Wayback Machine, archive.today and redirect links.
- A discussion matches when it links to the same cleaned URL, or to the same content on a site with stable IDs: YouTube videos and playlists, arXiv papers (any version), Twitter/X posts, GitHub repos, Medium posts and Stack Exchange questions.
- Looser matches, such as `m.` or `amp.` hosts, `/amp` paths or extra parameters like `?ref=`, are listed under "Other versions" and don't count toward the badge.
- On a Hacker News or Reddit thread, Find On looks up the page the thread links to and marks the thread you're on.

## Mentions

When you open the popup, Find On also looks for Hacker News comments and text posts, and Reddit posts, that link to the page. None of these count toward the badge.

- Posts that link to the page in their text or title are listed with the discussions. The "Text posts" toggle hides them.
- "Mentioned in comments" lists Hacker News threads where a comment links to the page.
- Find On can't search Reddit comments. Instead, "Search Reddit comments" opens Reddit's own comment search for the page in a new tab.

## Privacy

Find On has no server and no analytics. Lookups go directly from the browser to Hacker News search (`hn.algolia.com`, run by Algolia) and to Reddit (`old.reddit.com`). Hacker News requests carry no cookies. Reddit requests carry your reddit.com cookies, so Reddit can associate the lookups with your account.

Automatic mode (the default) sends the URL of every page you load, except sites on the blocklist (webmail, search and chat sites by default, editable in settings). Manual mode sends a URL only when you open the popup or use the context menu. URLs that aren't public web pages, such as `localhost`, IP addresses or `.local` hosts, are never sent, and nothing is sent to Reddit from private windows.

Lookup results are kept in memory and cleared when the browser closes. Settings are kept in the browser's sync storage. The full policy is in [PRIVACY.md](PRIVACY.md).

## Development

Requires Node 24 (see `.nvmrc`).

```sh
npm ci
npm run dev
```

`npm run dev` builds `.output/chrome-mv3-dev` and rebuilds on change. It does not start a browser. To load the build, open `chrome://extensions` (or `edge://extensions`), enable Developer mode, click "Load unpacked" and select the folder. Testing Reddit results requires a profile signed in to reddit.com.

| Command                        | What it does                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                | Format check, lint, typecheck, unit tests and a production build. CI runs this, then the e2e tests.                                 |
| `npm test`                     | Unit tests (Vitest).                                                                                                                |
| `npm run format`               | Formats the code with oxfmt.                                                                                                        |
| `npm run test:e2e`             | Builds, then runs the Playwright tests in Chromium against a mocked network. Needs `openssl` and `npx playwright install chromium`. |
| `npm run zip`                  | Writes `.output/find-on-<version>-chrome.zip`, the package for both stores.                                                         |
| `npm run update-tracking-list` | Regenerates the tracking-parameter list from Brave's and Firefox's lists. A weekly workflow runs it and opens a pull request.       |
| `npm run smoke:hn`             | Runs real Hacker News lookups for a few known pages.                                                                                |

To release, push a `v<version>` tag on main. The Release workflow checks the tag, builds the zip and publishes a GitHub release with that version's changelog section. See `.agents/skills/release/SKILL.md` for the full steps.

## Project layout

```text
src/core/         URL cleaning and matching, HN and Reddit providers, lookup, rate guard (no browser APIs)
src/platform/     Browser adapters: settings, cache, badge, automatic lookups, context menu, messaging
src/entrypoints/  Background service worker, popup, options and welcome pages
src/ui/           Shared Preact components and design tokens for those pages
src/assets/       Icon source (SVG)
scripts/          Tracking-list generator and Hacker News smoke test
e2e/              Playwright tests
store/            Store screenshots
```

## Credits

Originally forked from [AdeelH/find-on-reddit](https://github.com/AdeelH/find-on-reddit). v2 is a complete rewrite.

The tracking-parameter list in `src/core/url/tracking-params.generated.json` is generated from Brave's [adblock-lists](https://github.com/brave/adblock-lists) and Firefox's [StripOnShare list](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/antitracking/StripOnShareLists/MPL2/StripOnShare.json), and is licensed under the [Mozilla Public License 2.0](src/core/url/MPL-2.0.txt). The rest of the project is licensed under the [MIT License](LICENSE).

The Hacker News and Reddit names and favicons belong to their owners and are used only to label links to their sites.

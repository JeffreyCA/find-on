# Find On

Find On is a Chrome and Edge extension that shows Hacker News and Reddit discussions of the page you're on.

![The Find On popup listing Hacker News and Reddit discussions of xkcd.com/927](store/screenshots/1-results.png)

## Install

- [Chrome Web Store](https://chromewebstore.google.com/detail/dhbjhlhecoimpegffjpmagkhiflkbepe)
- [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/find-on-reddit-hacker/pokgoanaapnbijafopjbgfbcjhhimknl)

Reddit results require a signed-in reddit.com session in the same browser profile.

## Features

- Looks up pages as they load, or only when you click the toolbar button, and shows the discussion count on the toolbar badge.
- Removes tracking parameters and unwraps AMP, archive and redirect links before matching, and recognizes the same YouTube video, arXiv paper or GitHub repo under different URLs.
- Also finds text posts and Hacker News comments that link to the page.
- Customizable site filter: a blocklist (webmail, search and chat sites by default) or an allowlist.

## Privacy

There is no Find On server and no analytics. Page URLs go directly from the browser to Hacker News search (`hn.algolia.com`) and Reddit (`old.reddit.com`), and Reddit requests carry your reddit.com cookies. In automatic mode, every page you load is looked up unless its site is skipped. See [PRIVACY.md](PRIVACY.md) for details.

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

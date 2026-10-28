# Privacy Policy

**Last updated:** 2026-10-27 · **Applies to:** Find On 2.0 and later, for Google Chrome and Microsoft Edge

Find On looks up the page you're on in Hacker News and Reddit. It has no server of its own: every request goes directly from your browser to the services listed below. There is no analytics, advertising or sale of data.

## Summary

| Data                                               | Sent to                                                  | When                                                                                                        |
| -------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Search terms derived from the cleaned page URL     | Hacker News search (`hn.algolia.com`, run by Algolia)    | Each lookup, if the Hacker News source is enabled; one or two more searches on manual lookups               |
| The cleaned page URL, with your reddit.com cookies | Reddit (`old.reddit.com`)                                | Each lookup, if the Reddit source is enabled; one more search on manual lookups; never from private windows |
| The cleaned page URL and the page title            | The Hacker News or Reddit submit page                    | Only when you click "Submit to Hacker News" or "Submit to Reddit"                                           |
| A search term from the cleaned page URL            | Reddit's comment search (`www.reddit.com`), in a new tab | Only when you click "Search Reddit comments"                                                                |

## Data Find On reads

Find On reads the URL and title of your browser tabs. It does not read page content. The title is used only to prefill a submit link when you click one.

## When lookups happen

- **Automatic lookups** (the default lookup mode): when a page finishes loading in the active tab, when you switch to a tab that has not been looked up yet, and for the active tab when the browser starts. They start only after you choose a lookup mode on the welcome page or in the popup, or change a setting. They respect the site filter: sites on the blocklist are skipped (also when a Hacker News or Reddit thread links to one), or, in allowlist mode, only listed sites are looked up.
- **Manual lookups**: when you open the popup (toolbar button or keyboard shortcut), choose "Find discussions for this link" or "Find discussions for this page" from the context menu, or enter a URL in the popup.

Manual lookups also search for threads that link to the page: Hacker News comments and text posts, and Reddit posts. Automatic lookups don't.

Find On never looks up URLs that are not public web pages: anything other than `http` and `https`, URLs that contain a user name or password, `localhost`, IP addresses, single-label host names, and private domains such as `.local`, `.internal`, `.lan`, `.home.arpa` or `.onion`.

## What is sent

### URL cleaning

Before a URL is sent anywhere, Find On removes:

- tracking parameters, such as `utm_source` or `fbclid`;
- parameters that look like secrets, such as tokens, keys, passwords, signatures or session IDs;
- the fragment (after `#`), unless the site uses it for routing (`#!` or `#/`);
- any user name or password inside a URL wrapped in another link, such as a Wayback Machine or redirect link.

The result is the "cleaned URL" referred to in this policy.

### Hacker News search (Algolia)

Receives search terms taken from the cleaned URL: the host name, words from the path and, for some pages, an identifier from the URL, such as a YouTube video ID or the value of an `id` parameter. On a Hacker News thread page it receives the thread ID. On manual lookups it receives one or two more searches built from the same parts of the URL (the host name, path words and identifiers), for comments and text posts that link to the page. These requests carry no cookies. See [Algolia's privacy policy](https://www.algolia.com/policies/privacy).

### Reddit

Receives the cleaned URL in a few spellings (for example with or without `www.` or a trailing slash), the ID of a matching post (to find other submissions of the same link), and on a Reddit thread page, the thread ID. On manual lookups it also receives one search for posts that link to the page in their title or text. That search term is the cleaned URL without its scheme, `www.`, trailing slash or most parameters, or, for YouTube, X, Medium and arXiv pages, only the content ID.

Reddit only answers signed-in users, so these requests carry your reddit.com cookies. The browser attaches them because Find On has permission to access reddit.com; Find On itself never reads or stores your cookies, and the browser sends them only to reddit.com. If you are signed in, Reddit can associate these lookups with your account. See [Reddit's privacy policy](https://www.reddit.com/policies/privacy-policy).

### Other requests

- "Search Reddit comments" in the popup opens Reddit's comment search for the page (`www.reddit.com/search`) in a new tab, only when you click it. Find On doesn't send that request itself: the page loads like any page you open, with your reddit.com cookies. The link isn't shown in private windows.
- The welcome and settings pages can show whether you are signed in to Reddit, while the Reddit source is enabled and never from a private window. Each check sends one Reddit search for a fixed URL (`xkcd.com/927`), never one of your pages.
- Both services see your IP address and browser details, as with any website you visit.

## Private windows

Find On runs in private windows (Incognito in Chrome, InPrivate in Edge) only if you allow it in the browser's extension settings. In a private window it never looks up pages automatically, sends nothing to Reddit, and does not cache results. Opening the popup there still looks up the page, and the comments and text posts that link to it, on Hacker News.

## What Find On stores

| Data                                                                                                                                                                      | Where                                                                                        | Retention                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Settings: lookup mode, sources, site filter, toolbar badge, displayed count, Reddit domain, link behavior                                                                 | Browser sync storage (synced through your Google or Microsoft account if browser sync is on) | Until you change them or remove Find On                                                                                                                                  |
| Whether you have chosen a lookup mode, your sort order, whether text posts are listed, whether the mentions group is open, and the last version whose notes you have seen | Extension local storage on this device                                                       | Until you remove Find On                                                                                                                                                 |
| Lookup results (URLs looked up, and the discussions and mentions found), Reddit rate-limit state, the URL you right-clicked until the popup opens                         | Extension session storage, in memory only                                                    | Cleared when the browser closes or Find On is updated or disabled. Results are reused for up to 10 minutes (5 minutes when nothing was found), and at most 300 are kept. |

All of this stays in your browser and, for settings, your browser's sync service. The developer has no copy to access or delete.

Updating from Find On 1.x deletes the result cache 1.x kept in local storage (keyed by the URLs it looked up) and its old settings.

## Your controls

All of these are on Find On's settings page, except signing out of Reddit.

- Switch the lookup mode to **Manual**, so pages are looked up only when you open the popup or use the context menu.
- Disable the **Hacker News** or **Reddit** source; Find On then sends nothing to that service.
- Edit the **site filter** blocklist, or switch to an allowlist, to control which sites are looked up automatically.
- Sign out of reddit.com to stop Reddit from associating lookups with your account. Reddit results stop working until you sign in again.

## What Find On does not do

- No analytics, telemetry, crash reporting or ads.
- No selling or sharing of data. Data is sent only to the services above, and only to find discussions and mentions of the page.
- No remote code. Everything Find On runs ships in the extension package.

## Store policies

Find On's use and transfer of user data complies with the Chrome Web Store User Data Policy, including the [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) requirements. The Microsoft Edge version follows the [Microsoft Edge Add-ons developer policies](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies). Both versions behave the same and are covered by this policy.

## Changes

This policy is maintained in the [Find On repository](https://github.com/JeffreyCA/find-on); its history records every change.

## Contact

Open an issue at <https://github.com/JeffreyCA/find-on/issues>.

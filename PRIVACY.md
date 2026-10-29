# Privacy Policy

**Last updated:** 2026-10-28 · **Applies to:** Find On for Google Chrome and Microsoft Edge

## Summary

Find On shows Hacker News and Reddit discussions of the page you're on. To find them, it handles your web browsing history: the addresses of the pages you look up. It sends search terms built from those addresses to Hacker News search (run by Algolia) and to Reddit. Find On has no server of its own, so every request goes directly from your browser to those services. It has no analytics and does not sell or share data.

## What Find On reads

Find On reads the address and title of your browser tabs. It does not read page content, and it never reads or stores your cookies. The title is used only to prefill a submit link when you click one.

## Cleaned addresses

Before an address is sent anywhere, Find On removes tracking parameters (such as `utm_source`), parameters that look like secrets (such as tokens, keys or session IDs), the fragment after `#` unless the site uses it for routing, and any user name or password inside a wrapped link.

Find On never looks up addresses that are not public web pages: anything other than `http` and `https`, addresses with a user name or password, `localhost`, IP addresses, single-label host names, and private domains such as `.local`, `.internal` or `.onion`.

## Who receives what

| Recipient                                                       | What it receives                                                                                                  | When                                                                         |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Hacker News search (`hn.algolia.com`, run by Algolia)           | Search terms built from the cleaned page address, such as its host name, words from its path and IDs. No cookies. | Each lookup, while the Hacker News source is enabled                         |
| Reddit (`old.reddit.com`)                                       | The cleaned page address, search terms built from it and IDs of matching posts, with your reddit.com cookies      | Each lookup, while the Reddit source is enabled. Never from private windows. |
| The Hacker News or Reddit submit page                           | The cleaned page address and the page title                                                                       | Only when you choose to submit the page                                      |
| Reddit's comment search (`www.reddit.com`), opened in a new tab | A search term built from the cleaned page address                                                                 | Only when you click the link to search Reddit comments                       |

On a Hacker News or Reddit thread, the thread's ID is sent to the same service to find the page the thread links to.

Reddit only answers signed-in users, so Reddit requests carry your reddit.com cookies. The browser attaches them because Find On has permission to access reddit.com, and sends them only to reddit.com. If you are signed in, Reddit can associate these lookups with your account.

Like any website you visit, both services also see your IP address and browser details. See [Algolia's privacy policy](https://www.algolia.com/policies/privacy) and [Reddit's privacy policy](https://www.reddit.com/policies/privacy-policy).

While the Reddit source is enabled, the welcome and settings pages can check whether you are signed in to Reddit. Each check is a Reddit search for a fixed address (`xkcd.com/927`), never one of your pages, and is never made from a private window.

## When lookups happen

- **Automatic lookups** (the default mode) run when a page finishes loading in the active tab, when you switch to a tab that has not been looked up yet, and when the browser starts. They begin only after you choose a lookup mode. They follow the site filter: sites on the blocklist are skipped, including when a Hacker News or Reddit thread links to one, and in allowlist mode only listed sites are looked up.
- **Manual lookups** run when you open the popup, use the context menu, or enter an address in the popup.

Lookups also search for threads that link to the page: Hacker News posts and comments, and Reddit posts. Manual lookups always do; automatic lookups do while text posts are turned on in the popup.

## Private windows

Find On runs in private windows (Incognito in Chrome, InPrivate in Edge) only if you allow it in the browser's extension settings. There, it never looks up pages automatically, sends nothing to Reddit, and does not cache results. Opening the popup still looks up the page on Hacker News.

## What Find On stores

| Data                                                                                                                                                 | Where                                                                                        | Retention                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Settings                                                                                                                                             | Browser sync storage (synced through your Google or Microsoft account if browser sync is on) | Until you change them or remove Find On                                                               |
| Popup preferences, whether you have chosen a lookup mode, and the last version whose release notes you have seen                                     | Extension local storage on this device                                                       | Until you remove Find On                                                                              |
| Lookup results (the addresses looked up and the discussions found), Reddit rate-limit state, and the address you right-clicked until the popup opens | Extension session storage, in memory only                                                    | Until the browser closes, or Find On is updated or disabled. A result is reused for up to 10 minutes. |

All of this stays in your browser and, for settings, your browser's sync service. The developer has no copy to access or delete.

## Your controls

- Switch the lookup mode to **Manual** in settings, so pages are looked up only when you ask.
- Disable the **Hacker News** or **Reddit** source in settings. Find On then sends nothing to that service.
- Edit the **site filter** in settings to choose which sites are looked up automatically.
- Turn off **Text posts** in the popup, so automatic lookups don't search for posts and comments that link to the page.
- Sign out of reddit.com to stop Reddit from associating lookups with your account. Reddit results stop working until you sign in again.

## What Find On does not do

- No analytics, telemetry, crash reporting or ads.
- No selling or sharing of data. Data goes only to the services above, and only to find discussions of the page.
- No remote code. Everything Find On runs ships in the extension package.

## Store policies

Find On's use and transfer of user data complies with the Chrome Web Store User Data Policy, including the [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) requirements. The Microsoft Edge version follows the [Microsoft Edge Add-ons developer policies](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies). Both versions behave the same and are covered by this policy.

## Changes

This policy is maintained in the [Find On repository](https://github.com/JeffreyCA/find-on), where its history records every change. The date at the top changes with each revision.

## Contact

Open an issue at <https://github.com/JeffreyCA/find-on/issues>.

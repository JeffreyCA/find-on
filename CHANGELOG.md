# Changelog

All notable changes to Find On are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

Versions up to 1.6.1 were released as Find on Reddit by Adeel Hassan ([AdeelH/find-on-reddit](https://github.com/AdeelH/find-on-reddit)). Dates before 2.0.0 are when each version appeared in the repository.

## [2.1.0] - 2026-10-30

### Added

- Add search for threads that link to the page in Hacker News comments and text posts, and in Reddit posts.
- Add text posts to the results and the badge count, with a new "Text posts" toggle to hide them.
- Add new "Mentioned in HN comments" section to the popup.
- Add new "Search Reddit comments" link.
- Add What's new panel to settings.
- Add links to the GitHub repository and to report an issue.

### Changed

- Always show the source tabs, and dim sources that are empty or weren't checked.
- Replace text labels with icons for link posts, text posts, comment threads, points and comments.
- Skip Reddit lookups on Reddit's front page.
- Move notes such as "not checked in private windows" below the results.
- Simplify the welcome page.

## [2.0.2] - 2026-10-26

### Fixed

- Reddit search, other submissions of a link and Reddit thread pages work again, and the settings and welcome pages no longer report "Not signed in" for signed-in users. www.reddit.com started blocking these requests even with a session, so every Reddit request now goes to old.reddit.com.
- When Reddit blocks a request ("blocked by network security"), the popup and settings show an error instead of "not signed in".

### Changed

- Host permissions reduced to `hn.algolia.com` and `old.reddit.com`.

## [2.0.1] - 2026-10-26

### Added

- Drag the Hacker News and Reddit tabs in the popup to reorder them.

### Changed

- Every result shows its full title in a tooltip, which no longer flickers when the pointer moves between the title's lines.
- More space below the last result in short lists.

## [2.0.0] - 2026-10-25

### Added

- Toolbar badge with the discussion or total comment count, updated as pages load (automatic lookup mode).
- Site filter for automatic lookups: a blocklist (prefilled with webmail, search results, chat and similar sites) or an allowlist.
- Matching across URL forms: the same YouTube video, arXiv paper, tweet, GitHub repository or Medium post is recognized however it is linked, and near matches are listed separately under "Other versions".
- On a Hacker News or Reddit thread, the article it links to is looked up instead.
- Context menu item "Find discussions for this link" and a keyboard shortcut (Alt+Shift+D).
- Welcome page with a one-click choice between automatic and manual lookups.
- Light and dark themes that follow the system setting.

### Changed

- Renamed to "Find On - Look up current page on Hacker News & Reddit", with a new icon and interface.
- Rebuilt as a Manifest V3 extension with WXT, TypeScript and Preact.
- Reddit lookups use the browser's reddit.com session, since Reddit no longer answers anonymous API requests. Exact URL matches come from old.reddit.com; search and other submissions of the same link come from www.reddit.com.
- Hacker News search sends a better query and filters results locally, so only submissions of the page are listed.
- Tracking parameters (from Brave's and Firefox's lists) are ignored when matching, along with scheme, `www`, trailing slash and fragment differences.
- Settings reduced to lookup mode, sources, site filter, toolbar badge, displayed count, Reddit domain and background tabs.
- Host permissions reduced from all sites to `hn.algolia.com`, `www.reddit.com` and `old.reddit.com`.

### Removed

- Options for exact or fuzzy search, query-string handling, YouTube handling, retries and cache period; matching now handles these automatically.
- Settings from 1.x are not carried over; 2.0.0 starts from the defaults. Updating from 1.x deletes the settings and the on-disk result cache 1.x stored, and opens the welcome page.

### Fixed

- The popup no longer loops on "error, retrying in Ns" when Reddit rejects a request, and a Reddit failure no longer hides Hacker News results.

## [1.7.1] - 2025-06-16

### Added

- Build script.
- Caching of Hacker News results.

### Changed

- Options page wording.

### Fixed

- "No results found" message not showing in the popup.

## [1.7.0] - 2025-06-11

### Added

- Hacker News results alongside Reddit.

## [1.6.1] - 2025-04-20

### Added

- Option to open links in a background tab next to the current tab instead of at the end ([#52](https://github.com/AdeelH/find-on-reddit/pull/52), suggested by nkmathew).
- Option to run both exact and non-exact searches with auto-search ([#54](https://github.com/AdeelH/find-on-reddit/pull/54)).

### Changed

- Dark-themed options page, consistent with the popup ([#51](https://github.com/AdeelH/find-on-reddit/pull/51), suggested by nkmathew).
- Updated dependencies ([#56](https://github.com/AdeelH/find-on-reddit/pull/56)).

### Fixed

- Count of the other kind of search not showing ([#53](https://github.com/AdeelH/find-on-reddit/pull/53)).

## [1.5.8] - 2023-03-05

### Fixed

- Links not opening in the same tab.

## [1.5.6] - 2022-05-01

### Added

- Option to show the comment count instead of the post count on the icon with auto-search.

### Changed

- Updated to Manifest V3.

## [1.5.5] - 2021-08-22

### Added

- More results from the `/duplicates` API endpoint (suggested by Droyk).
- More fuzzy-search results by omitting the URL scheme.

### Fixed

- Popup closing after Ctrl+click on a link (reported by Droyk).

## [1.5.4] - 2021-05-16

### Security

- Updated Handlebars.js to 4.7.7 for [GHSA-f2jv-r9rf-7988](https://github.com/advisories/GHSA-f2jv-r9rf-7988).

## [1.5.2] - 2021-01-26

### Changed

- Options page improvements.

### Fixed

- Ctrl/Cmd/Shift/Alt+click behavior (reported by NovaDev94).

## [1.5.0] - 2020-09-20

### Changed

- Improved error handling for network requests.

### Fixed

- Popup size or zoom changing when a link was clicked ([#17](https://github.com/AdeelH/find-on-reddit/issues/17), reported by nkmathew).
- Search results sometimes not rendering.

### Security

- Updated Handlebars.js to include a security patch.

## [1.4.8] - 2018-05-12

### Added

- Option to point all links to old.reddit.com, on by default.

## [1.4.7] - 2017-08-30

### Changed

- Interface fixes and improvements.

## [1.4.5] - 2017-08-13

### Added

- Sorting of search results by score, comments, age or subreddit, with a default set in the options.

## [1.4.4] - 2017-07-07

### Fixed

- Minor fixes and improvements.

## [1.4.3] - 2017-06-04

### Fixed

- Bug fixes.

## [1.4.1] - 2017-05-31

### Added

- "Exact match" option to switch between the search and info API endpoints.
- Search defaults (exact matching, query string, YouTube handling) settable in the options.
- Automatic non-exact search when an exact search finds nothing, on by default.
- Automatic retry on server or network errors, on by default.
- Option to post or repost the link to Reddit from the popup.

### Changed

- Exact and non-exact results are cached together for each URL.
- Toggling a popup checkbox starts a new search without pressing Search.
- "Ignore query string" is unchecked automatically for YouTube videos.
- The badge clears when the tab's URL changes.
- Smaller extension package.

## [1.3.2] - 2017-03-25

### Fixed

- Caching bug.

## [1.3.1] - 2017-03-24

### Added

- Auto-search.
- Options page.

## [1.2.1] - 2017-02-28

### Changed

- Query strings are ignored by default.

### Fixed

- Leading dashes in YouTube video IDs being read as a NOT operator by Reddit search.

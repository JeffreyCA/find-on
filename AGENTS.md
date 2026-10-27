# AGENTS.md

Find On is a Chrome and Edge (Manifest V3) extension that looks up the current page on Hacker News and Reddit. It is built with WXT, TypeScript and Preact; README.md describes the layout and commands.

## Verify

- Before finishing any change, run `npm run check` (format check, lint, typecheck, unit tests, build). Run `npm run format` to fix formatting.
- After changing the popup, background or settings, also run `npm run test:e2e`.

## Rules

- Send a page URL anywhere only after `checkEligibility` (src/core/url) accepts it. Keep the existing guards: nothing goes to Reddit from a private window, and automatic lookups respect the site filter.
- Reddit only answers signed-in sessions. Send every Reddit request to old.reddit.com with `credentials: 'include'`, never without; www.reddit.com blocks JSON requests even for signed-in users.
- Keep UI copy short and functional: no taglines, filler or decorative text.
- Never use the em dash character in code, UI copy or docs; use "-".
- Keep tests lean. Test logic that is easy to break, such as URL matching and provider response handling. Add no tests for UI, styling or copy changes.
- To add a setting, add its default to `DEFAULT_SETTINGS`. Stored settings are merged over the defaults, so no migration is needed.
- Write commit messages without co-author, tool or session trailers.
- Change CHANGELOG.md only when bumping the version or preparing a release.

## Releases

To cut a release, follow `.agents/skills/release/SKILL.md`.

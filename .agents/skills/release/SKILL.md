---
name: release
description: Cut a Find On release - date the changelog, merge it, tag the version and let the Release workflow publish the GitHub release with the store zip.
disable-model-invocation: true
---

# Release Find On

Pushing a `v<version>` tag runs `.github/workflows/release.yml`. It checks that the tag matches package.json and that CHANGELOG.md has a dated section for that version, runs every check, builds the zip and publishes a GitHub release with that section as its notes.

1. Start from an up-to-date, clean main: `git switch main && git pull --ff-only`, and `git status` shows no changes.
2. Read the version from package.json. If the tag `v<version>` already exists (`git tag -l v<version>`), that version is released: ask the user whether the next one is a patch (fixes and polish) or a minor version (new features), run `npm version <next> --no-git-tag-version`, and add a `## [<next>] - Unreleased` section at the top of CHANGELOG.md.
3. Make sure the version's CHANGELOG.md section lists every user-facing change since the previous release. Compare it with `git log --oneline <previous tag>..main`; when the previous version was never tagged, use the log since the commit that dated its changelog section.
4. Replace `- Unreleased` in that section's heading with today's date, `- YYYY-MM-DD` (`date +%Y-%m-%d`).
5. Run `npm run check` and `npm run test:e2e`.
6. Create the branch `release/v<version>`, commit with the message `Release <version>`, push it, and open a pull request with `gh pr create`. Stop here and ask the user to merge it.
7. Once it is merged: `git switch main && git pull --ff-only`, confirm package.json still says `<version>`, then `git tag v<version>` and `git push origin v<version>`.
8. Wait for the workflow: `gh run watch "$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"`.
   - If it succeeds, confirm `gh release view v<version>` lists `find-on-<version>-chrome.zip`, and give the user the release URL.
   - If it fails, read the log (`gh run view --log-failed`), fix the cause through a pull request, then move the tag to the fixed main: `git push origin :refs/tags/v<version>`, `git tag -f v<version>`, `git push origin v<version>`.
9. Remind the user that store submission is manual: upload the release's zip to the Chrome Web Store and Microsoft Edge Add-ons.

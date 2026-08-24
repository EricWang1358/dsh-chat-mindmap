---
name: release-quality
description: Prepare and ship dsh-chat-mindmap releases with current public documentation, truthful release notes, and verified GitHub CI. Use for version bumps, release PRs, GitHub Releases, or npm publishing preparation; not for ordinary feature work.
---

# Release quality

Use this skill whenever a change is intended for a public release.

## Release contract

- Preserve unrelated working-tree changes. Do not stage audit-driven dependency rewrites or generated evidence unless the user explicitly asks to include them.
- Keep `package.json` and `package-lock.json` on the same version. Update `CHANGELOG.md` and `README.md` when the public behavior, installation path, compatibility, or product positioning changes.
- Run `node scripts/verify-release-readiness.mjs` and the repository CI command set before opening a release PR.
- Create release notes from verified changes only. State user-visible improvements, compatibility notes, and verification; omit internal deliberation, machine-local paths, and claims that have not been tested.

## Pull request and CI

1. Create a `codex/` release branch and a focused PR.
2. Wait for the GitHub Actions CI result. Do not merge while any required check is pending or failing.
3. On failure, inspect the failed job log, make a narrow fix, rerun the local equivalent, push, and wait for a new green run. Never bypass a failed check or alter a gate merely to make it pass.
4. Merge only after all required checks pass and the user has authorized the merge.

## GitHub Release and npm

- Create the `v<version>` GitHub Release only after the merged commit is on `main`. Use release notes that match the changelog and PR verification.
- Wait for the tag-triggered package-artifact workflow to pass before calling the release complete.
- `npm publish` is an external, irreversible distribution action. Run it only when the user explicitly asks; otherwise provide the exact command after the release is verified.
- After publishing, verify `npm view <package>@<version>` and the `latest` dist-tag when the user requested a public availability check.

## Release-note shape

Use concise sections: **Highlights**, **Compatibility / upgrade notes** (only when needed), and **Verification**. Link the PR and release when they exist. Do not claim browser or host integration coverage that was not actually completed.

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

## Local pre-flight (must match CI byte-for-byte)

- CI runs `npm ci --legacy-peer-deps` then `npx tsc -p tsconfig.json` then `npx tsdown`. `pnpm run build:client` alone is **not** equivalent — it only re-runs the client bundle and leaves `lib/client/components/*.js` (the tsc outputs the test files import from) stale.
- Before pushing the release branch, run the full `npm run build` (`tsc` + `tsdown` + dry-run pack) locally and confirm:
  - the working tree's only changed lib/ file is `lib/client.js` (all other lib/ churn is CRLF noise on Windows hosts with `core.autocrlf=true`);
  - every `.js` file the test suite imports is byte-identical to the freshly-built `lib/`;
  - `pnpm test` passes against the freshly-built `lib/`.
- A test that imports a symbol the source does not export will pass locally if you only ran `pnpm run build:client` (the bundle keeps the symbol alive) and fail on CI where `tsc` regenerates the CJS module from source. The 0.2.7 panel-regenerate-fix.test.mjs bug — which CI caught and a local amend fixed — was caused by this gap.
- Keep the working tree clean of dev noise before the release commit:
  - `.jspace/`, `.pnpm-store/`, `pnpm-lock.yaml` should be ignored; `pnpm-lock.yaml` is a dev convenience, never a publish artifact;
  - `lib/` is `.gitignore`d, so the only `lib/*` file that ever needs to be force-staged is `lib/client.js`; all other `lib/*.js` / `lib/types/*.d.ts` changes on a Windows host are pure line-ending noise — reset them via `git checkout HEAD -- lib/` before staging.

## Pull request and CI

1. Create the release branch with `git checkout -b codex/release-<v> origin/main`, **not** off a feature branch tip. A release branch off a feature-branch tip will have a different ancestor structure from `main` and GitHub's diff engine will render a phantom diff for files whose blob SHAs are identical. 0.2.7 hit this when the release branch was cut off `codex/readme-screenshot-gallery` (no merge commits) while `main` had 5 merge commits from earlier PRs — every file in those PRs showed up as a phantom `+/-` even though the blobs were byte-identical.
2. Wait for the GitHub Actions CI result. Do not merge while any required check is pending or failing.
3. On failure, inspect the failed job log, make a narrow fix, rerun the local equivalent, push, and wait for a new green run. Never bypass a failed check or alter a gate merely to make it pass.
4. Force-push safety:
   - Never `git push --force origin main` unless you have a specific, pre-declared reason and the user has authorized it. `--force-with-lease` does not protect against a ref that was already rewound (the "lease" is the remote tip at fetch time). If `origin/main` is at `X` and local `main` is at `Y` where `X` is **not** an ancestor of `Y`, force-pushing `main` will silently delete commits that were already merged into `origin/main` — a destructive write to public history. 0.2.7 lost the 4 already-merged PRs from `origin/main` this way.
   - Safer pattern: never change `main`'s commit graph on the release branch. Keep release-only commits on `codex/release-<v>`; let PR merge fast-forward `main` from the release branch's tip.
5. Merge only after all required checks pass **and at least one human reviewer other than the author has approved**. The 0.2.7 squash-merge was procedurally permitted (rule 4 satisfied) but no one outside the release actually reviewed the diff; treat that as a process gap, not a clean merge.

## Compatibility and semver claims

- npm caret on a prerelease (`^0.1.0-rc.8`, `^0.1.1-rc.2`) **does not** span across the same-tag's minor increments: `^0.1.0-rc.8` resolves to `>=0.1.0-rc.8 <0.2.0` with a same-rc-tag constraint and will **not** pick up `0.1.1-rc.2` (different minor). Before writing CHANGELOG or release notes that say "compatible with both X and Y", run `node -e "const s=require('semver');console.log(s.intersects('^X','^Y'))"` or read the ranges by hand. 0.2.7 CHANGELOG claimed "0.2.7 同时支持 0.1.0-rc.8 和 0.1.1-rc.2" but the `^0.1.1-rc.2` devDep range does not include `0.1.0-rc.8`; the actual cross-version compat comes from `peerDependencies: ">=0.1.0-rc <2"`, not from the caret.
- When the CHANGELOG says a feature is "verified", it must mean the relevant CI gate passed. Do not list a feature under "Verification" that was not exercised by an automated check or a documented manual run.

## End-to-end verification on a real DSH host

- The in-tree tests (including `tests/panel-regenerate-fix.test.mjs` and the panel-regenerate section of `tests/index.test.mjs`) use a `makeFakeRuntime` that resolves a hand-crafted `OUTLINE` synchronously. They prove the plugin's internal contract is correct, but they do not exercise the real LLM path:
  - no real fork subagent is spawned;
  - the strict-outline validator is hit on a hand-built string, not on model output;
  - `commitGenerationOutcome` runs in process; on a real DSH host it goes through the storage layer under a real workspace cwd.
- Before declaring a release complete, run the regenerate end-to-end at least once on a host that has `@deepseek-ai/dsh` installed:
  - `node scripts/verify:gate0` (the only verify-* script that needs the machine-installed DSH distribution);
  - a smoke test of the `/maps/:id/regenerate` HTTP route that resolves a real `@fork` subagent and writes through the storage layer.
- Mark any feature that was not run end-to-end as "**unverified**" in the release notes. 0.2.7 shipped without this and the unverified gap is real.

## GitHub Release and npm

- Create the `v<version>` GitHub Release only after the merged commit is on `main`. Use release notes that match the changelog and PR verification.
- Tag the release with the same commit SHA that merged to `main` (verify with `git rev-parse v<tag> main` before pushing). Re-creating the tag if it points elsewhere (which happens if a rebase moved `main` between `git tag` and `git push`) is preferable to a tag that does not match the published code.
- Wait for the tag-triggered package-artifact workflow to pass before calling the release complete. The workflow should both upload the tarball as a workflow artifact and attach it to the GitHub Release (via `softprops/action-gh-release@v2`); the manual `gh release create` + `gh release upload` step is the fallback when the workflow is not yet wired to do the attachment.
- `npm publish` is an external, irreversible distribution action. Run it only when the user explicitly asks; otherwise provide the exact command after the release is verified. A pre-flight dry run (`npm publish --dry-run ./<pkg>.tgz`) is cheap and worth doing before the real publish.
- After publishing, verify `npm view <package>@<version>` and the `latest` dist-tag when the user requested a public availability check.

## Release-note shape

Use concise sections: **Highlights**, **Compatibility / upgrade notes** (only when needed), and **Verification**. Link the PR and release when they exist. Do not claim browser or host integration coverage that was not actually completed. Explicitly call out "**unverified end-to-end on a real DSH host**" when that is the case — being honest about the gap is the release note's job.

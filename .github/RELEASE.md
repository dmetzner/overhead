# How Overhead releases

The reasoning behind the release workflows. `CLAUDE.md` carries the rules; this
carries why they are not negotiable. Kept in `.github/` rather than `docs/`
because `docs/` is the published website.

## The shape

A push to `main` whose `manifest.json` version is not released yet **is** the
release. `release.yml` re-runs the CI gate, creates the tag and the GitHub
release, then calls the three shipping workflows:

| workflow | what it does |
|---|---|
| `pack.yml` | the two store zips, attached to the release |
| `sign-firefox.yml` | AMO-signed unlisted `.xpi`, attached; records the deploy |
| `publish-chrome.yml` | Chrome Web Store upload + publish |

So a release pull request bumps `manifest.json` and `package.json` and adds a
`## X.Y.Z` CHANGELOG section. Nothing is tagged or pushed by hand.

A hand-pushed tag `vX.Y.Z` still works — all three keep their `on: push: tags`
trigger — but it skips `release-readiness`, so nothing checked that the version
was releasable. It is the lesser path.

## Why `release.yml` calls the workflows instead of pushing a tag

A tag pushed with `GITHUB_TOKEN` does **not** trigger `on: push: tags` runs.
That is GitHub's no-recursive-runs rule, and it has no workaround short of a
PAT. An auto-tagging workflow therefore goes green and ships *nothing* — the
most expensive possible failure, because it looks like success.

Calling them as reusable workflows (`workflow_call`) avoids it with no new
secret. The cost is that a called workflow's `github.ref` is `main`, not the
tag, so each takes an `inputs.tag`.

## Why the bump is gated on the PR

"Every merge releases" is only true if every runtime change carries a bump.
`ci.yml`'s `release-readiness` job fails a PR into `main` that touches a path in
`.github/runtime-paths.txt` unless:

- `manifest.json` moves forward from the base branch, and is a version Chrome
  accepts (one to four dot-separated integers, each 0–65535, no leading zeros,
  no prerelease suffix). Validating the *shape* matters because an illegal
  version is only rejected by the store — after the tag and the release exist.
- `package.json` matches it. Both files are read by the shipping workflows.
- a `## <version>` CHANGELOG section exists. It becomes the release body.

Docs, tests, CI, dependency bumps and stacked PRs (base ≠ `main`) release
nothing, so they are waved through. The non-main case is decided *inside* the
script rather than by a job-level `if`, because this job is meant to be a
required status check and a job that never runs leaves a required check pending
forever.

**The job blocks nothing until it is required on `main`.** Today only `test` is,
and `gh pr merge --auto` merges the moment the required checks pass — so a red
`release-readiness` stops nobody. To close that:

```bash
gh api -X PATCH repos/dmetzner/overhead/branches/main/protection/required_status_checks \
  -f strict=true -f 'contexts[]=test' -f 'contexts[]=release-readiness'
```

`strict=true` matters as well: without it two PRs can both bump 2.5.0 → 2.6.0
against a stale base, and the second one ships nowhere.

Until then, `release.yml`'s `guard` job is the `main`-side twin: it fails when a
push changed shipped runtime files while that version is already tagged. `guard`
is deliberately *not* a dependency of the release chain, so it can go red while
a resume still finishes the tagged version off.

## Why a release is resumable, and what that forced

"Released" means the tag **and** the release **and** both store zips. Deciding
on the tag alone is the trap: a run that created the tag and then died in `pack`
would deadlock on "re-run failed jobs" (`git/refs` answers `422 Reference
already exists`) and turn every *other* retry — "re-run all jobs", a
`workflow_dispatch`, the next merge — into a green no-op. So:

- the tag step reuses an existing ref and release instead of failing on them;
- assets go up with `gh release upload --clobber`;
- AMO's "version already exists" is a no-op, not a failure;
- `concurrency: release` serialises two merges landing inside one run's window.

Two consequences that are easy to get wrong:

**Every shipper checks out the tag, never the pushed commit.** They are the same
commit on a first-pass release and different on a resume. Building `github.sha`
there would attach assets built from a later tree to an older version's release,
and would date the deploy record from an unrelated merge. For the same reason
the release notes are read out of `git show "$TAG:CHANGELOG.md"` rather than the
working tree — and read *out of* the tag rather than by checking it out, so the
`ensure-release.sh` that runs is always the current one.

**The zip count is never guessed at.** An earlier version read it as
`$(gh release view … || echo 0)`, which turns any transient API failure into
"zero zips" and resumes a *complete* release — and `--clobber` deletes an asset
before it re-uploads it, so a spurious resume can destroy a good one.

Because AMO will not sign a version twice, a failed attach used to lose the
Firefox distribution for that version outright. The signed `.xpi` is therefore
also kept as a workflow artifact, and its absence from the release is warned
about.

`gh release upload --clobber` deletes an asset before it re-uploads it, so a
failed re-upload leaves the release with *fewer* zips than it started with. The
gate heals that on the next run — but it is also why the zip count must never be
guessed at.

**The Chrome Web Store is the one shipper that is not idempotent.** It refuses a
package whose version is not greater than the one it holds, so a resumed release
whose `chrome` job already succeeded would fail there forever. `publish-chrome.yml`
therefore asks the store what version it holds (`?projection=DRAFT` →
`crxVersion`) and skips the upload when it already has this one; a publish call
that then fails is a warning rather than an error, because "already live or in
review" is not a release failure. A first-pass publish failure still fails the
job. The version query is allowed to fail — an item that has never been
published may not answer it, and "unknown" must mean "try the upload", not a red
first publish.

Two things to know about that skip, when the `CWS_*` secrets land:

- **It trusts the version number as a proxy for the package.** A draft sitting at
  this version that this repo did not build gets published as-is; the CWS item
  resource exposes no hash to check it against. The likely first encounter is
  the setup itself: step 1 above is "publish v1 manually", so the first
  automated release of *that same version* would skip its own upload and publish
  the hand-uploaded package. Bump before the first automated release, or expect
  the notice. In the case the skip exists for — upload succeeded, publish failed
  — the leftover draft was necessarily built from the tagged tree, because the
  shippers are pinned to the tag, so skipping is byte-identical to re-uploading.
- **Verify on the second run for one version** that the log says `the Web Store
  already holds <v> — skipping the upload` and not `upload failed`. If
  `?projection=DRAFT` reports no `crxVersion` for an already-*published* version
  with no pending draft, the skip never fires and a resumed release goes red at
  the duplicate upload — the exact failure the check was added to remove.

## Why `gh` instead of `softprops/action-gh-release`

`--clobber` makes a re-run idempotent, a hand-pushed tag gets the same CHANGELOG
notes the merge path produces (the action created the release with an empty
body), and the repo carries one less marketplace action — the last one it
depended on, `mnao305/chrome-webstore-upload-action`, vanished mid-release on
v2.4.0. Third-party actions are resolved at job setup even when their step is
`if`-skipped, so a deleted action fails the whole job.

## Why the ship-list is declared once

`.github/runtime-paths.txt` is the declared set of shipped runtime paths, and
`.github/runtime-regex.sh` turns it into the ERE both gates match against — a
script rather than an inline awk block in each gate, because the block was
copy-pasted (a third place to drift) and its failure mode is silent: a wrong
escape yields a pattern that matches nothing, so the gates stop firing and every
release check quietly passes. The test asserts the exact string it prints. The three shipping workflows still carry their
own shell word lists, because a word list is not a regex — so
`test/ship-list.test.js` fails when any of them drifts from the declaration.
Without that test, a new runtime file either ships without ever triggering a
release, or forces releases while never reaching a store zip.

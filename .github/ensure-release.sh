#!/usr/bin/env bash
# Ensure the GitHub release for a tag exists, with the matching CHANGELOG
# section as its notes.
#
# Usage: .github/ensure-release.sh <tag> <version>
#
# Three workflows need the release to exist before they can attach an asset,
# and on a hand-pushed tag they run in parallel — so this is idempotent and
# tolerates losing the create race. It also means the tag path gets the same
# CHANGELOG notes as the merge path; before this, whichever workflow got there
# first created a release with an empty body.
set -euo pipefail

tag="${1:?tag required}"
version="${2:?version required}"

if gh release view "$tag" >/dev/null 2>&1; then
  echo "::notice::release $tag already exists — leaving its notes alone"
  exit 0
fi

notes=$(mktemp)
awk -v v="$version" '
  $0 ~ "^## +" v "( |$)" { found = 1; next }
  found && /^## / { exit }
  found { print }
' CHANGELOG.md > "$notes"

# ci.yml requires the section on any release-bearing PR, but a hand-pushed bump
# can still miss it, and an empty body beats a failed release.
if [ ! -s "$notes" ]; then
  echo "::warning::no '## $version' section in CHANGELOG.md — releasing without notes"
  printf 'See CHANGELOG.md.\n' > "$notes"
fi

gh release create "$tag" --title "$tag" --notes-file "$notes" && exit 0

# Lost the race, or a transient failure — the former is fine, the latter is not.
if gh release view "$tag" >/dev/null 2>&1; then
  echo "::notice::release $tag was created concurrently"
  exit 0
fi
echo "::error::could not create or find release $tag"
exit 1

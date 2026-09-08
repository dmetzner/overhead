#!/usr/bin/env bash
# Print the ERE that matches a path in the shipped extension, built from
# .github/runtime-paths.txt.
#
# It exists as a script rather than an inline awk block in each workflow for two
# reasons: the block was copy-pasted into two gates (a third place for the
# ship-list to drift), and its failure mode is silent — a wrong escape yields a
# regex that matches nothing, so the gate simply stops firing and every release
# check quietly passes. Here, `bash -n` covers it and test/ship-list.test.js
# asserts the exact string it prints.
#
# Each file entry is anchored at both ends, so `manifest.jsonx` is not a
# manifest change; each directory entry (trailing slash) is anchored at the
# front only, so `popup/nested/deep.js` is, and `my/popup/x.js` is not.
set -euo pipefail

paths="${1:-$(dirname "$0")/runtime-paths.txt}"

awk '!/^[[:space:]]*(#|$)/ {
  gsub(/\./, "\\.")
  print (/\/$/ ? "^" $0 : "^" $0 "$")
}' "$paths" | paste -sd '|' -

#!/usr/bin/env bash
# Download the latest subdomain-takeover fingerprints from EdOverflow/can-i-take-over-xyz
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$SCRIPT_DIR/../data/takeover-fingerprints.json"
URL="https://raw.githubusercontent.com/EdOverflow/can-i-take-over-xyz/master/fingerprints.json"

# Download to a temp file and only replace the vendored copy once it validates.
TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT

echo "Downloading takeover fingerprints..."
curl -fsSL --retry 2 "$URL" -o "$TMP_FILE"

echo "Validating JSON..."
node -e '
  const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  if (!Array.isArray(data) || data.length === 0) throw new Error("expected a non-empty array");
  for (const entry of data) {
    if (typeof entry.service !== "string" || !Array.isArray(entry.cname)) {
      throw new Error("unexpected entry shape: " + JSON.stringify(entry).slice(0, 200));
    }
  }
' "$TMP_FILE" || { echo "Invalid fingerprints file" >&2; exit 1; }

cp "$TMP_FILE" "$DEST"
echo "Done! $(node -e 'console.log(require(process.argv[1]).length)' "$DEST") fingerprints."

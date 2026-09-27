#!/usr/bin/env bash
# Download latest technology fingerprints from enthec/webappanalyzer
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="$SCRIPT_DIR/../data"
TECH_DIR="$DATA_DIR/technologies"
BASE_URL="https://raw.githubusercontent.com/enthec/webappanalyzer/main/src"

# Download into a temp dir and only replace data/ once everything succeeded,
# so a failed run can't leave a mix of old files, new files, and error pages.
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
mkdir -p "$TMP_DIR/technologies"

# -f: fail on HTTP errors instead of saving the error page as JSON.
fetch() {
  curl -fsSL --retry 2 "$1" -o "$2"
}

echo "Downloading categories..."
fetch "$BASE_URL/categories.json" "$TMP_DIR/categories.json"

echo "Downloading technology fingerprints..."
pids=()
for letter in _ a b c d e f g h i j k l m n o p q r s t u v w x y z; do
  fetch "$BASE_URL/technologies/${letter}.json" "$TMP_DIR/technologies/${letter}.json" &
  pids+=("$!")
done
# A bare `wait` ignores failures; wait on each download to catch them.
for pid in "${pids[@]}"; do
  wait "$pid"
done

echo "Validating JSON..."
for file in "$TMP_DIR"/categories.json "$TMP_DIR"/technologies/*.json; do
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$file" ||
    { echo "Invalid JSON: $(basename "$file")" >&2; exit 1; }
done

mkdir -p "$TECH_DIR"
cp "$TMP_DIR/categories.json" "$DATA_DIR/categories.json"
cp "$TMP_DIR"/technologies/*.json "$TECH_DIR/"

echo "Done! Downloaded $(ls "$TMP_DIR/technologies" | wc -l | tr -d ' ') technology files."

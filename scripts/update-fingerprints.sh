#!/usr/bin/env bash
# Download latest technology fingerprints from enthec/webappanalyzer
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="$SCRIPT_DIR/../data"
TECH_DIR="$DATA_DIR/technologies"
BASE_URL="https://raw.githubusercontent.com/enthec/webappanalyzer/main/src"

mkdir -p "$TECH_DIR"

echo "Downloading categories..."
curl -sL "$BASE_URL/categories.json" -o "$DATA_DIR/categories.json"

echo "Downloading technology fingerprints..."
for letter in _ a b c d e f g h i j k l m n o p q r s t u v w x y z; do
  curl -sL "$BASE_URL/technologies/${letter}.json" -o "$TECH_DIR/${letter}.json" &
done
wait

echo "Done! Downloaded $(ls "$TECH_DIR" | wc -l | tr -d ' ') technology files."

#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SOURCE="$ROOT/Lucas.app"
TARGET="/Applications/Lucas.app"
STAGE="/Applications/.Lucas.installing-$$.app"
BACKUP=""

test -x "$SOURCE/Contents/MacOS/Lucas"
codesign --verify --deep --strict "$SOURCE"
trap 'rm -rf "$STAGE"' EXIT HUP INT TERM
ditto "$SOURCE" "$STAGE"
codesign --verify --deep --strict "$STAGE"
if [ -d "$TARGET" ]; then
  BACKUP="/private/tmp/Lucas-before-install-$(date +%Y%m%d-%H%M%S).app"
  mv "$TARGET" "$BACKUP"
fi
if ! mv "$STAGE" "$TARGET"; then
  if [ -n "$BACKUP" ] && [ ! -e "$TARGET" ]; then mv "$BACKUP" "$TARGET"; fi
  exit 1
fi
trap - EXIT HUP INT TERM
"/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister" -f "$TARGET"
printf 'Installed: %s\n' "$TARGET"
if [ -n "$BACKUP" ]; then printf 'Previous version: %s\n' "$BACKUP"; fi

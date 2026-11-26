#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"

go test ./...
cd frontend
npm test
npm run build
cd "$ROOT"
python3 scripts/generate_icon.py
python3 scripts/collect_notices.py
"$HOME/go/bin/wails" build -platform darwin/arm64

APP="$ROOT/build/bin/Lucas.app"
# Use a Lucas-specific icon resource name so macOS cannot reuse the legacy
# iconfile.icns cache after an in-place upgrade.
mv "$APP/Contents/Resources/iconfile.icns" "$APP/Contents/Resources/lucas.icns"
/usr/libexec/PlistBuddy -c 'Set :CFBundleIconFile lucas' "$APP/Contents/Info.plist"
cp LICENSE NOTICE "$APP/Contents/Resources/"
cp build/THIRD_PARTY_NOTICES.txt "$APP/Contents/Resources/"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

# Never mutate the delivered app in place. LaunchServices can otherwise open
# a half-replaced bundle and report the generic "cannot be opened" error.
delivery="$ROOT/Lucas.next.app"
previous="$ROOT/Lucas.previous.app"
rm -rf "$delivery" "$previous"
ditto "$APP" "$delivery"
if [ -d "$ROOT/Lucas.app" ]; then mv "$ROOT/Lucas.app" "$previous"; fi
mv "$delivery" "$ROOT/Lucas.app"
rm -rf "$previous"

printf '\nBuilt: %s\n' "$ROOT/Lucas.app"

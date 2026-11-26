#!/usr/bin/env python3
"""Pin this repository's Lucas.app, replacing an old LucasTerm shortcut."""

import argparse
import datetime
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
OLD_BUNDLE = "com.lucasterm.desktop"
NEW_BUNDLE = "com.lucas.terminal"


def dock_preferences() -> tuple[bytes, dict]:
    raw = subprocess.run(
        ["defaults", "export", "com.apple.dock", "-"],
        check=True,
        capture_output=True,
    ).stdout
    return raw, plistlib.loads(raw)


def replace_shortcut(preferences: dict, app: Path) -> dict:
    entries = preferences.get("persistent-apps", [])
    matches = [
        index for index, entry in enumerate(entries)
        if entry.get("tile-data", {}).get("bundle-identifier") == OLD_BUNDLE
    ]
    if len(matches) > 1:
        raise RuntimeError(f"expected at most one old LucasTerm Dock shortcut, found {len(matches)}")
    if any(
        entry.get("tile-data", {}).get("bundle-identifier") == NEW_BUNDLE
        for entry in entries
    ):
        if len(matches) > 0:
            raise RuntimeError("Both LucasTerm and Lucas are pinned; refusing to guess")
    new_matches = [
        index for index, entry in enumerate(entries)
        if entry.get("tile-data", {}).get("bundle-identifier") == NEW_BUNDLE
    ]
    if len(new_matches) > 1:
        raise RuntimeError("Multiple Lucas Dock shortcuts found")

    target_index = new_matches[0] if new_matches else matches[0] if matches else -1
    old = entries[target_index] if target_index >= 0 else {"tile-data": {"dock-extra": False, "file-type": 41}}
    tile = dict(old.get("tile-data", {}))
    tile["bundle-identifier"] = NEW_BUNDLE
    tile["file-label"] = "Lucas"
    file_data = dict(tile.get("file-data", {}))
    file_data["_CFURLString"] = app.resolve().as_uri() + "/"
    file_data["_CFURLStringType"] = 15
    tile["file-data"] = file_data
    # A bookmark created for LucasTerm would keep resolving to the old app.
    tile.pop("book", None)
    tile.pop("file-mod-date", None)
    replacement = {"tile-type": "file-tile", "tile-data": tile}
    if target_index >= 0:
        entries[target_index] = replacement
    else:
        entries.append(replacement)
    preferences["persistent-apps"] = entries
    return preferences


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", type=Path, default=ROOT / "Lucas.app")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not (args.app / "Contents" / "MacOS" / "Lucas").is_file():
        raise SystemExit(f"Lucas app not found: {args.app}")

    raw, preferences = dock_preferences()
    updated = replace_shortcut(preferences, args.app)
    if args.dry_run:
        print(f"Ready to pin {args.app.resolve()} and remove any old LucasTerm shortcut")
        return

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = Path("/private/tmp") / f"com.apple.dock-before-lucas-{stamp}.plist"
    backup.write_bytes(raw)
    os.chmod(backup, 0o600)
    args.app.resolve().touch()
    subprocess.run([
        "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
        "-f", str(args.app.resolve()),
    ], check=True)
    with tempfile.NamedTemporaryFile(suffix=".plist", delete=False) as output:
        output.write(plistlib.dumps(updated))
        temporary = output.name
    try:
        subprocess.run(["defaults", "import", "com.apple.dock", temporary], check=True)
    finally:
        Path(temporary).unlink(missing_ok=True)
    subprocess.run(["killall", "Dock"], check=True)
    _, verification = dock_preferences()
    original = plistlib.loads(raw)
    pinned = [
        entry.get("tile-data", {}) for entry in verification.get("persistent-apps", [])
        if entry.get("tile-data", {}).get("bundle-identifier") == NEW_BUNDLE
    ]
    old = [
        entry for entry in verification.get("persistent-apps", [])
        if entry.get("tile-data", {}).get("bundle-identifier") == OLD_BUNDLE
    ]
    original_others = [
        entry for entry in original.get("persistent-apps", [])
        if entry.get("tile-data", {}).get("bundle-identifier") not in {OLD_BUNDLE, NEW_BUNDLE}
    ]
    verified_others = [
        entry for entry in verification.get("persistent-apps", [])
        if entry.get("tile-data", {}).get("bundle-identifier") not in {OLD_BUNDLE, NEW_BUNDLE}
    ]
    if (len(pinned) != 1 or old or verified_others != original_others
            or pinned[0].get("file-data", {}).get("_CFURLString") != args.app.resolve().as_uri() + "/"):
        raise SystemExit("Dock shortcut verification failed")
    print(f"Pinned Lucas to the Dock; backup: {backup}")


if __name__ == "__main__":
    main()

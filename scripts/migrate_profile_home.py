#!/usr/bin/env python3
"""Migrate saved profile paths after a macOS home-directory rename."""

import argparse
import datetime
import json
import os
from pathlib import Path
import tempfile


def replace_home(value, old_home: str, new_home: str) -> tuple[object, int]:
    if isinstance(value, str):
        prefix = old_home + "/"
        if value.startswith(prefix):
            return new_home + value[len(old_home):], 1
        return value, 0
    if isinstance(value, list):
        result, count = [], 0
        for item in value:
            updated, changed = replace_home(item, old_home, new_home)
            result.append(updated)
            count += changed
        return result, count
    if isinstance(value, dict):
        result, count = {}, 0
        for key, item in value.items():
            updated, changed = replace_home(item, old_home, new_home)
            result[key] = updated
            count += changed
        return result, count
    return value, 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--old-home", required=True)
    parser.add_argument("--new-home", default=str(Path.home()))
    parser.add_argument("--profiles", type=Path, default=Path.home() / "Library" / "Application Support" / "Lucas" / "profiles.json")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    old_home = str(Path(args.old_home).resolve()).rstrip("/")
    new_home = str(Path(args.new_home).resolve()).rstrip("/")
    if not old_home.startswith("/") or not new_home.startswith("/") or old_home == new_home:
        raise SystemExit("Old and new home directories must be different absolute paths")
    document = json.loads(args.profiles.read_text())
    updated, count = replace_home(document, old_home, new_home)
    if count == 0:
        print("No saved paths require migration")
        return
    remaining = json.dumps(updated, ensure_ascii=False).count(old_home + "/")
    if remaining:
        raise SystemExit(f"{remaining} old-home paths remain after migration")
    print(f"{count} saved paths ready to migrate from {old_home} to {new_home}")
    if args.dry_run:
        return
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = args.profiles.with_name(f"profiles-before-home-migration-{stamp}.json")
    backup.write_bytes(args.profiles.read_bytes())
    os.chmod(backup, 0o600)
    payload = (json.dumps(updated, ensure_ascii=False, indent=2) + "\n").encode()
    with tempfile.NamedTemporaryFile(dir=args.profiles.parent, prefix=".profiles-home-", delete=False) as output:
        temporary = Path(output.name)
        output.write(payload)
        output.flush()
        os.fsync(output.fileno())
    try:
        os.chmod(temporary, 0o600)
        os.replace(temporary, args.profiles)
    finally:
        temporary.unlink(missing_ok=True)
    verified = json.loads(args.profiles.read_text())
    if old_home + "/" in json.dumps(verified, ensure_ascii=False):
        raise SystemExit("Saved profile verification failed")
    print(f"Updated {count} paths; backup: {backup}")


if __name__ == "__main__":
    main()

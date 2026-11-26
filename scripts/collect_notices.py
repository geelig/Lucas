#!/usr/bin/env python3
"""Collect license texts for the exact third-party modules used in the build."""
from pathlib import Path
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "build" / "THIRD_PARTY_NOTICES.txt"
parts = [
    "Lucas THIRD-PARTY NOTICES\n"
    "This file does not change Lucas's proprietary license.\n"
    "Each component below remains under its own license.\n"
]

def license_files(directory: Path):
    if not directory.is_dir():
        return []
    return sorted(
        p for p in directory.iterdir()
        if p.is_file() and p.name.upper().startswith(("LICENSE", "LICENCE", "COPYING", "NOTICE"))
    )

raw = subprocess.check_output(
    ["go", "list", "-m", "-json", "all"], cwd=ROOT, text=True
)
decoder = json.JSONDecoder()
pos = 0
while pos < len(raw):
    while pos < len(raw) and raw[pos].isspace():
        pos += 1
    if pos >= len(raw):
        break
    module, pos = decoder.raw_decode(raw, pos)
    directory = Path(module.get("Dir", ""))
    files = license_files(directory)
    if not files:
        continue
    parts.append(f"\n{'=' * 72}\n{module['Path']} {module.get('Version', '')}\n")
    for file in files:
        parts.append(f"\n--- {file.name} ---\n{file.read_text(encoding='utf-8', errors='replace')}")

for package in sorted((ROOT / "frontend" / "node_modules").rglob("package.json")):
    data = json.loads(package.read_text(encoding='utf-8'))
    files = license_files(package.parent)
    if not files:
        continue
    parts.append(f"\n{'=' * 72}\nnpm: {data['name']} {data.get('version', '')}\n")
    for file in files:
        parts.append(f"\n--- {file.name} ---\n{file.read_text(encoding='utf-8', errors='replace')}")

OUT.write_text("".join(parts), encoding='utf-8')
print(OUT)

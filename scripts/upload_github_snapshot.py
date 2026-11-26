#!/usr/bin/env python3
"""Upload the current tracked source tree through GitHub's Git Data API."""

import argparse
import base64
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import tempfile


def api(endpoint: str, payload: dict | None = None) -> dict:
    command = ["gh", "api", endpoint]
    temporary = None
    if payload is not None:
        handle = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
        json.dump(payload, handle, ensure_ascii=False)
        handle.close()
        temporary = handle.name
        command += ["--method", "POST", "--input", temporary]
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True)
        return json.loads(result.stdout)
    finally:
        if temporary:
            os.unlink(temporary)


def upload_blob(repository: str, path: Path) -> tuple[str, str, str]:
    content = base64.b64encode(path.read_bytes()).decode("ascii")
    command = [
        "gh", "api", f"repos/{repository}/git/blobs",
        "-f", f"content={content}", "-f", "encoding=base64",
    ]
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    mode = "100755" if os.access(path, os.X_OK) else "100644"
    return path.as_posix(), mode, json.loads(result.stdout)["sha"]


def put_api(endpoint: str, payload: dict) -> dict:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as handle:
        json.dump(payload, handle, ensure_ascii=False)
        temporary = handle.name
    try:
        result = subprocess.run(["gh", "api", "--method", "PUT", endpoint, "--input", temporary], check=True, capture_output=True, text=True)
        return json.loads(result.stdout)
    finally:
        os.unlink(temporary)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("repository", help="owner/repository")
    parser.add_argument("--branch", default="main")
    parser.add_argument("--message", default="Publish Lucas source snapshot")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--orphan", action="store_true", help="Replace the branch with one clean snapshot commit")
    parser.add_argument("--force", action="store_true", help="Allow replacing an existing branch reference")
    args = parser.parse_args()
    files = subprocess.run(["git", "ls-files", "-z"], check=True, capture_output=True).stdout.decode().split("\0")
    paths = [Path(value) for value in files if value]
    if not paths:
        raise SystemExit("No tracked files to upload")
    api(f"repos/{args.repository}")
    existing = None
    try:
        existing = api(f"repos/{args.repository}/git/ref/heads/{args.branch}")
    except subprocess.CalledProcessError:
        existing = None
    current = None
    if not args.orphan:
        current = existing
    if not existing:
        readme = Path("README.md")
        if not readme.is_file():
            raise SystemExit("An empty repository requires README.md for initialization")
        put_api(f"repos/{args.repository}/contents/README.md", {
            "message": "Initial commit",
            "content": base64.b64encode(readme.read_bytes()).decode("ascii"),
            "branch": args.branch,
        })
        existing = api(f"repos/{args.repository}/git/ref/heads/{args.branch}")
        current = existing
    print(f"Uploading {len(paths)} tracked files to {args.repository}")
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(args.workers, 8))) as executor:
        entries = list(executor.map(lambda path: upload_blob(args.repository, path), paths))
    tree = [{"path": path, "mode": mode, "type": "blob", "sha": sha} for path, mode, sha in entries]
    tree_sha = api(f"repos/{args.repository}/git/trees", {"tree": tree})["sha"]
    commit = {"message": args.message, "tree": tree_sha, "parents": []}
    if current:
        commit["parents"] = [current["object"]["sha"]]
    commit_sha = api(f"repos/{args.repository}/git/commits", commit)["sha"]
    if existing:
        command = ["gh", "api", "--method", "PATCH", f"repos/{args.repository}/git/refs/heads/{args.branch}", "-f", f"sha={commit_sha}"]
        if args.force:
            command += ["-F", "force=true"]
        subprocess.run(command, check=True, capture_output=True)
    else:
        api(f"repos/{args.repository}/git/refs", {"ref": f"refs/heads/{args.branch}", "sha": commit_sha})
    print(api(f"repos/{args.repository}/commits/{commit_sha}")["html_url"])


if __name__ == "__main__":
    main()

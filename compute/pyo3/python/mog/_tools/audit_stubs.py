"""Static audit for fake-success stub patterns in the Python SDK."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
ALLOWLIST_PATH = PACKAGE_ROOT / "_tools" / "stub_audit_allowlist.json"

STUB_PATTERNS = [
    re.compile(r"\bStub\b"),
    re.compile(r"\bstub\b", re.IGNORECASE),
    re.compile(r"placeholder", re.IGNORECASE),
    re.compile(r"fake[- ]success", re.IGNORECASE),
    re.compile(r"pass\s*#\s*Stub", re.IGNORECASE),
    re.compile(r"Currently a stub", re.IGNORECASE),
]


def _source_files() -> list[Path]:
    return sorted(
        path
        for path in PACKAGE_ROOT.rglob("*.py")
        if "__pycache__" not in path.parts
        and "_generated" not in path.parts
        and path.name != "audit_stubs.py"
    )


def _fingerprint(path: Path, line_index: int, lines: list[str]) -> str:
    snippet = "\n".join(line.strip() for line in lines[line_index : line_index + 4])
    rel = str(path.relative_to(PACKAGE_ROOT))
    digest = hashlib.sha256(f"{rel}\n{snippet}".encode()).hexdigest()[:16]
    return f"{rel}:{digest}"


def _load_allowlist() -> set[str]:
    if not ALLOWLIST_PATH.exists():
        return set()
    data = json.loads(ALLOWLIST_PATH.read_text())
    return set(data.get("broad_exception_swallow", []))


def scan() -> dict[str, Any]:
    allowlist = _load_allowlist()
    stub_issues: list[dict[str, Any]] = []
    broad_swallow: list[dict[str, Any]] = []
    for path in _source_files():
        lines = path.read_text().splitlines()
        rel = str(path.relative_to(PACKAGE_ROOT))
        for index, line in enumerate(lines):
            for pattern in STUB_PATTERNS:
                if pattern.search(line):
                    stub_issues.append(
                        {
                            "file": rel,
                            "line": index + 1,
                            "pattern": pattern.pattern,
                            "text": line.strip(),
                        }
                    )
            stripped = line.strip()
            if stripped.startswith("except Exception"):
                window = [candidate.strip() for candidate in lines[index + 1 : index + 5] if candidate.strip()]
                if window and (
                    window[0] == "pass"
                    or window[0].startswith("return []")
                    or window[0].startswith("return {}")
                    or window[0].startswith("return None")
                ):
                    key = _fingerprint(path, index, lines)
                    if key not in allowlist:
                        broad_swallow.append(
                            {
                                "file": rel,
                                "line": index + 1,
                                "fingerprint": key,
                                "text": stripped,
                                "fallback": window[0],
                            }
                        )
    return {
        "ok": not stub_issues and not broad_swallow,
        "stubIssues": stub_issues,
        "newBroadSwallowedExceptions": broad_swallow,
        "allowlistedBroadSwallowedExceptions": len(allowlist),
    }


def update_allowlist() -> dict[str, Any]:
    fingerprints: list[str] = []
    for path in _source_files():
        lines = path.read_text().splitlines()
        for index, line in enumerate(lines):
            if line.strip().startswith("except Exception"):
                window = [candidate.strip() for candidate in lines[index + 1 : index + 5] if candidate.strip()]
                if window and (
                    window[0] == "pass"
                    or window[0].startswith("return []")
                    or window[0].startswith("return {}")
                    or window[0].startswith("return None")
                ):
                    fingerprints.append(_fingerprint(path, index, lines))
    payload = {
        "schemaVersion": 1,
        "notes": "Allowlist for pre-existing broad swallowed exceptions. New entries fail audit_stubs --strict.",
        "broad_exception_swallow": sorted(set(fingerprints)),
    }
    ALLOWLIST_PATH.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--update-allowlist", action="store_true")
    args = parser.parse_args()

    if args.update_allowlist:
        payload = update_allowlist()
        print(json.dumps({"updated": True, "entries": len(payload["broad_exception_swallow"])}, sort_keys=True))
        return 0

    result = scan()
    if args.json:
        print(json.dumps(result, sort_keys=True))
    elif result["ok"]:
        print("Stub audit passed")
    else:
        for issue in result["stubIssues"] + result["newBroadSwallowedExceptions"]:
            print(issue, file=sys.stderr)
    return 0 if result["ok"] or not args.strict else 1


if __name__ == "__main__":
    raise SystemExit(main())

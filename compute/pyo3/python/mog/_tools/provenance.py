"""Import provenance helpers for installed Python SDK verification."""
from __future__ import annotations

import inspect
import json
import platform
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[5]


def _git_sha() -> Optional[str]:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=_repo_root(),
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except Exception:
        return None


def provenance() -> dict[str, Any]:
    import mog
    import mog._native as native

    return {
        "mog_file": str(Path(mog.__file__).resolve()),
        "native_extension_path": str(Path(inspect.getfile(native)).resolve()),
        "public_git_sha": _git_sha(),
        "python_version": sys.version,
        "python_executable": sys.executable,
        "platform": platform.platform(),
    }


def main() -> int:
    print(json.dumps(provenance(), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

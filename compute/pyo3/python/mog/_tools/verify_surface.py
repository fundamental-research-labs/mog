"""Verify the generated Python SDK surface against runtime objects."""
from __future__ import annotations

import argparse
import inspect
import json
import sys
from typing import Any, Optional

from mog._generated.api_surface import API_SURFACE
from mog.errors import UnsupportedApiError


CHECKED_STATUSES = {"implemented", "renamed", "unsupported", "python_only"}


def _resolve_python_path(path: str, wb: Any, ws: Any) -> tuple[bool, Optional[Any], Optional[str]]:
    parts = path.split(".")
    if not parts:
        return False, None, "empty python path"
    if parts[0] == "wb":
        obj = wb
    elif parts[0] == "ws":
        obj = ws
    else:
        return False, None, f"unknown root {parts[0]!r}"
    for part in parts[1:]:
        try:
            obj = getattr(obj, part)
        except Exception as exc:
            return False, None, f"{path}: missing {part!r}: {type(exc).__name__}: {exc}"
    return True, obj, None


def _dummy_call_args(func: Any) -> tuple[list[Any], dict[str, Any]]:
    try:
        signature = inspect.signature(func)
    except (TypeError, ValueError):
        return [], {}

    args: list[Any] = []
    kwargs: dict[str, Any] = {}
    for parameter in signature.parameters.values():
        if parameter.default is not inspect.Parameter.empty:
            continue
        if parameter.kind in {
            inspect.Parameter.VAR_POSITIONAL,
            inspect.Parameter.VAR_KEYWORD,
        }:
            continue
        if parameter.kind in {
            inspect.Parameter.POSITIONAL_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
        }:
            args.append(None)
        elif parameter.kind == inspect.Parameter.KEYWORD_ONLY:
            kwargs[parameter.name] = None
    return args, kwargs


def _verify_unsupported_call(item: dict[str, Any], target: Any) -> Optional[str]:
    if not callable(target):
        return "unsupported path is not callable"
    args, kwargs = _dummy_call_args(target)
    try:
        target(*args, **kwargs)
    except UnsupportedApiError as exc:
        if exc.api_path != item["apiPath"]:
            return f"UnsupportedApiError api_path mismatch: {exc.api_path!r}"
        if exc.python_path != item["pythonPath"]:
            return f"UnsupportedApiError python_path mismatch: {exc.python_path!r}"
        reason = item.get("reason") or "release_deferred"
        if exc.reason_code != reason:
            return f"UnsupportedApiError reason_code mismatch: {exc.reason_code!r}"
        return None
    except Exception as exc:
        return f"expected UnsupportedApiError, got {type(exc).__name__}: {exc}"
    return "unsupported path returned instead of raising UnsupportedApiError"


def _root_public(cls: type, root: str) -> set[str]:
    return {
        f"{root}.{name}"
        for name in dir(cls)
        if not name.startswith("_")
    }


def verify(strict: bool = False, only: Optional[str] = None) -> dict[str, Any]:
    if strict:
        import mog._native  # noqa: F401

    import mog
    from mog.workbook import Workbook
    from mog.worksheet import Worksheet

    wb = mog.create_workbook()
    try:
        ws = wb.active_sheet
        failures: list[dict[str, str]] = []
        checked = 0
        grouped: dict[str, dict[str, int]] = {}

        for item in API_SURFACE["dispositions"]:
            api_path = item["apiPath"]
            if only and only not in api_path and only not in item.get("interface", ""):
                continue
            status = item["status"]
            grouped.setdefault(item.get("interface", "Unknown"), {})
            grouped[item.get("interface", "Unknown")][status] = grouped[item.get("interface", "Unknown")].get(status, 0) + 1
            if status not in CHECKED_STATUSES:
                continue
            python_path = item.get("pythonPath")
            if not python_path:
                failures.append({"apiPath": api_path, "error": f"{status} missing pythonPath"})
                continue
            ok, target, error = _resolve_python_path(python_path, wb, ws)
            checked += 1
            if not ok:
                failures.append({"apiPath": api_path, "pythonPath": python_path, "error": error or "missing"})
                continue
            if status == "unsupported" or (status == "python_only" and item.get("reason")):
                error = _verify_unsupported_call(item, target)
                checked += 1
                if error:
                    failures.append({"apiPath": api_path, "pythonPath": python_path, "error": error})

        documented_root = {
            item["pythonPath"]
            for item in API_SURFACE["dispositions"]
            if item.get("pythonPath") and len(str(item["pythonPath"]).split(".")) == 2
        }
        actual_root = _root_public(Workbook, "wb") | _root_public(Worksheet, "ws")
        undocumented = sorted(actual_root - documented_root)
        if strict and undocumented:
            for path in undocumented:
                failures.append({"apiPath": f"py.{path}", "pythonPath": path, "error": "undocumented public root path"})

        return {
            "ok": not failures,
            "checked": checked,
            "failures": failures,
            "counts": API_SURFACE["counts"],
            "statusCounts": API_SURFACE["statusCounts"],
            "grouped": grouped,
        }
    finally:
        wb.dispose()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--only")
    args = parser.parse_args()

    result = verify(strict=args.strict, only=args.only)
    if args.json:
        print(json.dumps(result, sort_keys=True))
    else:
        if result["ok"]:
            print(f"Surface verification passed ({result['checked']} runtime paths checked)")
        else:
            for failure in result["failures"]:
                print(failure, file=sys.stderr)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

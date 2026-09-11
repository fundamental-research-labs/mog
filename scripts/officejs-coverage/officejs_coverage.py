#!/usr/bin/env python3
"""Office.js Excel API catalog + verification/implementation coverage.

The Microsoft Excel JavaScript API is the contract Mog implements. This
tool snapshots that catalog (classes, methods, properties) and records:

  * which members Mog's Office.js host defines
  * which members the calipers verification scripts actually call

Excel.Functions (workbook.functions.sum, …) is a separate family of
worksheet-function wrappers. Mog evaluates those as cell formulas through
Range.formulas, not through workbook.functions.

Usage:
  coverage.py catalog --yaml-dir DIR --out excel-js-api.json
  coverage.py scan --catalog excel-js-api.json \\
      --officejs compute/officejs/src \\
      --cases vendor/calipers/verification/cases \\
      --out officejs-coverage.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

CATALOG_SOURCE = {
    "title": "Microsoft Excel JavaScript API",
    "url": "https://learn.microsoft.com/javascript/api/excel?view=excel-js-preview",
    "note": (
        "Members taken from OfficeDev/office-js-docs-reference "
        "docs/docs-ref-autogen/excel/excel YAML (Excel preview)."
    ),
}

# Inherited ClientObject / proxy infrastructure — not class-specific API.
SKIP_METHODS = {"toJSON", "track", "untrack", "load", "set"}
SKIP_PROPERTIES = {"context"}

# Local constructor names that are not Excel.<same>.
CTOR_ALIASES = {
    "FreezePaneCollection": "Excel.WorksheetFreezePanes",
    "ClientRequestContext": "Excel.RequestContext",
    "RequestContext": "Excel.RequestContext",
    "PivotHierarchyList": "Excel.RowColumnPivotHierarchyCollection",
    "DataHierarchyList": "Excel.DataPivotHierarchyCollection",
    "DataHierarchy": "Excel.DataPivotHierarchy",
}

APISET_RE = re.compile(
    r"API set:\s*(ExcelApi(?:Online|Desktop)?(?:\s+[\d.]+)?)",
    re.I,
)
XREF_RE = re.compile(r"excel!Excel\.([^:]+):")
IDENT_RE = re.compile(r"[A-Za-z_$][\w$]*")
JS_STRING_RE = re.compile(
    r"'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"|`(?:\\.|[^`\\])*`"
)
FORMULA_RE = re.compile(r"=\s*([A-Z][A-Z0-9.]+)\s*\(", re.I)
LOAD_ARG_RE = re.compile(
    r"""\.load\(\s*(?:'([^']*)'|"([^"]*)"|\[([^\]]*)\])""",
    re.M,
)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def base_name(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("("):
        return raw
    return re.sub(r"\(.*", "", raw).strip()


def clean_type(raw: str) -> str:
    raw = (raw or "").strip()
    raw = re.sub(r"<[^<>]*>", "", raw)
    raw = raw.replace("&lt;", "<").replace("&gt;", ">")
    m = XREF_RE.search(raw)
    if m:
        return "Excel." + m.group(1)
    raw = re.sub(r"^<xref uid=\"[^\"]+\" />", "", raw).strip()
    if raw.startswith("Excel."):
        return raw.split("|")[0].split(";")[0].strip()
    return raw.split(";")[0].strip()


def type_from_syntax(content: str) -> tuple[str, bool]:
    content = (content or "").strip().strip("'\"")
    readonly = content.startswith("readonly ")
    if "(" in content.split(":")[0] or re.search(r"\)\s*:", content):
        m = re.search(r"\)\s*:\s*([^;]+)", content)
        return (clean_type(m.group(1)) if m else "", False)
    m = re.search(r":\s*([^;]+);\s*$", content)
    return (clean_type(m.group(1)) if m else "", readonly)


def parse_yaml_header(text: str) -> dict[str, str]:
    mime = text.splitlines()[0].strip() if text else ""
    info = {"mime": mime, "name": "", "kind": ""}
    if "YamlMime:TSEnum" in mime:
        info["kind"] = "enum"
    for line in text.splitlines()[:80]:
        if line.startswith("name:"):
            info["name"] = line.split(":", 1)[1].strip()
        elif line.startswith("type:"):
            info["kind"] = line.split(":", 1)[1].strip()
        elif line.startswith("uid:"):
            info["uid"] = line.split(":", 1)[1].strip()
    if not info["kind"] and "YamlMime:TSType" in mime:
        info["kind"] = "type"
    return info


def iter_section_items(text: str, header: str) -> Iterable[dict[str, Any]]:
    lines = text.splitlines()
    try:
        start = lines.index(header)
    except ValueError:
        return
    i = start + 1
    while i < len(lines):
        line = lines[i]
        if (
            line
            and not line.startswith(" ")
            and not line.startswith("\t")
            and not line.startswith("- ")
        ):
            break
        if line.startswith("  - name:"):
            raw = line.split(":", 1)[1].strip()
            block = [line]
            i += 1
            while i < len(lines):
                nxt = lines[i]
                if nxt.startswith("  - name:") or (
                    nxt
                    and not nxt.startswith(" ")
                    and not nxt.startswith("\t")
                ):
                    break
                block.append(nxt)
                i += 1
            blob = "\n".join(block)
            api = APISET_RE.search(blob)
            syn = re.search(
                r"syntax:\s*\n\s+content:\s+(.+)", blob
            )
            content = ""
            if syn:
                content = syn.group(1).strip().strip("'\"")
            ret, readonly = type_from_syntax(content)
            yield {
                "raw": raw,
                "name": base_name(raw),
                "uid": (
                    re.search(r"^\s+uid:\s+(\S+)", blob, re.M).group(1)
                    if re.search(r"^\s+uid:\s+(\S+)", blob, re.M)
                    else ""
                ),
                "apiSet": api.group(1).strip() if api else "",
                "preview": "isPreview: true" in blob,
                "deprecated": "isDeprecated: true" in blob,
                "syntax": content,
                "returnType": ret,
                "readonly": readonly,
            }
            continue
        i += 1


def build_catalog(yaml_dir: Path) -> dict[str, Any]:
    classes: list[dict[str, Any]] = []
    for path in sorted(yaml_dir.glob("*.yml")):
        text = path.read_text(encoding="utf-8", errors="replace")
        header = parse_yaml_header(text)
        if header.get("kind") != "class":
            continue
        cid = header["name"]
        if not cid.startswith("Excel.") or cid.startswith("Excel.Interfaces."):
            continue
        methods: dict[str, dict[str, Any]] = {}
        for item in iter_section_items(text, "methods:") or []:
            name = item["name"]
            if name in SKIP_METHODS or name.startswith("("):
                continue
            slot = methods.setdefault(
                name,
                {
                    "name": name,
                    "kind": "method",
                    "signatures": [],
                    "apiSet": item["apiSet"],
                    "preview": item["preview"],
                    "returnType": item["returnType"],
                },
            )
            if item["raw"] not in slot["signatures"]:
                slot["signatures"].append(item["raw"])
            if item["preview"]:
                slot["preview"] = True
            if item["apiSet"] and (
                not slot["apiSet"] or item["apiSet"] < slot["apiSet"]
            ):
                slot["apiSet"] = item["apiSet"]
            if item["returnType"] and item["returnType"].startswith("Excel."):
                slot["returnType"] = item["returnType"]
        properties: dict[str, dict[str, Any]] = {}
        for item in iter_section_items(text, "properties:") or []:
            name = item["name"]
            if name in SKIP_PROPERTIES:
                continue
            properties[name] = {
                "name": name,
                "kind": "property",
                "apiSet": item["apiSet"],
                "preview": item["preview"],
                "returnType": item["returnType"],
                "readonly": item["readonly"],
            }
        events: dict[str, dict[str, Any]] = {}
        for item in iter_section_items(text, "events:") or []:
            name = item["name"]
            events[name] = {
                "name": name,
                "kind": "event",
                "apiSet": item["apiSet"],
                "preview": item["preview"],
                "returnType": item["returnType"],
            }
        family = "functions" if cid == "Excel.Functions" else "object-model"
        classes.append(
            {
                "id": cid,
                "family": family,
                "methods": sorted(methods.values(), key=lambda m: m["name"].lower()),
                "properties": sorted(
                    properties.values(), key=lambda m: m["name"].lower()
                ),
                "events": sorted(events.values(), key=lambda m: m["name"].lower()),
            }
        )
    classes.sort(key=lambda c: c["id"].lower())
    om = [c for c in classes if c["family"] == "object-model"]
    fn = next((c for c in classes if c["id"] == "Excel.Functions"), None)
    return {
        "version": 1,
        "generatedAt": utc_now(),
        "source": CATALOG_SOURCE,
        "summary": {
            "classes": len(classes),
            "objectModelClasses": len(om),
            "methods": sum(len(c["methods"]) for c in classes),
            "objectModelMethods": sum(len(c["methods"]) for c in om),
            "objectModelProperties": sum(len(c["properties"]) for c in om),
            "events": sum(len(c["events"]) for c in classes),
            "functionsClassMethods": len(fn["methods"]) if fn else 0,
        },
        "classes": classes,
    }


def index_catalog(catalog: dict[str, Any]) -> dict[str, Any]:
    by_id = {c["id"]: c for c in catalog["classes"]}
    members: dict[tuple[str, str, str], dict[str, Any]] = {}
    nav: dict[str, dict[str, str]] = defaultdict(dict)
    unique_name: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for cls in catalog["classes"]:
        cid = cls["id"]
        for kind in ("methods", "properties", "events"):
            for mem in cls[kind]:
                members[(cid, mem["name"], mem["kind"] if kind != "methods" else "method")] = mem
                unique_name[mem["name"]].append((cid, "method" if kind == "methods" else mem["kind"]))
                ret = mem.get("returnType") or ""
                if ret.startswith("Excel."):
                    nav[cid][mem["name"]] = ret
    return {"by_id": by_id, "members": members, "nav": nav, "unique_name": unique_name}


def extract_js_strings(blob: str) -> list[str]:
    return [m.group(0)[1:-1] for m in re.finditer(r"'([^'\\]*)'|\"([^\"\\]*)\"", blob)]


def matching_brace(text: str, open_idx: int) -> int:
    depth = 0
    i = open_idx
    n = len(text)
    while i < n:
        ch = text[i]
        if ch in "'\"`":
            q = ch
            i += 1
            while i < n:
                if text[i] == "\\":
                    i += 2
                    continue
                if text[i] == q:
                    i += 1
                    break
                i += 1
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return n


def resolve_ctor(name: str, aliases: dict[str, str], class_ids: set[str]) -> str | None:
    if name in CTOR_ALIASES:
        return CTOR_ALIASES[name]
    mapped = aliases.get(name)
    if mapped in class_ids:
        return mapped
    excel = "Excel." + name
    if excel in class_ids:
        return excel
    return mapped if mapped in class_ids else None


def scan_officejs_host(src_dir: Path, catalog: dict[str, Any]) -> dict[tuple[str, str], str]:
    """Return {(class_id, member_name): kind} implemented by Mog JS."""
    class_ids = {c["id"] for c in catalog["classes"]}
    implemented: dict[tuple[str, str], str] = {}
    aliases: dict[str, str] = {}

    files = [
        p
        for p in sorted(src_dir.glob("*.js"))
        if " 2." not in p.name
    ]
    texts = [p.read_text(encoding="utf-8", errors="replace") for p in files]
    joined_for_alias = "\n".join(texts)
    for m in re.finditer(
        r"Excel\.([A-Za-z0-9]+)\s*=\s*([A-Za-z0-9]+)", joined_for_alias
    ):
        aliases[m.group(2)] = "Excel." + m.group(1)

    def mark(cid: str | None, name: str, kind: str) -> None:
        if not cid or not name or name.startswith("_"):
            return
        if name in SKIP_METHODS or name in SKIP_PROPERTIES:
            return
        implemented[(cid, name)] = kind

    for text in texts:
        for m in re.finditer(
            r"(?:Excel\.([A-Za-z0-9]+)|([A-Za-z0-9]+))\.prototype\.([A-Za-z0-9]+)\s*=\s*function",
            text,
        ):
            cid = (
                "Excel." + m.group(1)
                if m.group(1)
                else resolve_ctor(m.group(2), aliases, class_ids)
            )
            mark(cid, m.group(3), "method")

        for m in re.finditer(
            r"Object\.defineProperty\(\s*(?:Excel\.([A-Za-z0-9]+)|([A-Za-z0-9]+))\.prototype\s*,\s*['\"]([A-Za-z0-9]+)['\"]",
            text,
        ):
            cid = (
                "Excel." + m.group(1)
                if m.group(1)
                else resolve_ctor(m.group(2), aliases, class_ids)
            )
            mark(cid, m.group(3), "property")

        for m in re.finditer(
            r"(addScalarProperties|defineScalars)\(\s*(?:Excel\.([A-Za-z0-9]+)|([A-Za-z0-9]+))(?:\.prototype)?\s*,\s*\[([^\]]*)\]",
            text,
        ):
            cid = (
                "Excel." + m.group(2)
                if m.group(2)
                else resolve_ctor(m.group(3), aliases, class_ids)
            )
            for name in extract_js_strings("[" + m.group(4) + "]"):
                mark(cid, name, "property")

        for m in re.finditer(
            r"\[([^\]]+)\]\.forEach\(function\s*\(\s*name\s*\)[^{]*\{[^}]*?Object\.defineProperty\(\s*(?:Excel\.([A-Za-z0-9]+)|([A-Za-z0-9]+))\.prototype\s*,\s*name",
            text,
            re.S,
        ):
            cid = (
                "Excel." + m.group(2)
                if m.group(2)
                else resolve_ctor(m.group(3), aliases, class_ids)
            )
            for name in extract_js_strings("[" + m.group(1) + "]"):
                mark(cid, name, "property")

        for m in re.finditer(r"function\s+([A-Za-z0-9]+)\s*\([^)]*\)\s*\{", text):
            cid = resolve_ctor(m.group(1), aliases, class_ids)
            if not cid:
                continue
            body_start = m.end() - 1
            body_end = matching_brace(text, body_start)
            body = text[body_start : body_end + 1]
            for key, kind in (
                ("_scalarProperties", "property"),
                ("_navigationProperties", "property"),
            ):
                sm = re.search(key + r"\s*=\s*\[([^\]]*)\]", body)
                if sm:
                    for name in extract_js_strings("[" + sm.group(1) + "]"):
                        mark(cid, name, kind)

        for m in re.finditer(
            r"Object\.defineProperty\(\s*(?:Excel\.([A-Za-z0-9]+)|([A-Za-z0-9]+))\.prototype\s*,\s*['\"]([A-Za-z0-9]+)['\"]",
            text,
        ):
            pass  # already handled

        # Navigation getters: Object.defineProperty(Excel.Workbook.prototype, "comments"
        for m in re.finditer(
            r"Object\.defineProperty\(\s*Excel\.([A-Za-z0-9]+)\.prototype\s*,\s*['\"]([A-Za-z0-9]+)['\"]",
            text,
        ):
            mark("Excel." + m.group(1), m.group(2), "property")

    # Runtime surface that every script uses.
    implemented[("Excel.RequestContext", "workbook")] = "property"
    implemented[("Excel.RequestContext", "sync")] = "method"
    implemented[("Excel", "run")] = "method"
    return implemented


TOKEN_RE = re.compile(
    r"""
    (?P<id>[A-Za-z_$][\w$]*)
    |(?P<str>'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)
    |(?P<punct>[()\[\]{},=;:])
    |(?P<dot>\.)
    """,
    re.X,
)


def tokenize_js(src: str) -> list[tuple[str, str]]:
    src = re.sub(r"/\*.*?\*/", " ", src, flags=re.S)
    src = re.sub(r"//.*?$", " ", src, flags=re.M)
    tokens: list[tuple[str, str]] = []
    for m in TOKEN_RE.finditer(src):
        kind = m.lastgroup or "id"
        tokens.append((kind, m.group(0)))
    return tokens


def lookup_member(
    cid: str | None, name: str, index: dict[str, Any]
) -> tuple[str | None, str, str]:
    """Return (class_id, name, kind) and navigation return type in nav map."""
    if not cid:
        return None, name, ""
    nav = index["nav"].get(cid, {})
    by_id = index["by_id"].get(cid)
    if not by_id:
        return cid, name, ""
    for kind, key in (
        ("method", "methods"),
        ("property", "properties"),
        ("event", "events"),
    ):
        for mem in by_id[key]:
            if mem["name"] == name:
                return cid, name, kind
    if name in nav:
        return cid, name, "property"
    return cid, name, ""


def scan_script(source: str, index: dict[str, Any]) -> tuple[set[tuple[str, str, str]], set[str]]:
    used: set[tuple[str, str, str]] = set()
    formulas: set[str] = set()
    for lit in JS_STRING_RE.findall(source):
        if "=" not in lit:
            continue
        formulas.update(m.group(1).upper() for m in re.finditer(r"\b([A-Z][A-Z0-9.]+)\s*\(", lit, re.I))
    tokens = tokenize_js(source)
    env: dict[str, str] = {"context": "Excel.RequestContext"}
    i = 0
    n = len(tokens)

    def peek(k: int = 0) -> tuple[str, str]:
        j = i + k
        if j < n:
            return tokens[j]
        return ("", "")

    def consume() -> tuple[str, str]:
        nonlocal i
        tok = tokens[i] if i < n else ("", "")
        i += 1
        return tok

    def skip_call() -> None:
        nonlocal i
        depth = 0
        while i < n:
            kind, val = consume()
            if val == "(":
                depth += 1
            elif val == ")":
                depth -= 1
                if depth <= 0:
                    return

    def expr_type() -> str | None:
        nonlocal i
        kind, val = peek()
        current: str | None = None
        if kind == "id":
            consume()
            if val == "Excel":
                current = "Excel"
            elif val == "context" or val in env:
                current = env.get(val, "Excel.RequestContext" if val == "context" else None)
            else:
                current = env.get(val)
        elif val == "(":
            consume()
            current = expr_type()
            if peek()[1] == ")":
                consume()
        else:
            return None
        while peek()[0] == "dot":
            consume()
            nk, name = peek()
            if nk != "id":
                break
            consume()
            is_call = peek()[1] == "("
            if current == "Excel" and name == "run":
                used.add(("Excel", "run", "method"))
                # Do not skip the callback body — that is the script.
                current = None
                continue
            if current == "Excel.RequestContext" and name == "sync":
                used.add(("Excel.RequestContext", "sync", "method"))
                if is_call:
                    skip_call()
                current = None
                continue
            if current == "Excel.RequestContext" and name == "workbook":
                used.add(("Excel.RequestContext", "workbook", "property"))
                current = "Excel.Workbook"
                continue
            cid, mem, kind_found = lookup_member(current, name, index)
            if cid and kind_found:
                used.add((cid, mem, kind_found if not is_call or kind_found == "method" else "method"))
            elif cid and is_call:
                used.add((cid, name, "method"))
            elif cid:
                used.add((cid, name, "property"))
            ret = None
            if current:
                ret = index["nav"].get(current, {}).get(name)
            if is_call:
                skip_call()
            current = ret or current
            if name in ("getItem", "getItemOrNullObject", "getItemAt", "add") and current:
                # Collection add/get typically returns the element type.
                if current.endswith("Collection"):
                    elem = current[: -len("Collection")]
                    if elem in index["by_id"]:
                        current = elem
                    elif current == "Excel.WorksheetCollection":
                        current = "Excel.Worksheet"
                    elif current == "Excel.TableCollection":
                        current = "Excel.Table"
                    elif current == "Excel.ChartCollection":
                        current = "Excel.Chart"
                    elif current == "Excel.PivotTableCollection":
                        current = "Excel.PivotTable"
                    elif current == "Excel.NamedItemCollection":
                        current = "Excel.NamedItem"
                    elif current == "Excel.CommentCollection":
                        current = "Excel.Comment"
                    elif current == "Excel.ConditionalFormatCollection":
                        current = "Excel.ConditionalFormat"
        return current

    while i < n:
        kind, val = peek()
        if kind == "id" and val in {"const", "let", "var"}:
            consume()
            nk, name = peek()
            if nk == "id":
                consume()
                if peek()[1] == "=":
                    consume()
                    typ = expr_type()
                    if typ:
                        env[name] = typ
            continue
        if kind == "id" and val == "Excel" and peek(1) == ("dot", ".") and peek(2)[1] == "run":
            expr_type()
            continue
        if kind == "id":
            # start of a chain or assignment
            save = i
            typ = expr_type()
            if peek()[1] == "=":
                consume()
                expr_type()
            if typ is None and i == save:
                consume()
            continue
        consume()

    for m in LOAD_ARG_RE.finditer(source):
        blob = m.group(1) or m.group(2) or m.group(3) or ""
        names = [p.strip().strip("'\"") for p in re.split(r"[/,]", blob) if p.strip()]
        for name in names:
            name = name.split("/")[-1]
            if not name or name in {"items", "$all"}:
                continue
            hits = index["unique_name"].get(name, [])
            if len(hits) == 1:
                cid, kind = hits[0]
                used.add((cid, name, kind))

    return used, formulas


def iter_case_scripts(cases_dir: Path) -> Iterable[tuple[str, Path]]:
    for suite in sorted(p for p in cases_dir.iterdir() if p.is_dir() and not p.name.startswith("_")):
        for case in sorted(p for p in suite.iterdir() if p.is_dir()):
            script = case / "script.js"
            if script.is_file() and script.stat().st_size > 0:
                yield f"{suite.name}/{case.name}", script


def scan_coverage(
    catalog: dict[str, Any], officejs_dir: Path, cases_dir: Path
) -> dict[str, Any]:
    index = index_catalog(catalog)
    implemented = scan_officejs_host(officejs_dir, catalog)
    used_by: dict[tuple[str, str], list[str]] = defaultdict(list)
    formulas_by: dict[str, list[str]] = defaultdict(list)
    for case_id, path in iter_case_scripts(cases_dir):
        src = path.read_text(encoding="utf-8", errors="replace")
        used, formulas = scan_script(src, index)
        for cid, name, _kind in used:
            key = (cid, name)
            if case_id not in used_by[key]:
                used_by[key].append(case_id)
        for formula in sorted(formulas):
            if case_id not in formulas_by[formula]:
                formulas_by[formula].append(case_id)

    out_classes = []
    sum_impl_m = sum_ver_m = sum_impl_p = sum_ver_p = 0
    om_methods = om_props = 0
    for cls in catalog["classes"]:
        cid = cls["id"]
        members_out = []
        impl_m = ver_m = impl_p = ver_p = 0
        for kind, bucket in (
            ("method", cls["methods"]),
            ("property", cls["properties"]),
            ("event", cls["events"]),
        ):
            for mem in bucket:
                name = mem["name"]
                impl = (cid, name) in implemented
                cases = sorted(used_by.get((cid, name), []))
                # Runtime sync lives on RequestContext even if YAML omits it.
                if cid == "Excel.RequestContext" and name == "sync":
                    impl = True
                rec = {
                    "id": f"{cid}.{name}",
                    "name": name,
                    "kind": kind,
                    "signature": (mem.get("signatures") or [name])[0],
                    "apiSet": mem.get("apiSet") or "",
                    "preview": bool(mem.get("preview")),
                    "implemented": impl,
                    "cases": cases,
                }
                members_out.append(rec)
                if cls["family"] == "object-model":
                    if kind == "method":
                        om_methods += 1
                        if impl:
                            impl_m += 1
                        if cases:
                            ver_m += 1
                    elif kind == "property":
                        om_props += 1
                        if impl:
                            impl_p += 1
                        if cases:
                            ver_p += 1
        if cls["family"] == "object-model":
            sum_impl_m += impl_m
            sum_ver_m += ver_m
            sum_impl_p += impl_p
            sum_ver_p += ver_p
        out_classes.append(
            {
                "id": cid,
                "family": cls["family"],
                "methodCount": len(cls["methods"]),
                "propertyCount": len(cls["properties"]),
                "eventCount": len(cls["events"]),
                "implementedMethods": impl_m,
                "verifiedMethods": ver_m,
                "implementedProperties": impl_p,
                "verifiedProperties": ver_p,
                "members": members_out,
            }
        )

    fn = catalog["summary"]
    return {
        "version": 1,
        "generatedAt": utc_now(),
        "source": catalog.get("source", CATALOG_SOURCE),
        "summary": {
            "classes": fn["classes"],
            "objectModelClasses": fn["objectModelClasses"],
            "methods": fn["methods"],
            "objectModelMethods": fn["objectModelMethods"],
            "objectModelProperties": fn["objectModelProperties"],
            "events": fn["events"],
            "functionsClassMethods": fn["functionsClassMethods"],
            "implementedObjectModelMethods": sum_impl_m,
            "verifiedObjectModelMethods": sum_ver_m,
            "implementedObjectModelProperties": sum_impl_p,
            "verifiedObjectModelProperties": sum_ver_p,
            "formulasInScripts": len(formulas_by),
        },
        "runtime": [
            {
                "id": "Excel.run",
                "implemented": ("Excel", "run") in implemented,
                "cases": sorted(used_by.get(("Excel", "run"), [])),
            },
            {
                "id": "RequestContext.sync",
                "implemented": True,
                "cases": sorted(used_by.get(("Excel.RequestContext", "sync"), [])),
            },
            {
                "id": "RequestContext.workbook",
                "implemented": True,
                "cases": sorted(used_by.get(("Excel.RequestContext", "workbook"), [])),
            },
        ],
        "formulas": [
            {"name": name, "cases": cases}
            for name, cases in sorted(formulas_by.items())
        ],
        "classes": out_classes,
    }


def cmd_catalog(args: argparse.Namespace) -> int:
    catalog = build_catalog(Path(args.yaml_dir))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    s = catalog["summary"]
    print(
        f"wrote {out} · {s['classes']} classes · "
        f"{s['objectModelMethods']} object-model methods · "
        f"{s['functionsClassMethods']} Excel.Functions methods",
        file=sys.stderr,
    )
    return 0


def cmd_scan(args: argparse.Namespace) -> int:
    catalog = json.loads(Path(args.catalog).read_text(encoding="utf-8"))
    coverage = scan_coverage(
        catalog, Path(args.officejs), Path(args.cases)
    )
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(coverage, indent=2) + "\n", encoding="utf-8")
    s = coverage["summary"]
    print(
        f"wrote {out} · object-model methods "
        f"{s['verifiedObjectModelMethods']}/{s['objectModelMethods']} verified, "
        f"{s['implementedObjectModelMethods']}/{s['objectModelMethods']} in Mog",
        file=sys.stderr,
    )
    return 0


def cmd_show(args: argparse.Namespace) -> int:
    doc = json.loads(Path(args.coverage).read_text(encoding="utf-8"))
    kind = args.kind
    class_filter = args.class_name
    only = args.only
    rows = []
    for cls in doc["classes"]:
        if class_filter and class_filter.lower() not in cls["id"].lower():
            continue
        if args.family and cls["family"] != args.family:
            continue
        for mem in cls["members"]:
            if kind is not None and mem["kind"] != kind:
                continue
            impl = bool(mem.get("implemented"))
            verified = bool(mem.get("cases"))
            if only == "verified" and not verified:
                continue
            if only == "implemented" and not impl:
                continue
            if only == "missing" and (impl or verified):
                continue
            if only == "unimplemented" and impl:
                continue
            if only == "unverified" and verified:
                continue
            # only is None: keep every member
            cases = ",".join(mem.get("cases") or [])
            apiset = (mem.get("apiSet") or "—").replace("\t", " ").split("\n")[0]
            rows.append(
                (
                    mem.get("id") or f"{cls['id']}.{mem['name']}",
                    mem["kind"],
                    "yes" if impl else "no",
                    cases or "—",
                    apiset,
                )
            )
    s = doc.get("summary", {})
    print(
        f"object-model methods {s.get('verifiedObjectModelMethods')}/{s.get('objectModelMethods')} verified, "
        f"{s.get('implementedObjectModelMethods')}/{s.get('objectModelMethods')} in Mog, "
        f"{s.get('functionsClassMethods')} Excel.Functions",
        file=sys.stderr,
    )
    print("member\tkind\tmog\tcorpus\tapiset")
    for row in rows:
        print("\t".join(row))
    print(f"{len(rows)} rows", file=sys.stderr)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("catalog", help="Build excel-js-api.json from Microsoft YAML")
    c.add_argument("--yaml-dir", required=True)
    c.add_argument("--out", required=True)
    c.set_defaults(func=cmd_catalog)
    s = sub.add_parser("scan", help="Scan Mog host + verification scripts")
    s.add_argument("--catalog", required=True)
    s.add_argument("--officejs", required=True)
    s.add_argument("--cases", required=True)
    s.add_argument("--out", required=True)
    s.set_defaults(func=cmd_scan)
    sh = sub.add_parser("show", help="Print members from a coverage JSON")
    sh.add_argument("--coverage", required=True)
    sh.add_argument("--class", dest="class_name", default="", help="substring of Excel.Class")
    sh.add_argument("--kind", choices=["method", "property", "event"], default=None)
    sh.add_argument(
        "--family",
        choices=["object-model", "functions"],
        default="",
        help="object-model (default listing) or Excel.Functions",
    )
    sh.add_argument(
        "--only",
        choices=["verified", "implemented", "unverified", "unimplemented", "missing"],
        default=None,
        help="verified=in a script; implemented=in Mog; missing=neither",
    )
    sh.set_defaults(func=cmd_show)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())

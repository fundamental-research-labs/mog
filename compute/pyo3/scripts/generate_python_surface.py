#!/usr/bin/env python3
"""Generate and verify the Mog Python SDK public surface metadata."""
from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional


ROOT = Path(__file__).resolve().parents[3]
PYO3 = ROOT / "compute" / "pyo3"
PY_MOG = PYO3 / "python" / "mog"
SPEC_PATH = ROOT / "runtime" / "sdk" / "src" / "generated" / "api-spec.json"
DISPOSITIONS_PATH = PY_MOG / "api_dispositions.json"
SCHEMA_PATH = PY_MOG / "api_dispositions.schema.json"
GENERATED_DIR = PY_MOG / "_generated"
SURFACE_JSON_PATH = GENERATED_DIR / "api_surface.json"
SURFACE_PY_PATH = GENERATED_DIR / "api_surface.py"
PY_TYPED_PATH = PY_MOG / "py.typed"

VALID_STATUS = {
    "implemented",
    "renamed",
    "unsupported",
    "omitted",
    "out_of_scope",
    "python_only",
}
VALID_REASONS = {
    "native_missing",
    "host_capability_missing",
    "browser_only",
    "typescript_only",
    "deprecated_ts_api",
    "unsafe_without_design",
    "release_deferred",
}


ACCESSOR_OVERRIDES = {
    ("ws", "conditionalFormats"): "conditional_formats",
    ("ws", "customProperties"): "custom_properties",
    ("ws", "formControls"): "form_controls",
    ("ws", "textBoxes"): "text_boxes",
    ("ws", "textEffects"): "text_effects",
    ("ws", "validations"): "validation",
    ("ws", "print"): "print_",
    ("wb", "pivotTableStyles"): "pivot_table_styles",
    ("wb", "slicerStyles"): "slicer_styles",
    ("wb", "tableStyles"): "table_styles",
    ("wb", "timelineStyles"): "timeline_styles",
    ("wb", "cellStyles"): "cell_styles",
}

ROOT_METHOD_OVERRIDES = {
    ("wb", "toXlsx"): "to_buffer",
    ("wb", "setActivePrincipal"): "set_active_principal",
    ("wb", "activePrincipal"): "active_principal",
    ("wb", "securityActive"): "security_active",
    ("ws", "enableCalculation"): "enable_calculation",
}

KNOWN_UNSUPPORTED = {
    "wb.createCheckpoint": "wb.create_checkpoint",
    "wb.executeCode": "wb.execute_code",
    "wb.getFunctionCatalog": "wb.get_function_catalog",
    "wb.getFunctionInfo": "wb.get_function_info",
    "wb.history.goToIndex": "wb.history.go_to_index",
    "wb.listCheckpoints": "wb.list_checkpoints",
    "wb.restoreCheckpoint": "wb.restore_checkpoint",
    "wb.viewport.createRegion": "wb.viewport.create_region",
    "wb.viewport.resetSheetRegions": "wb.viewport.reset_sheet_regions",
    "wb.viewport.setRenderScheduler": "wb.viewport.set_render_scheduler",
    "wb.viewport.subscribe": "wb.viewport.subscribe",
    "wb.viewport.setShowFormulas": "wb.viewport.set_show_formulas",
    "wb.theme.getWorkbookTheme": "wb.theme.get_workbook_theme",
    "wb.theme.setWorkbookTheme": "wb.theme.set_workbook_theme",
    "wb.theme.getChromeTheme": "wb.theme.get_chrome_theme",
    "wb.theme.setChromeTheme": "wb.theme.set_chrome_theme",
    "ws.charts.exportImage": "ws.charts.export_image",
    "ws.autoFill": "ws.auto_fill",
    "ws.formatValues": "ws.format_values",
    "ws.settings.get": "ws.settings.get",
    "ws.settings.set": "ws.settings.set",
    "ws.settings.getStandardHeight": "ws.settings.get_standard_height",
    "ws.settings.getStandardWidth": "ws.settings.get_standard_width",
    "ws.settings.setStandardWidth": "ws.settings.set_standard_width",
    "ws.tables.clearFilters": "ws.tables.clear_filters",
    "ws.tables.applyAutoExpansion": "ws.tables.apply_auto_expansion",
    "ws.validations.getErrorsInRange": "ws.validation.get_errors_in_range",
    "ws.pictures.add": "ws.pictures.add",
    "ws.pictures.get": "ws.pictures.get",
    "ws.pictures.list": "ws.pictures.list",
    "ws.textBoxes.add": "ws.text_boxes.add",
    "ws.textBoxes.get": "ws.text_boxes.get",
    "ws.textBoxes.list": "ws.text_boxes.list",
    "ws.formControls.add": "ws.form_controls.add",
    "ws.formControls.addCheckbox": "ws.form_controls.add_checkbox",
    "ws.formControls.addComboBox": "ws.form_controls.add_combo_box",
    "ws.formControls.list": "ws.form_controls.list",
    "ws.formControls.get": "ws.form_controls.get",
    "ws.formControls.getAtPosition": "ws.form_controls.get_at_position",
    "ws.formControls.update": "ws.form_controls.update",
    "ws.formControls.move": "ws.form_controls.move",
    "ws.formControls.resize": "ws.form_controls.resize",
    "ws.formControls.remove": "ws.form_controls.remove",
}

UNSUPPORTED_TS_PREFIXES = {
    "wb.names",
    "wb.protection",
    "ws.charts",
    "ws.names",
    "ws.objects",
    "ws.print",
    "ws.protection",
    "ws.shapes",
    "ws.tables",
    "ws.validations",
    "ws.view",
}

PYTHON_ONLY_UNSUPPORTED = {
    "wb.bindings.list",
    "wb.bindings.add",
    "wb.bindings.remove",
    "wb.theme.get",
    "wb.theme.get_colors",
    "wb.theme.get_fonts",
    "wb.theme.list_table_styles",
    "wb.theme.set_colors",
    "wb.theme.set_fonts",
    "ws.data_table.create",
    "ws.data_table.list",
    "ws.data_table.delete",
    "ws.scenarios.add",
    "ws.scenarios.list",
    "ws.scenarios.update",
    "ws.scenarios.delete",
    "ws.scenarios.apply",
    "ws.settings.update",
    "ws.settings.get_standard_column_width",
    "ws.settings.get_standard_row_height",
    "ws.text_boxes.remove",
    "wb.resume_calc",
    "wb.goal_seek",
    "wb.recalculate_sheet",
    "wb.styles.get_table_styles",
    "wb.suspend_calc",
    "ws.charts.create",
    "ws.charts.delete",
    "ws.charts.sync_from_engine",
    "ws.names.add",
    "ws.names.get",
    "ws.names.list",
    "ws.names.remove",
    "ws.objects.add",
    "ws.objects.create",
    "ws.objects.delete",
    "ws.objects.delete_many",
    "ws.objects.duplicate",
    "ws.print_.clear_titles",
    "ws.print_.get_titles",
    "ws.print_.remove_all_page_breaks",
    "ws.print_.set_titles",
    "ws.protection.mark_locked",
    "ws.protection.mark_unlocked",
    "ws.shapes.add",
    "ws.shapes.bring_forward",
    "ws.shapes.bring_to_front",
    "ws.shapes.create",
    "ws.shapes.delete",
    "ws.shapes.delete_many",
    "ws.shapes.duplicate",
    "ws.shapes.group",
    "ws.shapes.send_backward",
    "ws.shapes.send_to_back",
    "ws.shapes.ungroup",
    "ws.shapes.update",
    "ws.tables.create",
    "ws.tables.delete",
    "ws.text_to_columns",
    "ws.validation.get_schema",
    "ws.validation.set_schema",
    "ws.view.get_options",
    "ws.view.set_option",
}

PYTHON_ONLY_UNSUPPORTED_PREFIXES = {
    "wb.styles.",
    "ws.charts.",
    "ws.names.",
    "ws.objects.",
    "ws.print_.",
    "ws.protection.",
    "ws.shapes.",
    "ws.tables.",
    "ws.validation.",
    "ws.view.",
}

SUBAPI_OWNER_OVERRIDES = {
    "conditional_formats": "mog.sub_apis.conditional_formats",
    "data_table": "mog.worksheet",
    "form_controls": "mog.worksheet",
    "names": "mog.worksheet",
    "pictures": "mog.worksheet",
    "print_": "mog.sub_apis.print_",
    "scenarios": "mog.worksheet",
    "settings": "mog.worksheet",
    "shapes": "mog.sub_apis.objects",
    "text_boxes": "mog.worksheet",
    "validation": "mog.sub_apis.validation",
}


@dataclass(frozen=True)
class SurfaceEntry:
    api_path: str
    stable_id: str
    interface: str
    member_name: str
    member_kind: str
    parent: str
    signature: str
    docstring: str
    used_types: list[str]
    python_path: Optional[str]
    parameters: list[dict[str, Any]]
    return_type: dict[str, Any]
    visibility: str
    deprecated: bool


def camel_to_snake(name: str) -> str:
    name = name.replace("[Symbol.", "symbol_").replace("]", "")
    name = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    name = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name)
    return name.replace("-", "_").lower()


def split_top_level(text: str) -> list[str]:
    parts: list[str] = []
    current: list[str] = []
    depth = 0
    quote: Optional[str] = None
    for ch in text:
        if quote:
            current.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in {"'", '"', "`"}:
            quote = ch
            current.append(ch)
            continue
        if ch in "([{<":
            depth += 1
        elif ch in ")]}>":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            part = "".join(current).strip()
            if part:
                parts.append(part)
            current = []
        else:
            current.append(ch)
    part = "".join(current).strip()
    if part:
        parts.append(part)
    return parts


def matching_paren(signature: str, start: int) -> int:
    depth = 0
    quote: Optional[str] = None
    for i in range(start, len(signature)):
        ch = signature[i]
        if quote:
            if ch == quote:
                quote = None
            continue
        if ch in {"'", '"', "`"}:
            quote = ch
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i
    return -1


def normalize_signature(signature: str) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    compact = " ".join(signature.split())
    if "(" not in compact:
        if ":" in compact:
            type_text = compact.split(":", 1)[1].rstrip(";").strip()
        else:
            type_text = "Any"
        return "property", [], normalize_return(type_text)

    start = compact.find("(")
    end = matching_paren(compact, start)
    params_text = compact[start + 1 : end] if end >= 0 else ""
    tail = compact[end + 1 :] if end >= 0 else compact
    return_text = "void"
    if ":" in tail:
        return_text = tail.split(":", 1)[1].rstrip(";").strip()
    params: list[dict[str, Any]] = []
    for raw in split_top_level(params_text):
        if not raw or "=>" in raw:
            continue
        name_type = raw.split(":", 1)
        raw_name = name_type[0].strip()
        type_text = name_type[1].strip() if len(name_type) == 2 else "Any"
        rest = raw_name.startswith("...")
        raw_name = raw_name.removeprefix("...")
        optional = raw_name.endswith("?")
        raw_name = raw_name.removesuffix("?")
        default = None
        if "=" in raw_name:
            raw_name, default = [p.strip() for p in raw_name.split("=", 1)]
            optional = True
        params.append(
            {
                "name": raw_name,
                "optional": optional,
                "default": default,
                "rest": rest,
                "type": normalize_type(type_text),
            }
        )
    return "method", params, normalize_return(return_text)


def normalize_type(type_text: str) -> dict[str, Any]:
    text = " ".join(type_text.split())
    if text.startswith("Promise<") and text.endswith(">"):
        return {"kind": "promise", "inner": normalize_type(text[8:-1])}
    if "[]" in text:
        return {"kind": "array", "text": text}
    if "|" in text:
        return {"kind": "union", "options": [p.strip() for p in split_top_level(text.replace("|", ","))], "text": text}
    if text.startswith("'") or text.startswith('"'):
        return {"kind": "literal", "text": text}
    return {"kind": "named", "text": text}


def normalize_return(type_text: str) -> dict[str, Any]:
    normalized = normalize_type(type_text)
    async_ts = normalized.get("kind") == "promise"
    return {
        "asyncTs": async_ts,
        "type": normalized["inner"] if async_ts else normalized,
        "raw": " ".join(type_text.split()),
    }


ALLOWED_TYPE_KINDS = {
    "primitive",
    "literal",
    "array",
    "tuple",
    "objectRef",
    "function",
    "promise",
    "union",
    "intersection",
    "record",
    "unknown",
    "void",
}


def load_spec() -> dict[str, Any]:
    spec = json.loads(SPEC_PATH.read_text())
    validate_api_spec_contract(spec)
    return spec


def validate_api_spec_contract(spec: dict[str, Any]) -> None:
    errors: list[str] = []
    if spec.get("schemaVersion") != "1":
        errors.append("api-spec.json schemaVersion must be '1'")
    if not isinstance(spec.get("interfaces"), dict):
        errors.append("api-spec.json must include top-level interfaces")
    subapis = spec.get("subApis")
    if not isinstance(subapis, dict):
        errors.append("api-spec.json must include top-level subApis")
    else:
        for root in ("workbook", "worksheet"):
            if not isinstance(subapis.get(root), dict):
                errors.append(f"api-spec.json subApis.{root} must be an object")
    if not isinstance(spec.get("types"), dict):
        errors.append("api-spec.json must include top-level types")

    for interface_name, info in (spec.get("interfaces") or {}).items():
        for member_name, meta in (info.get("functions") or {}).items():
            errors.extend(validate_api_member_meta(meta, f"interfaces.{interface_name}.functions.{member_name}"))
    for root in ("workbook", "worksheet"):
        for accessor, meta in ((spec.get("subApis") or {}).get(root) or {}).items():
            errors.extend(validate_api_member_meta(meta, f"subApis.{root}.{accessor}", require_target=True))

    if errors:
        preview = "\n".join(f"- {error}" for error in errors[:20])
        suffix = f"\n... {len(errors) - 20} more" if len(errors) > 20 else ""
        raise SystemExit(f"{SPEC_PATH.relative_to(ROOT)} contract validation failed:\n{preview}{suffix}")


def validate_api_member_meta(meta: Any, path: str, *, require_target: bool = False) -> list[str]:
    errors: list[str] = []
    if not isinstance(meta, dict):
        return [f"{path} must be an object"]
    for field in (
        "stableId",
        "canonicalPath",
        "root",
        "interface",
        "method",
        "kind",
        "visibility",
        "asyncModel",
        "parameters",
        "returns",
    ):
        if field not in meta:
            errors.append(f"{path} missing {field}")
    if require_target and "targetInterface" not in meta:
        errors.append(f"{path} missing targetInterface")
    if isinstance(meta.get("parameters"), list):
        for index, param in enumerate(meta["parameters"]):
            errors.extend(validate_parameter(param, f"{path}.parameters[{index}]"))
    returns = meta.get("returns")
    if isinstance(returns, dict):
        errors.extend(validate_normalized_type(returns.get("type"), f"{path}.returns.type"))
    else:
        errors.append(f"{path}.returns must be an object")
    return errors


def validate_parameter(param: Any, path: str) -> list[str]:
    errors: list[str] = []
    if not isinstance(param, dict):
        return [f"{path} must be an object"]
    for field in ("name", "position", "optional", "rest", "default", "type", "typeText"):
        if field not in param:
            errors.append(f"{path} missing {field}")
    errors.extend(validate_normalized_type(param.get("type"), f"{path}.type"))
    return errors


def validate_normalized_type(type_info: Any, path: str) -> list[str]:
    if not isinstance(type_info, dict):
        return [f"{path} must be an object"]
    kind = type_info.get("kind")
    if kind not in ALLOWED_TYPE_KINDS:
        return [f"{path}.kind is invalid: {kind!r}"]
    required_by_kind = {
        "primitive": ("name",),
        "literal": ("value",),
        "array": ("items",),
        "tuple": ("items",),
        "objectRef": ("name",),
        "function": ("params", "returns"),
        "promise": ("inner",),
        "union": ("items",),
        "intersection": ("items",),
        "record": ("key", "value"),
        "unknown": (),
        "void": (),
    }
    errors = [f"{path} missing {field}" for field in required_by_kind[kind] if field not in type_info]
    if kind == "array":
        errors.extend(validate_normalized_type(type_info.get("items"), f"{path}.items"))
    elif kind in {"tuple", "union", "intersection"}:
        items = type_info.get("items")
        if not isinstance(items, list):
            errors.append(f"{path}.items must be an array")
        else:
            for index, item in enumerate(items):
                errors.extend(validate_normalized_type(item, f"{path}.items[{index}]"))
    elif kind == "function":
        params = type_info.get("params")
        if not isinstance(params, list):
            errors.append(f"{path}.params must be an array")
        else:
            for index, param in enumerate(params):
                errors.extend(validate_parameter(param, f"{path}.params[{index}]"))
        errors.extend(validate_normalized_type(type_info.get("returns"), f"{path}.returns"))
    elif kind == "promise":
        errors.extend(validate_normalized_type(type_info.get("inner"), f"{path}.inner"))
    elif kind == "record":
        errors.extend(validate_normalized_type(type_info.get("key"), f"{path}.key"))
        errors.extend(validate_normalized_type(type_info.get("value"), f"{path}.value"))
    return errors


def python_accessor(parent: str, accessor: str) -> str:
    return ACCESSOR_OVERRIDES.get((parent, accessor), camel_to_snake(accessor))


def root_python_member(parent: str, member: str) -> Optional[str]:
    if member.startswith("[Symbol."):
        return None
    return ROOT_METHOD_OVERRIDES.get((parent, member), camel_to_snake(member))


def is_known_unsupported_api(api_path: str) -> bool:
    return api_path in KNOWN_UNSUPPORTED or any(
        api_path.startswith(prefix + ".") for prefix in UNSUPPORTED_TS_PREFIXES
    )


def is_python_only_unsupported(python_path: str) -> bool:
    return python_path in PYTHON_ONLY_UNSUPPORTED or any(
        python_path.startswith(prefix) for prefix in PYTHON_ONLY_UNSUPPORTED_PREFIXES
    )


def surface_return(meta: dict[str, Any]) -> dict[str, Any]:
    returns = meta.get("returns") or {}
    type_model = returns.get("type") or {"kind": "unknown"}
    async_ts = meta.get("asyncModel") == "promise" or type_model.get("kind") == "promise"
    exposed_type = type_model.get("inner") if type_model.get("kind") == "promise" else type_model
    return {
        "asyncTs": async_ts,
        "type": exposed_type or {"kind": "unknown"},
        "raw": returns.get("typeText") or meta.get("typeScript", {}).get("returnTypeText") or "unknown",
    }


def surface_entry(
    *,
    parent: str,
    member_name: str,
    meta: dict[str, Any],
    python_path: Optional[str],
    member_kind: Optional[str] = None,
) -> SurfaceEntry:
    deprecation = meta.get("deprecation") or {}
    deprecated = meta.get("visibility") == "deprecated" or bool(deprecation.get("deprecated"))
    return SurfaceEntry(
        api_path=meta.get("canonicalPath") or f"{parent}.{member_name}",
        stable_id=meta.get("stableId") or f"{meta.get('interface', 'Unknown')}.{member_name}",
        interface=meta.get("targetInterface") if meta.get("kind") == "subApiAccessor" else meta.get("interface", ""),
        member_name=meta.get("method") or member_name,
        member_kind=member_kind or ("accessor" if meta.get("kind") == "subApiAccessor" else meta.get("kind", "method")),
        parent=parent,
        signature=meta.get("signature", ""),
        docstring=meta.get("docstring", ""),
        used_types=list(meta.get("usedTypes", [])),
        python_path=python_path,
        parameters=list(meta.get("parameters") or []),
        return_type=surface_return(meta),
        visibility=str(meta.get("visibility") or ("deprecated" if deprecated else "public")),
        deprecated=deprecated,
    )


def build_ts_surface(spec: dict[str, Any]) -> list[SurfaceEntry]:
    entries: list[SurfaceEntry] = []
    root_interfaces = {"wb": "Workbook", "ws": "Worksheet"}
    for parent, interface in root_interfaces.items():
        functions = spec["interfaces"][interface]["functions"]
        for member, meta in functions.items():
            py_member = root_python_member(parent, member)
            py_path = f"{parent}.{py_member}" if py_member else None
            entries.append(surface_entry(parent=parent, member_name=member, meta=meta, python_path=py_path))

    interface_queue: list[tuple[str, str, str, str]] = []
    for parent, root in (("wb", "workbook"), ("ws", "worksheet")):
        accessors = spec.get("subApis", {}).get(root, {})
        for accessor, meta in accessors.items():
            interface = meta.get("targetInterface")
            py_accessor = python_accessor(parent, accessor)
            accessor_api = meta.get("canonicalPath") or f"{parent}.{accessor}"
            accessor_py = f"{parent}.{py_accessor}"
            entries.append(
                surface_entry(
                    parent=parent,
                    member_name=accessor,
                    meta=meta,
                    python_path=accessor_py,
                    member_kind="accessor",
                )
            )
            if isinstance(interface, str):
                interface_queue.append((interface, accessor_api, accessor_py, parent))

    processed: set[tuple[str, str]] = set()
    for interface, api_prefix, py_prefix, parent in interface_queue:
        key = (interface, api_prefix)
        if key in processed:
            continue
        processed.add(key)
        functions = spec["interfaces"].get(interface, {}).get("functions", {})
        for member, meta in functions.items():
            py_member = camel_to_snake(member)
            py_path = f"{py_prefix}.{py_member}"
            api_path = meta.get("canonicalPath") or f"{api_prefix}.{member}"
            if api_path in KNOWN_UNSUPPORTED:
                py_path = KNOWN_UNSUPPORTED[api_path]
            entries.append(surface_entry(parent=parent, member_name=member, meta=meta, python_path=py_path))
            target = meta.get("targetInterface")
            if meta.get("kind") == "property" and isinstance(target, str):
                interface_queue.append((target, api_path, py_path, parent))
    return entries


def class_public_members(path: Path, class_name: str) -> set[str]:
    tree = ast.parse(path.read_text())
    members: set[str] = set()
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == class_name:
            for item in node.body:
                if isinstance(item, ast.FunctionDef) and not item.name.startswith("_"):
                    members.add(item.name)
    return members


def runtime_python_paths() -> set[str]:
    paths: set[str] = set()
    workbook_members = class_public_members(PY_MOG / "workbook.py", "Workbook")
    worksheet_members = class_public_members(PY_MOG / "worksheet.py", "Worksheet")
    paths |= {f"wb.{name}" for name in workbook_members}
    paths |= {f"ws.{name}" for name in worksheet_members}

    subapi_classes = {
        "wb.history": (PY_MOG / "sub_apis" / "history.py", "HistoryAPI"),
        "wb.sheets": (PY_MOG / "sub_apis" / "sheets.py", "SheetsAPI"),
        "wb.names": (PY_MOG / "sub_apis" / "names.py", "NamesAPI"),
        "wb.notifications": (PY_MOG / "workbook.py", "_NotificationsAPI"),
        "wb.protection": (PY_MOG / "workbook.py", "_ProtectionAPI"),
        "wb.settings": (PY_MOG / "sub_apis" / "settings.py", "SettingsAPI"),
        "wb.security": (PY_MOG / "sub_apis" / "security.py", "SecurityAPI"),
        "wb.styles": (PY_MOG / "workbook.py", "_StylesAPI"),
        "wb.theme": (PY_MOG / "workbook.py", "_ThemeUnsupported"),
        "wb.bindings": (PY_MOG / "workbook.py", "_BindingsUnsupported"),
        "ws.formats": (PY_MOG / "sub_apis" / "formats.py", "FormatsAPI"),
        "ws.structure": (PY_MOG / "sub_apis" / "structure.py", "StructureAPI"),
        "ws.layout": (PY_MOG / "sub_apis" / "layout.py", "LayoutAPI"),
        "ws.tables": (PY_MOG / "sub_apis" / "tables.py", "TablesAPI"),
        "ws.charts": (PY_MOG / "sub_apis" / "charts.py", "ChartsAPI"),
        "ws.filters": (PY_MOG / "sub_apis" / "filters.py", "FiltersAPI"),
        "ws.comments": (PY_MOG / "sub_apis" / "comments.py", "CommentsAPI"),
        "ws.conditional_formats": (PY_MOG / "sub_apis" / "conditional_formats.py", "ConditionalFormatsAPI"),
        "ws.outline": (PY_MOG / "sub_apis" / "outline.py", "OutlineAPI"),
        "ws.view": (PY_MOG / "sub_apis" / "view.py", "ViewAPI"),
        "ws.protection": (PY_MOG / "sub_apis" / "protection.py", "ProtectionAPI"),
        "ws.pivots": (PY_MOG / "sub_apis" / "pivots.py", "PivotsAPI"),
        "ws.print_": (PY_MOG / "sub_apis" / "print_.py", "PrintAPI"),
        "ws.sparklines": (PY_MOG / "sub_apis" / "sparklines.py", "SparklinesAPI"),
        "ws.objects": (PY_MOG / "sub_apis" / "objects.py", "ObjectsAPI"),
        "ws.shapes": (PY_MOG / "sub_apis" / "objects.py", "ObjectsAPI"),
        "ws.slicers": (PY_MOG / "sub_apis" / "slicers.py", "SlicersAPI"),
        "ws.hyperlinks": (PY_MOG / "sub_apis" / "hyperlinks.py", "HyperlinksAPI"),
        "ws.validation": (PY_MOG / "sub_apis" / "validation.py", "ValidationAPI"),
        "ws.settings": (PY_MOG / "worksheet.py", "_SheetSettingsUnsupported"),
        "ws.data_table": (PY_MOG / "worksheet.py", "_DataTableUnsupported"),
        "ws.scenarios": (PY_MOG / "worksheet.py", "_ScenariosUnsupported"),
        "ws.pictures": (PY_MOG / "worksheet.py", "_PicturesUnsupported"),
        "ws.form_controls": (PY_MOG / "worksheet.py", "_FormControlsUnsupported"),
        "ws.text_boxes": (PY_MOG / "worksheet.py", "_TextBoxesUnsupported"),
        "ws.names": (PY_MOG / "worksheet.py", "_SheetScopedNamesAPI"),
    }
    for prefix, (path, class_name) in subapi_classes.items():
        if path.exists():
            paths |= {f"{prefix}.{name}" for name in class_public_members(path, class_name)}
    return paths


def owner_module_for(python_path: Optional[str]) -> str:
    if not python_path:
        return "mog"
    parts = python_path.split(".")
    if python_path.startswith("wb."):
        if len(parts) >= 3 and parts[1] in {"history", "sheets", "names", "settings", "security"}:
            return "mog.sub_apis." + parts[1]
        return "mog.workbook"
    if python_path.startswith("ws."):
        if len(parts) >= 3:
            sub = parts[1]
            return SUBAPI_OWNER_OVERRIDES.get(sub, "mog.sub_apis." + sub)
        return "mog.worksheet"
    return "mog"


def python_name_for_path(python_path: Optional[str]) -> Optional[str]:
    if not python_path:
        return None
    return python_path.split(".")[-1]


def name_transform_for(entry: SurfaceEntry, python_path: Optional[str], status: str) -> str:
    if not python_path:
        return "none"
    if status == "python_only":
        return "none"
    python_name = python_name_for_path(python_path)
    if python_name == entry.member_name:
        return "none"
    if python_name == camel_to_snake(entry.member_name):
        return "snake_case"
    return "manual"


def owner_module_exists(owner_module: str) -> bool:
    if owner_module == "mog":
        return True
    if not owner_module.startswith("mog."):
        return False
    relative = owner_module.removeprefix("mog.").split(".")
    if len(relative) == 1:
        return (PY_MOG / f"{relative[0]}.py").exists()
    if len(relative) == 2 and relative[0] == "sub_apis":
        return (PY_MOG / "sub_apis" / f"{relative[1]}.py").exists()
    return False


def load_dispositions() -> list[dict[str, Any]]:
    raw = json.loads(DISPOSITIONS_PATH.read_text())
    if isinstance(raw, dict):
        return list(raw.get("dispositions", []))
    if isinstance(raw, list):
        return raw
    raise SystemExit(f"{DISPOSITIONS_PATH} must be a JSON object or array")


def initial_dispositions(entries: list[SurfaceEntry], runtime_paths: set[str]) -> list[dict[str, Any]]:
    dispositions: list[dict[str, Any]] = []
    child_api_prefixes = {
        entry.api_path.rsplit(".", 1)[0]
        for entry in entries
        if "." in entry.api_path
    }
    for entry in entries:
        status: str
        reason: Optional[str] = None
        python_path = entry.python_path
        if entry.deprecated or entry.visibility == "deprecated":
            status = "unsupported" if python_path in runtime_paths else "omitted"
            reason = "deprecated_ts_api"
            if status == "omitted":
                python_path = None
        elif is_known_unsupported_api(entry.api_path) and entry.api_path in child_api_prefixes:
            status = "implemented" if python_path == entry.api_path else "renamed"
        elif is_known_unsupported_api(entry.api_path):
            status = "unsupported"
            reason = "release_deferred"
            python_path = KNOWN_UNSUPPORTED.get(entry.api_path, python_path)
        elif entry.member_name.startswith("[Symbol."):
            status = "out_of_scope"
            reason = "typescript_only"
            python_path = None
        elif python_path in runtime_paths:
            status = "implemented" if python_path == entry.api_path else "renamed"
        elif entry.member_kind == "accessor":
            status = "omitted"
            reason = "release_deferred"
            python_path = None
        else:
            status = "omitted"
            reason = "release_deferred"
            python_path = None
        dispositions.append(make_disposition(entry, status, reason, python_path))

    ts_python_paths = {d.get("pythonPath") for d in dispositions if d.get("pythonPath")}
    for python_path in sorted(runtime_paths - ts_python_paths):
        status = "python_only"
        reason = None
        if is_python_only_unsupported(python_path):
            reason = "release_deferred"
        dispositions.append(
            {
                "apiPath": f"py.{python_path}",
                "stableId": f"PythonOnly.{python_path}",
                "interface": "PythonOnly",
                "pythonPath": python_path,
                "pythonName": python_name_for_path(python_path),
                "targetPath": python_path,
                "aliasOf": None,
                "status": status,
                "reason": reason,
                "ownerPackage": "compute/pyo3",
                "ownerModule": owner_module_for(python_path),
                "aliases": [],
                "nameTransform": "none",
                "syncModel": "sync",
                "unsupportedUntil": "round-2" if reason == "release_deferred" else None,
                "notes": "Public Python convenience API with no TypeScript SDK counterpart.",
            }
        )
    return sorted(dispositions, key=lambda item: item["apiPath"])


def make_disposition(
    entry: SurfaceEntry,
    status: str,
    reason: Optional[str],
    python_path: Optional[str],
) -> dict[str, Any]:
    return {
        "apiPath": entry.api_path,
        "stableId": entry.stable_id,
        "interface": entry.interface,
        "pythonPath": python_path,
        "pythonName": python_name_for_path(python_path),
        "targetPath": python_path,
        "aliasOf": entry.api_path if status == "renamed" else None,
        "status": status,
        "reason": reason,
        "ownerPackage": "compute/pyo3",
        "ownerModule": owner_module_for(python_path),
        "aliases": [entry.api_path] if status == "renamed" else [],
        "nameTransform": name_transform_for(entry, python_path, status),
        "syncModel": "sync-wrapper-for-async-ts" if entry.return_type.get("asyncTs") else "sync",
        "unsupportedUntil": "round-2" if reason == "release_deferred" else ("never" if reason == "deprecated_ts_api" else None),
        "notes": "Deprecated TypeScript API; Python parity does not expose it as implemented." if reason == "deprecated_ts_api" else None,
    }


def validate_dispositions(
    entries: list[SurfaceEntry],
    dispositions: list[dict[str, Any]],
    runtime_paths: set[str],
) -> list[str]:
    errors: list[str] = []
    by_api = {d.get("apiPath"): d for d in dispositions}
    expected = {entry.api_path for entry in entries}
    missing = sorted(expected - set(by_api))
    extra_ts = sorted(
        api_path for api_path in by_api if isinstance(api_path, str) and not api_path.startswith("py.") and api_path not in expected
    )
    if missing:
        errors.append(f"Missing disposition entries: {len(missing)}; first={missing[:10]}")
    if extra_ts:
        errors.append(f"Unknown TypeScript disposition entries: {len(extra_ts)}; first={extra_ts[:10]}")
    documented_runtime = {
        d.get("pythonPath")
        for d in dispositions
        if d.get("status") in {"implemented", "renamed", "unsupported", "python_only"}
        and d.get("pythonPath")
    }
    undocumented_runtime = sorted(runtime_paths - documented_runtime)
    if undocumented_runtime:
        errors.append(
            "Undocumented runtime Python paths: "
            f"{len(undocumented_runtime)}; first={undocumented_runtime[:10]}"
        )
    concrete_runtime = {
        d.get("pythonPath")
        for d in dispositions
        if d.get("status") in {"implemented", "renamed", "python_only"}
        and d.get("pythonPath")
    }
    documented_missing_runtime = sorted(concrete_runtime - runtime_paths)
    if documented_missing_runtime:
        errors.append(
            "Documented Python paths not present at runtime: "
            f"{len(documented_missing_runtime)}; first={documented_missing_runtime[:10]}"
        )
    missing_runtime = sorted(
        d.get("pythonPath")
        for d in dispositions
        if isinstance(d.get("apiPath"), str)
        and str(d.get("apiPath")).startswith("py.")
        and isinstance(d.get("pythonPath"), str)
        and d.get("pythonPath") not in runtime_paths
    )
    if missing_runtime:
        errors.append(
            "Python-only dispositions without runtime methods: "
            f"{len(missing_runtime)}; first={missing_runtime[:10]}"
        )
    seen: set[str] = set()
    for index, item in enumerate(dispositions):
        api_path = item.get("apiPath")
        if not isinstance(api_path, str) or not api_path:
            errors.append(f"Entry {index} missing apiPath")
            continue
        if api_path in seen:
            errors.append(f"Duplicate apiPath {api_path}")
        seen.add(api_path)
        status = item.get("status")
        reason = item.get("reason")
        python_path = item.get("pythonPath")
        if status not in VALID_STATUS:
            errors.append(f"{api_path}: invalid status {status!r}")
        if reason is not None and reason not in VALID_REASONS:
            errors.append(f"{api_path}: invalid reason {reason!r}")
        if status in {"implemented", "renamed", "unsupported"} and not python_path:
            errors.append(f"{api_path}: {status} requires pythonPath")
        if status in {"implemented", "renamed", "unsupported", "python_only"}:
            if not item.get("pythonName"):
                errors.append(f"{api_path}: {status} requires pythonName")
            if not item.get("targetPath"):
                errors.append(f"{api_path}: {status} requires targetPath")
        if status in {"omitted", "out_of_scope"} and python_path:
            errors.append(f"{api_path}: {status} must not carry pythonPath")
        if status in {"omitted", "out_of_scope"} and (item.get("pythonName") or item.get("targetPath")):
            errors.append(f"{api_path}: {status} must not carry pythonName/targetPath")
        if status in {"unsupported", "omitted", "out_of_scope"} and not reason:
            errors.append(f"{api_path}: {status} requires reason")
        if status in {"implemented", "renamed"} and reason is not None:
            errors.append(f"{api_path}: {status} must not carry reason")
        if status == "renamed" and item.get("aliasOf") != api_path:
            errors.append(f"{api_path}: renamed entries must set aliasOf to apiPath")
        if status != "renamed" and item.get("aliasOf") is not None:
            errors.append(f"{api_path}: only renamed entries may carry aliasOf")
        if item.get("nameTransform") not in {"snake_case", "camelCaseAlias", "manual", "none"}:
            errors.append(f"{api_path}: invalid nameTransform {item.get('nameTransform')!r}")
        if item.get("ownerPackage") != "compute/pyo3":
            errors.append(f"{api_path}: ownerPackage must be compute/pyo3")
        owner_module = item.get("ownerModule")
        if not isinstance(owner_module, str) or not owner_module_exists(owner_module):
            errors.append(f"{api_path}: ownerModule does not resolve to a public Python module: {owner_module!r}")
    return errors


def build_surface_payload(spec: dict[str, Any], entries: list[SurfaceEntry], dispositions: list[dict[str, Any]]) -> dict[str, Any]:
    counts = {
        "interfaces": len(spec.get("interfaces", {})),
        "functions": sum(len(v.get("functions", {})) for v in spec.get("interfaces", {}).values()),
        "workbookSubApis": len(spec.get("subApis", {}).get("workbook", {})),
        "worksheetSubApis": len(spec.get("subApis", {}).get("worksheet", {})),
        "dispositions": len(dispositions),
    }
    status_counts: dict[str, int] = {}
    for item in dispositions:
        status_counts[item["status"]] = status_counts.get(item["status"], 0) + 1
    return {
        "schemaVersion": 1,
        "source": {
            "apiSpec": str(SPEC_PATH.relative_to(ROOT)),
        },
        "counts": counts,
        "statusCounts": dict(sorted(status_counts.items())),
        "apiPaths": [entry.__dict__ for entry in entries],
        "dispositions": dispositions,
    }


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def surface_py_text(payload: dict[str, Any]) -> str:
    return (
        '"""Generated API surface metadata for the Mog Python SDK."""\n'
        "from __future__ import annotations\n\n"
        "API_SURFACE = "
        + repr(payload)
        + "\n"
    )


def pyi_type(type_info: dict[str, Any]) -> str:
    kind = type_info.get("kind")
    if kind == "promise":
        return pyi_type(type_info.get("inner") or {"kind": "unknown"})
    if kind == "primitive":
        text = type_info.get("name") or "Any"
    elif kind == "objectRef":
        text = type_info.get("name") or "Any"
    elif kind == "array":
        return "list[Any]"
    elif kind in {"union", "intersection", "record", "tuple", "function", "unknown"}:
        return "Any"
    elif kind == "void":
        return "None"
    elif kind == "literal":
        value = type_info.get("value")
        if value is None:
            return "None"
        if isinstance(value, bool):
            return "bool"
        if isinstance(value, (int, float)):
            return "float"
        return "str"
    else:
        text = type_info.get("text") or type_info.get("raw") or "Any"

    if text in {"string", "String"}:
        return "str"
    if text in {"number", "Number"}:
        return "float"
    if text in {"boolean", "Boolean"}:
        return "bool"
    if text in {"void", "undefined"}:
        return "None"
    if text.endswith("[]"):
        return "list[Any]"
    if "|" in text or text.startswith("{") or "<" in text:
        return "Any"
    return "Any"


def generate_stub_files(payload: dict[str, Any]) -> dict[Path, str]:
    root_lines = [
        "from typing import Any, Optional",
        "from mog.workbook import Workbook",
        "from mog.worksheet import Worksheet",
        "from mog.errors import AddressError, ComputeError, MogError, NativeApiError, UnsupportedApiError",
        "",
        "def create_workbook(principal: Optional[list[str]] = None) -> Workbook: ...",
        "def open_workbook(path: str, principal: Optional[list[str]] = None) -> Workbook: ...",
    ]
    workbook_lines = ["from typing import Any, Optional", "", "class Workbook:"]
    worksheet_lines = ["from typing import Any, Optional", "", "class Worksheet:"]

    for entry in payload["apiPaths"]:
        disp = next((d for d in payload["dispositions"] if d["apiPath"] == entry["api_path"]), None)
        if not disp or disp.get("status") not in {"implemented", "renamed"}:
            continue
        python_path = disp.get("pythonPath")
        if not python_path:
            continue
        parts = python_path.split(".")
        if len(parts) != 2 or parts[0] not in {"wb", "ws"}:
            continue
        name = parts[1]
        if entry["member_kind"] == "accessor":
            line = f"    @property\n    def {name}(self) -> Any: ..."
        elif entry["member_kind"] == "property":
            line = f"    {name}: Any"
        else:
            params = ["self"]
            for param in entry.get("parameters", []):
                param_name = param.get("name") or "arg"
                if not param_name.isidentifier():
                    param_name = "arg"
                default = " = ..." if param.get("optional") or param.get("default") is not None else ""
                params.append(f"{param_name}: Any{default}")
            return_type = pyi_type(entry.get("return_type", {}).get("type", {}))
            line = f"    def {name}({', '.join(params)}) -> {return_type}: ..."
        if parts[0] == "wb":
            workbook_lines.append(line)
        else:
            worksheet_lines.append(line)

    if len(workbook_lines) == 3:
        workbook_lines.append("    pass")
    if len(worksheet_lines) == 3:
        worksheet_lines.append("    pass")

    errors_lines = [
        "from typing import Optional",
        "",
        "class MogError(Exception): ...",
        "class ComputeError(MogError): ...",
        "class NativeApiError(ComputeError): ...",
        "class AddressError(MogError): ...",
        "class SheetNotFoundError(MogError): ...",
        "class EngineShutdownError(MogError): ...",
        "class UnsupportedApiError(MogError):",
        "    api_path: str",
        "    python_path: str",
        "    reason_code: str",
        "    owner_package: str",
        "    replacement: Optional[str]",
        "    docs_key: Optional[str]",
        "    def to_dict(self) -> dict[str, Optional[str]]: ...",
    ]

    return {
        PY_MOG / "__init__.pyi": "\n".join(root_lines) + "\n",
        PY_MOG / "workbook.pyi": "\n".join(workbook_lines) + "\n",
        PY_MOG / "worksheet.pyi": "\n".join(worksheet_lines) + "\n",
        PY_MOG / "errors.pyi": "\n".join(errors_lines) + "\n",
    }


def check_or_write(path: Path, content: str, write: bool, errors: list[str]) -> None:
    if write:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    else:
        if not path.exists():
            errors.append(f"Missing generated file {path.relative_to(ROOT)}")
        elif path.read_text() != content:
            errors.append(f"Generated file is stale: {path.relative_to(ROOT)}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if generated files are stale")
    parser.add_argument("--write", action="store_true", help="write generated files")
    parser.add_argument("--write-dispositions", action="store_true", help="write an initial explicit disposition manifest")
    args = parser.parse_args()

    if args.check and args.write:
        parser.error("--check and --write are mutually exclusive")

    spec = load_spec()
    entries = build_ts_surface(spec)
    runtime_paths = runtime_python_paths()

    if args.write_dispositions:
        write_json(
            DISPOSITIONS_PATH,
            {
                "$schema": "./api_dispositions.schema.json",
                "schemaVersion": 1,
                "dispositions": initial_dispositions(entries, runtime_paths),
            },
        )
    elif not DISPOSITIONS_PATH.exists():
        raise SystemExit(
            f"{DISPOSITIONS_PATH.relative_to(ROOT)} is missing. "
            "Run with --write-dispositions only when intentionally creating reviewed dispositions."
        )

    dispositions = load_dispositions()
    validation_errors = validate_dispositions(entries, dispositions, runtime_paths)
    if validation_errors:
        for error in validation_errors:
            print(error, file=sys.stderr)
        return 1

    payload = build_surface_payload(spec, entries, dispositions)
    errors: list[str] = []
    if args.write:
        write_json(SURFACE_JSON_PATH, payload)
        SURFACE_PY_PATH.write_text(surface_py_text(payload))
        PY_TYPED_PATH.write_text("")
        for path, content in generate_stub_files(payload).items():
            path.write_text(content)
    else:
        expected_json = json.dumps(payload, indent=2, sort_keys=True) + "\n"
        check_or_write(SURFACE_JSON_PATH, expected_json, False, errors)
        check_or_write(SURFACE_PY_PATH, surface_py_text(payload), False, errors)
        check_or_write(PY_TYPED_PATH, "", False, errors)
        for path, content in generate_stub_files(payload).items():
            check_or_write(path, content, False, errors)

    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, "counts": payload["counts"], "statusCounts": payload["statusCounts"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

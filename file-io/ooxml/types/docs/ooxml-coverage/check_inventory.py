#!/usr/bin/env python3
"""Check the ooxml-types coverage manifest against local schema inventories.

The ECMA schemas are optional in public checkouts. When absent, this script
still validates manifest shape, categories, and owner paths, then exits
successfully with a clear skip message for schema declaration inventory.
"""

from __future__ import annotations

import argparse
import os
import json
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path


DECLARATION_TAGS = {
    "complexType",
    "simpleType",
    "element",
    "group",
    "attributeGroup",
}


def local_name(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[1]
    return tag


def load_manifest(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        manifest = json.load(handle)
    if not isinstance(manifest.get("rows"), list):
        raise ValueError("manifest must contain a rows array")
    if not isinstance(manifest.get("allowed_categories"), list):
        raise ValueError("manifest must contain an allowed_categories array")
    return manifest


def validate_manifest(manifest: dict, repo_root: Path) -> list[str]:
    allowed = set(manifest["allowed_categories"])
    errors: list[str] = []
    required = {
        "schema_module",
        "dialect",
        "feature",
        "category",
        "owner",
        "parser_writer",
        "bridge_visibility",
        "notes",
    }

    for index, row in enumerate(manifest["rows"]):
        missing = required - set(row)
        if missing:
            errors.append(f"row {index} missing required fields: {sorted(missing)}")
            continue
        if row["category"] not in allowed:
            errors.append(f"row {index} uses unknown category {row['category']!r}")
        owner = row["owner"]
        if owner and not owner.startswith("file-io/xlsx/parser/src/domain"):
            if not owner.startswith("file-io/xlsx/parser/src/"):
                errors.append(f"row {index} owner is outside parser ownership: {owner}")
        first_owner = owner.split(" and ", 1)[0]
        first_owner = first_owner.split(" ", 1)[0]
        if first_owner.startswith("file-io/") and not (repo_root / first_owner).exists():
            errors.append(f"row {index} owner path does not exist: {first_owner}")
    return errors


def inventory_schema(path: Path) -> Counter[str]:
    tree = ET.parse(path)
    root = tree.getroot()
    counts: Counter[str] = Counter()
    for child in list(root):
        name = local_name(child.tag)
        if name in DECLARATION_TAGS and child.get("name"):
            counts[name] += 1
    return counts


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path(__file__).with_name("manifest.json"),
    )
    parser.add_argument(
        "--schema-root",
        type=Path,
        default=Path(os.environ.get("OOXML_STRICT_SCHEMA_ROOT", "schemas/strict")),
        help="Directory containing ECMA Strict XSD files.",
    )
    parser.add_argument(
        "--transitional-schema-root",
        type=Path,
        default=Path(os.environ.get("OOXML_TRANSITIONAL_SCHEMA_ROOT", "schemas/transitional")),
        help="Directory containing ECMA Transitional XSD files.",
    )
    args = parser.parse_args()

    repo_root = args.manifest.resolve().parents[4]
    schema_root = args.schema_root
    transitional_schema_root = args.transitional_schema_root
    if not schema_root.is_absolute():
        schema_root = args.manifest.resolve().parent / schema_root
    if not transitional_schema_root.is_absolute():
        transitional_schema_root = args.manifest.resolve().parent / transitional_schema_root
    manifest = load_manifest(args.manifest)
    errors = validate_manifest(manifest, repo_root)
    if errors:
        for error in errors:
            print(f"manifest error: {error}", file=sys.stderr)
        return 1

    schema_names = {
        row["schema_module"]
        for row in manifest["rows"]
        if row["schema_module"].endswith(".xsd")
    }
    schema_dirs = [schema_root, transitional_schema_root]
    found: dict[str, Path] = {}
    for schema_dir in schema_dirs:
        for name in schema_names:
            candidate = schema_dir / name
            if candidate.exists():
                found[name] = candidate

    if not found:
        print("ECMA schema files not found; manifest shape and owner paths validated.")
        return 0

    coverage_by_schema: defaultdict[str, set[str]] = defaultdict(set)
    for row in manifest["rows"]:
        coverage_by_schema[row["schema_module"]].add(row["category"])

    for name in sorted(found):
        counts = inventory_schema(found[name])
        categories = ", ".join(sorted(coverage_by_schema[name]))
        declaration_summary = ", ".join(f"{kind}={count}" for kind, count in sorted(counts.items()))
        print(f"{name}: {declaration_summary or 'no named top-level declarations'}; categories: {categories}")

    missing_rows = sorted(schema_names - set(found))
    if missing_rows:
        print(f"schemas not present, skipped inventory: {', '.join(missing_rows)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

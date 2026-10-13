#!/usr/bin/env python3
"""Use Calipers' numeric-band option plus an exact integer/formula contract.

Only roundtrip/formula_stress_test Math!B47 is covered. Goldens and the
submodule stay unchanged. All other semantic comparisons remain Calipers'.
"""
import argparse
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

CASE = "roundtrip/formula_stress_test"
CELL = "Math!B47"
FORMULA = "RANDBETWEEN(D1,E2)"
MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG = "http://schemas.openxmlformats.org/package/2006/relationships"


def one(items, description):
    if len(items) != 1:
        raise ValueError(f"expected exactly one {description}, got {len(items)}")
    return items[0]


def check_contract(path):
    """Check stored formula, operand values/types and integral result, fail closed."""
    with zipfile.ZipFile(path) as book:
        names = book.namelist()
        if len(names) != len(set(names)):
            raise ValueError("duplicate XLSX package entries")
        workbook = ET.fromstring(book.read("xl/workbook.xml"))
        sheet = one([s for s in workbook.findall(f"{{{MAIN}}}sheets/{{{MAIN}}}sheet")
                     if s.get("name") == "Math"], "Math worksheet")
        rels = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
        rel = one([r for r in rels.findall(f"{{{PKG}}}Relationship")
                   if r.get("Id") == sheet.get(f"{{{REL}}}id")], "worksheet relationship")
        if rel.get("TargetMode") == "External" or rel.get("Type") != REL + "/worksheet":
            raise ValueError("invalid Math worksheet relationship")
        target = rel.get("Target", "")
        part = PurePosixPath(target.lstrip("/")) if target.startswith("/") else PurePosixPath("xl") / target
        if ".." in part.parts or "\\" in target:
            raise ValueError("unsafe worksheet part")
        root = ET.fromstring(book.read(str(part)))
        cells = root.findall(f"{{{MAIN}}}sheetData/{{{MAIN}}}row/{{{MAIN}}}c")
        values = {}
        for address in ("B47", "D1", "E2"):
            cell = one([c for c in cells if c.get("r") == address], address)
            if cell.get("t", "n") != "n":
                raise ValueError(f"{address} must have numeric type")
            value = one(cell.findall(f"{{{MAIN}}}v"), address + " cached value")
            try:
                number = Decimal(value.text or "")
            except InvalidOperation as error:
                raise ValueError(f"{address} has an invalid numeric cache") from error
            if not number.is_finite():
                raise ValueError(f"{address} must be finite")
            formulas = cell.findall(f"{{{MAIN}}}f")
            if address == "B47":
                formula = one(formulas, "B47 formula")
                if formula.text != FORMULA or formula.get("t") or formula.get("ref"):
                    raise ValueError("B47 formula must be exactly " + FORMULA)
            elif formulas:
                raise ValueError(f"{address} must remain a literal bound")
            values[address] = number
        if values["D1"] != 4 or values["E2"] != 7:
            raise ValueError("RANDBETWEEN bounds must remain D1=4 and E2=7")
        draw = values["B47"]
        if draw != draw.to_integral_value() or not 4 <= draw <= 7:
            raise ValueError("B47 must be a finite integer in [4, 7]")
        return str(draw)


def run(args):
    source = Path(args.cases_dir).resolve()
    ids = [item.strip() for group in args.case for item in group.split(",") if item.strip()]
    if sum(item in (CASE, "formula_stress_test") for item in ids) > 1:
        raise ValueError("select formula_stress_test once: repeated exports would overwrite evidence")
    selected = (args.suite in ("", "roundtrip") and
                (not ids or CASE in ids or "formula_stress_test" in ids) and
                (source / CASE).is_dir())
    destination = Path(args.out_dir).resolve() if args.out_dir else Path(tempfile.mkdtemp(prefix="mog-calipers-outputs-"))
    if destination == source or source in destination.parents or destination in source.parents:
        raise ValueError("output directory must not overlap the source corpus")
    with tempfile.TemporaryDirectory(prefix="mog-calipers-check-") as temporary:
        temporary = Path(temporary)
        corpus = temporary / "cases"
        # Copy rather than link: changing the temporary config cannot touch originals.
        shutil.copytree(source, corpus)
        if selected:
            for name in ("init.xlsx", "golden.xlsx"):
                check_contract(corpus / CASE / name)
            config_path = corpus / CASE / "config.json"
            config = json.loads(config_path.read_text()) if config_path.exists() else {}
            config.setdefault("compare", {}).setdefault("cells", {})[CELL] = {"min": 4, "max": 7}
            config_path.write_text(json.dumps(config, indent=2) + "\n")
        fresh = temporary / "exports"
        command = [args.calipers, "verify", "--engine", args.engine,
                   "--cases-dir", str(corpus), "--out-dir", str(fresh)]
        if args.suite:
            command += ["--suite", args.suite]
        for group in args.case:
            command += ["--case", group]
        if args.recalculate:
            command.append("--recalculate")
        if args.package:
            command.append("--package")
        result = subprocess.run(command, check=False)
        status = result.returncode if result.returncode >= 0 else 128 - result.returncode
        contract_error = None
        # Always validate fresh output, including Calipers exit 0. Existing exports
        # at the requested destination are never accepted as evidence for this run.
        if selected:
            try:
                draw = check_contract(fresh / (CASE + ".xlsx"))
                print(f"random contract: {CASE} {CELL} PASS (integer {draw} in [4, 7])", flush=True)
            except (ValueError, OSError, KeyError, zipfile.BadZipFile, ET.ParseError) as error:
                contract_error = str(error)
        # Keep actual exports for diagnosis even when either check fails.
        if fresh.exists():
            shutil.copytree(fresh, destination, dirs_exist_ok=True)
        print(f"calipers exports: {destination}", flush=True)
        if contract_error:
            print("random contract: FAIL: " + contract_error, file=sys.stderr)
            return status or 1
        return status


class StoreOnce(argparse.Action):
    def __call__(self, parser, namespace, value, option_string=None):
        if getattr(namespace, self.dest, None) is not None:
            parser.error(f"{option_string} is an internal resource and cannot be overridden")
        setattr(namespace, self.dest, value)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--calipers", required=True, action=StoreOnce)
    parser.add_argument("--engine", required=True, action=StoreOnce)
    parser.add_argument("--cases-dir", required=True, action=StoreOnce)
    parser.add_argument("--out-dir")
    parser.add_argument("--suite", default="")
    parser.add_argument("--case", action="append", default=[])
    parser.add_argument("--recalculate", action="store_true")
    parser.add_argument("--package", action="store_true")
    args = parser.parse_args(argv)
    try:
        return run(args)
    except (ValueError, OSError, KeyError, zipfile.BadZipFile, ET.ParseError) as error:
        print("calipers verification: FAIL: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

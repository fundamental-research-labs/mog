#!/usr/bin/env python3
"""Tests for Office.js catalog parsing and verification-script coverage."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import officejs_coverage as cov


RANGE_YAML = """### YamlMime:TSType
name: Excel.Range
uid: excel!Excel.Range:class
type: class
properties:
  - name: values
    remarks: '[API set: ExcelApi 1.1](/x)'
    syntax:
      content: 'values: any[][];'
      return:
        type: any[][]
  - name: context
    syntax:
      content: 'context: RequestContext;'
methods:
  - name: getCell(row, column)
    remarks: '[API set: ExcelApi 1.1](/x)'
    syntax:
      content: 'getCell(row: number, column: number): Excel.Range;'
      return:
        type: <xref uid="excel!Excel.Range:class" />
  - name: clear(applyTo)
    remarks: '[API set: ExcelApi 1.1](/x)'
    syntax:
      content: 'clear(applyTo?: string): void;'
  - name: clear(applyTo)
    remarks: '[API set: ExcelApi 1.1](/x)'
    syntax:
      content: 'clear(applyTo?: string): void;'
  - name: toJSON()
    syntax:
      content: 'toJSON(): object;'
"""

WORKSHEET_YAML = """### YamlMime:TSType
name: Excel.Worksheet
uid: excel!Excel.Worksheet:class
type: class
properties:
  - name: tables
    remarks: '[API set: ExcelApi 1.1](/x)'
    syntax:
      content: 'readonly tables: Excel.TableCollection;'
      return:
        type: <xref uid="excel!Excel.TableCollection:class" />
methods:
  - name: getRange(address)
    remarks: '[API set: ExcelApi 1.1](/x)'
    syntax:
      content: 'getRange(address?: string): Excel.Range;'
      return:
        type: <xref uid="excel!Excel.Range:class" />
"""

TABLE_COLL_YAML = """### YamlMime:TSType
name: Excel.TableCollection
uid: excel!Excel.TableCollection:class
type: class
methods:
  - name: add(address, hasHeaders)
    remarks: '[API set: ExcelApi 1.1](/x)'
    syntax:
      content: 'add(address: string, hasHeaders: boolean): Excel.Table;'
      return:
        type: <xref uid="excel!Excel.Table:class" />
"""

WORKBOOK_YAML = """### YamlMime:TSType
name: Excel.Workbook
uid: excel!Excel.Workbook:class
type: class
properties:
  - name: worksheets
    remarks: '[API set: ExcelApi 1.1](/x)'
    syntax:
      content: 'readonly worksheets: Excel.WorksheetCollection;'
"""

WS_COLL_YAML = """### YamlMime:TSType
name: Excel.WorksheetCollection
uid: excel!Excel.WorksheetCollection:class
type: class
methods:
  - name: getActiveWorksheet()
    remarks: '[API set: ExcelApi 1.1](/x)'
    syntax:
      content: 'getActiveWorksheet(): Excel.Worksheet;'
"""

TABLE_ADD_JS = """
await Excel.run(async (context) => {
  const sheet = context.workbook.worksheets.getActiveWorksheet();
  sheet.getRange("A1:C4").values = [
    ["Region", "Product", "Sales"],
  ];
  sheet.tables.add("A1:C4", true);
  sheet.getRange("B1").formulas = [["=SUM(A1:A4)"]];
  await context.sync();
});
"""


class CatalogTests(unittest.TestCase):
    def test_parses_class_and_dedupes_overloads(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "excel.range.yml").write_text(RANGE_YAML)
            (root / "excel.worksheet.yml").write_text(WORKSHEET_YAML)
            (root / "excel.tablecollection.yml").write_text(TABLE_COLL_YAML)
            (root / "excel.workbook.yml").write_text(WORKBOOK_YAML)
            (root / "excel.worksheetcollection.yml").write_text(WS_COLL_YAML)
            catalog = cov.build_catalog(root)
        ids = {c["id"] for c in catalog["classes"]}
        self.assertEqual(
            ids,
            {
                "Excel.Range",
                "Excel.Worksheet",
                "Excel.TableCollection",
                "Excel.Workbook",
                "Excel.WorksheetCollection",
            },
        )
        rng = next(c for c in catalog["classes"] if c["id"] == "Excel.Range")
        names = [m["name"] for m in rng["methods"]]
        self.assertEqual(names, ["clear", "getCell"])
        self.assertNotIn("toJSON", names)
        self.assertNotIn("context", [p["name"] for p in rng["properties"]])
        get_cell = rng["methods"][1] if rng["methods"][1]["name"] == "getCell" else rng["methods"][0]
        get_cell = next(m for m in rng["methods"] if m["name"] == "getCell")
        self.assertEqual(get_cell["returnType"], "Excel.Range")
        self.assertEqual(get_cell["apiSet"], "ExcelApi 1.1")
        values = next(p for p in rng["properties"] if p["name"] == "values")
        self.assertFalse(values["readonly"])


class ScriptScanTests(unittest.TestCase):
    def test_table_add_script_members_and_formula(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "excel.range.yml").write_text(RANGE_YAML)
            (root / "excel.worksheet.yml").write_text(WORKSHEET_YAML)
            (root / "excel.tablecollection.yml").write_text(TABLE_COLL_YAML)
            (root / "excel.workbook.yml").write_text(WORKBOOK_YAML)
            (root / "excel.worksheetcollection.yml").write_text(WS_COLL_YAML)
            catalog = cov.build_catalog(root)
        index = cov.index_catalog(catalog)
        used, formulas = cov.scan_script(TABLE_ADD_JS, index)
        self.assertIn(("Excel", "run", "method"), used)
        self.assertIn(("Excel.WorksheetCollection", "getActiveWorksheet", "method"), used)
        self.assertIn(("Excel.Worksheet", "getRange", "method"), used)
        self.assertIn(("Excel.Range", "values", "property"), used)
        self.assertIn(("Excel.TableCollection", "add", "method"), used)
        self.assertIn(("Excel.RequestContext", "sync", "method"), used)
        self.assertEqual(formulas, {"SUM"})

    def test_formula_regex_ignores_js_assignments(self) -> None:
        index = cov.index_catalog({"classes": []})
        _, formulas = cov.scan_script(
            'const sheet = context.workbook.worksheets.getActiveWorksheet();',
            index,
        )
        self.assertEqual(formulas, set())


class HostScanTests(unittest.TestCase):
    def test_prototype_methods_and_freeze_alias(self) -> None:
        js = """
        function Range(context) {
          this._scalarProperties = ["values", "formulas"];
        }
        Range.prototype.clear = function () {};
        Excel.Range = Range;
        function FreezePaneCollection(context) {}
        FreezePaneCollection.prototype.freezeRows = function (count) {};
        Excel.FreezePaneCollection = FreezePaneCollection;
        """
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp)
            (src / "host.js").write_text(js)
            catalog = {
                "classes": [
                    {
                        "id": "Excel.Range",
                        "family": "object-model",
                        "methods": [{"name": "clear", "kind": "method", "returnType": "void"}],
                        "properties": [
                            {"name": "values", "kind": "property", "returnType": "any[][]"},
                            {"name": "formulas", "kind": "property", "returnType": "any[][]"},
                        ],
                        "events": [],
                    },
                    {
                        "id": "Excel.WorksheetFreezePanes",
                        "family": "object-model",
                        "methods": [{"name": "freezeRows", "kind": "method", "returnType": "void"}],
                        "properties": [],
                        "events": [],
                    },
                ]
            }
            implemented = cov.scan_officejs_host(src, catalog)
        self.assertIn(("Excel.Range", "clear"), implemented)
        self.assertIn(("Excel.Range", "values"), implemented)
        self.assertIn(("Excel.WorksheetFreezePanes", "freezeRows"), implemented)


if __name__ == "__main__":
    unittest.main()

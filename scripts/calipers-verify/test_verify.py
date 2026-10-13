"""Run with CALIPERS_BIN set to also test the real pinned semantic comparator."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile

spec = importlib.util.spec_from_file_location("verify", Path(__file__).with_name("verify.py"))
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


def workbook(path, draw="4", kind=None, formula=verify.FORMULA, lower="4", upper="7",
             other="9", other_formula="1+8", bold=False, missing=False, duplicate=False):
    ns = verify.MAIN
    root = ET.Element("worksheet", xmlns=ns)
    data = ET.SubElement(root, "sheetData")
    row = ET.SubElement(data, "row", r="1")
    def cell(address, value, f=None, t=None):
        attrs = {"r": address}
        if t is not None:
            attrs["t"] = t
        c = ET.SubElement(row, "c", attrs)
        if f is not None:
            ET.SubElement(c, "f").text = f
        ET.SubElement(c, "v").text = value
    cell("D1", lower)
    cell("E2", upper)
    cell("C1", other, other_formula)
    if not missing:
        cell("B47", draw, formula, kind)
    if duplicate:
        cell("B47", draw, formula, kind)
    with zipfile.ZipFile(path, "w") as out:
        out.writestr("xl/workbook.xml", f'<workbook xmlns="{ns}" xmlns:r="{verify.REL}"><sheets><sheet name="Math" sheetId="1" r:id="rId1"/></sheets></workbook>')
        out.writestr("xl/_rels/workbook.xml.rels", f'<Relationships xmlns="{verify.PKG}"><Relationship Id="rId1" Type="{verify.REL}/worksheet" Target="worksheets/not-sheet1.xml"/></Relationships>')
        out.writestr("xl/worksheets/not-sheet1.xml", ET.tostring(root))
        out.writestr("xl/styles.xml", f'<styleSheet xmlns="{ns}"><fonts count="1"><font><name val="Calibri"/><sz val="11"/>{"<b/>" if bold else ""}</font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>')


class FixtureCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.corpus = self.root / "corpus"
        self.case = self.corpus / verify.CASE
        self.case.mkdir(parents=True)
        workbook(self.case / "init.xlsx")
        workbook(self.case / "golden.xlsx")
        (self.case / "config.json").write_text('{"maxDurationMs": 10000}\n')
        self.output = self.root / "output"
        self.fixture = self.root / "fixture.xlsx"
        workbook(self.fixture, draw="6")
        self.fake = self.root / "calipers"
        self.fake.write_text(f'''#!{sys.executable}
import pathlib,shutil,sys
args=sys.argv[1:]
out=pathlib.Path(args[args.index('--out-dir')+1])/'{verify.CASE}.xlsx'
out.parent.mkdir(parents=True,exist_ok=True)
shutil.copyfile(args[args.index('--engine')+1],out)
''')
        self.fake.chmod(0o755)

    def call(self, *extra, calipers=None, engine=None):
        args = ["--calipers", str(calipers or self.fake), "--engine", str(engine or self.fixture),
                "--cases-dir", str(self.corpus), "--out-dir", str(self.output), *extra]
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return verify.main(args)


class ContractTests(FixtureCase):
    def test_valid_draws_and_relationship_resolution(self):
        for draw in ("4", "5", "6", "7", "6.0", "6e0"):
            with self.subTest(draw=draw):
                workbook(self.fixture, draw=draw)
                self.assertEqual(verify.check_contract(self.fixture), str(verify.Decimal(draw)))

    def test_invalid_random_contract_mutations(self):
        mutations = [dict(draw="4.5"), dict(draw="3"), dict(draw="8"), dict(draw="NaN"),
                     dict(draw="Infinity"), dict(draw=""), dict(kind="str"), dict(kind="e"),
                     dict(kind="b"), dict(formula="RANDBETWEEN(4,7)"), dict(formula="1+3"),
                     dict(lower="3"), dict(upper="8"), dict(missing=True), dict(duplicate=True)]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                workbook(self.fixture, **mutation)
                with self.assertRaises(ValueError):
                    verify.check_contract(self.fixture)

    def test_validation_runs_even_when_calipers_returns_zero(self):
        workbook(self.fixture, draw="4.5")
        self.assertEqual(self.call(), 1)

    def test_source_and_golden_are_validated_before_execution(self):
        for name in ("init.xlsx", "golden.xlsx"):
            with self.subTest(name=name):
                path = self.case / name
                original = path.read_bytes()
                workbook(path, formula="4")
                self.assertEqual(self.call(), 1)
                self.assertFalse(self.output.exists())
                path.write_bytes(original)

    def test_stale_destination_never_satisfies_missing_export(self):
        stale = self.output / (verify.CASE + ".xlsx")
        stale.parent.mkdir(parents=True)
        workbook(stale, draw="6")
        self.fake.write_text(f"#!{sys.executable}\n")
        self.assertEqual(self.call(), 1)
        self.assertTrue(stale.exists())

    def test_nonzero_and_abnormal_status_remain_failures(self):
        self.fake.write_text(self.fake.read_text() + "\nsys.exit(7)\n")
        self.assertEqual(self.call(), 7)

    def test_case_alias_comma_list_and_suite_forwarding(self):
        self.assertEqual(self.call("--suite", "roundtrip", "--case", "formula_stress_test"), 0)
        workbook(self.fixture, draw="4.5")
        self.assertEqual(self.call("--case", "other,roundtrip/formula_stress_test"), 1)

    def test_repeated_random_case_cannot_overwrite_unvalidated_draw(self):
        self.assertEqual(self.call("--case", "formula_stress_test", "--case", verify.CASE), 1)
        self.assertFalse(self.output.exists())

    def test_unselected_case_does_not_require_random_export(self):
        self.fake.write_text(f"#!{sys.executable}\n")
        self.assertEqual(self.call("--suite", "officejs", "--case", "some_case"), 0)

    def test_source_corpus_and_config_are_unchanged(self):
        before = {p.relative_to(self.corpus): p.read_bytes() for p in self.corpus.rglob('*') if p.is_file()}
        self.assertEqual(self.call(), 0)
        after = {p.relative_to(self.corpus): p.read_bytes() for p in self.corpus.rglob('*') if p.is_file()}
        self.assertEqual(before, after)
        self.assertTrue((self.output / (verify.CASE + ".xlsx")).exists())

    def test_internal_resource_overrides_and_abbreviations_are_rejected(self):
        for flag in ("--calipers", "--engine", "--cases-dir"):
            for extra in ((flag, "replacement"), (flag + "=replacement",)):
                with self.subTest(extra=extra), self.assertRaises(SystemExit) as error:
                    self.call(*extra)
                self.assertEqual(error.exception.code, 2)
        with self.assertRaises(SystemExit) as error:
            self.call("--engi=replacement")
        self.assertEqual(error.exception.code, 2)

    def test_output_cannot_overlap_original_corpus(self):
        self.output = self.corpus
        self.assertEqual(self.call(), 1)


@unittest.skipUnless(os.environ.get("CALIPERS_BIN"), "set CALIPERS_BIN for pinned comparator integration")
class RealComparatorTests(FixtureCase):
    # Check actual Calipers semantic gates, not an imitation of the comparator.
    def test_real_comparator_preserves_all_non_random_axes(self):
        engine = self.root / "engine"
        engine.write_text(f'#!{sys.executable}\nimport shutil,sys\nshutil.copyfile({str(self.fixture)!r},sys.argv[-1])\n')
        engine.chmod(0o755)
        binary = Path(os.environ["CALIPERS_BIN"]).resolve()
        cases = [(dict(draw="6"), 0), (dict(draw="4.5"), 1),
                 (dict(other="10"), 1), (dict(other_formula="2+7"), 1),
                 (dict(bold=True), 1), (dict(formula="1+3"), 1)]
        for mutation, expected in cases:
            with self.subTest(mutation=mutation):
                workbook(self.fixture, **mutation)
                result = subprocess.run([sys.executable, str(Path(__file__).with_name("verify.py")),
                                         "--calipers", str(binary), "--engine", str(engine),
                                         "--cases-dir", str(self.corpus), "--case", verify.CASE,
                                         "--out-dir", str(self.output)], capture_output=True, text=True)
                self.assertEqual(result.returncode, expected, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()

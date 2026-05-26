//! Synthetic fixture builders for Class V (pinned-corpus full-recalc
//! regression guard).
//!
//! — Class V.
//!
//! Each fixture is a `Fixture { name, snapshot, oracle }` tuple produced
//! by a pure function. The oracle is a hand-computed list of
//! `(sheet_name, row, col, expected_value)`. The runner constructs a
//! `YrsComputeEngine::from_snapshot`, walks the oracle, and counts
//! matches vs drift.
//!
//! Scope discipline (Class V):
//! - Deterministic seeds, no randomness.
//! - No real XLSX committed. Drift reproducers are synthesized from
//!   FINDINGS.md signatures, not from binary files.
//! - Builders use `snapshot_types` directly; we do NOT share scaffolding
//!   with `tests/support/` because Classes I–IV use a different style
//!   (per-case matrix) and this keeps Class V coordination-free with
//!   the parallel class agents.

#![allow(dead_code)] // Builders export a broad API; not every helper is used by every fixture.

use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

// ---------------------------------------------------------------------------
// Fixture & oracle types
// ---------------------------------------------------------------------------

/// A single oracle entry: a cell whose post-recalc value we know a priori.
#[derive(Debug, Clone)]
pub struct OracleEntry {
    pub sheet_name: &'static str,
    pub row: u32,
    pub col: u32,
    pub expected: CellValue,
    /// Optional label — useful for drift-repro fixtures that tie a cell
    /// back to the FINDINGS.md signature (e.g. "Ib6CYMnT").
    pub label: Option<&'static str>,
}

impl OracleEntry {
    pub fn new(sheet_name: &'static str, row: u32, col: u32, expected: CellValue) -> Self {
        Self {
            sheet_name,
            row,
            col,
            expected,
            label: None,
        }
    }

    pub fn with_label(
        sheet_name: &'static str,
        row: u32,
        col: u32,
        expected: CellValue,
        label: &'static str,
    ) -> Self {
        Self {
            sheet_name,
            row,
            col,
            expected,
            label: Some(label),
        }
    }
}

/// A complete fixture: a workbook + the oracle we check against.
pub struct Fixture {
    pub name: &'static str,
    pub snapshot: WorkbookSnapshot,
    pub oracle: Vec<OracleEntry>,
}

// ---------------------------------------------------------------------------
// Low-level cell / snapshot helpers
// ---------------------------------------------------------------------------

/// Deterministic sheet UUID derived from a sheet index.
fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", u64::from(idx))
}

/// Deterministic cell UUID derived from `(sheet_idx, row, col)`. The
/// sheet index participates so cells on different sheets never collide.
fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

/// Construct a value-only cell.
pub fn vcell(sheet_idx: u32, row: u32, col: u32, value: CellValue) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_idx, row, col),
        row,
        col,
        value,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

/// Construct a numeric value cell.
pub fn ncell(sheet_idx: u32, row: u32, col: u32, n: f64) -> CellData {
    vcell(sheet_idx, row, col, CellValue::Number(FiniteF64::must(n)))
}

/// Construct a text cell.
pub fn tcell(sheet_idx: u32, row: u32, col: u32, s: &str) -> CellData {
    vcell(sheet_idx, row, col, CellValue::Text(s.into()))
}

/// Construct a formula cell with no pre-seeded value. The engine will
/// evaluate it during `from_snapshot`.
pub fn fcell(sheet_idx: u32, row: u32, col: u32, formula: &str) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_idx, row, col),
        row,
        col,
        value: CellValue::Null,
        formula: Some(formula.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

/// Build a workbook snapshot from a list of `(name, rows, cols, cells)`
/// sheet descriptions. The sheet index is used to derive a deterministic
/// UUID so tests can rebuild the snapshot identically on each run.
pub fn build_workbook(sheets: Vec<(&str, u32, u32, Vec<CellData>)>) -> WorkbookSnapshot {
    let sheet_snapshots = sheets
        .into_iter()
        .enumerate()
        .map(|(si, (name, rows, cols, cells))| SheetSnapshot {
            id: sheet_uuid(si as u32),
            name: name.to_string(),
            rows,
            cols,
            cells,
            ranges: vec![],
        })
        .collect();

    WorkbookSnapshot {
        sheets: sheet_snapshots,
        ..Default::default()
    }
}

// ---------------------------------------------------------------------------
// Fixture: agg_heavy — single sheet, SUM/AVERAGE/COUNT patterns
// ---------------------------------------------------------------------------

/// Small single-sheet aggregate-heavy workbook.
///
/// Sheet layout (Sheet1, 50×10):
/// - A1..A20 = 1..20                     (20 numbers, sum=210, avg=10.5)
/// - B1..B10 = 10, 20, 30, ..., 100      (sum=550, avg=55, max=100, min=10)
/// - C1..C5  = 1.5, 2.5, 3.5, 4.5, 5.5   (sum=17.5, avg=3.5)
/// - D1..D5  = "a", "b", 1, 2, ""        (COUNT=2, COUNTA=4)
///
/// Formulas live on col E/F/G and cover the canonical aggregate fan.
pub fn agg_heavy() -> Fixture {
    let mut cells = Vec::new();

    // A1..A20 = 1..20
    for i in 0..20u32 {
        cells.push(ncell(0, i, 0, f64::from(i + 1)));
    }
    // B1..B10 = 10, 20, ..., 100
    for i in 0..10u32 {
        cells.push(ncell(0, i, 1, f64::from((i + 1) * 10)));
    }
    // C1..C5 = 1.5, 2.5, 3.5, 4.5, 5.5
    for i in 0..5u32 {
        cells.push(ncell(0, i, 2, 1.5 + f64::from(i)));
    }
    // D1 = "a", D2 = "b", D3 = 1, D4 = 2, D5 = "" (treated as empty)
    cells.push(tcell(0, 0, 3, "a"));
    cells.push(tcell(0, 1, 3, "b"));
    cells.push(ncell(0, 2, 3, 1.0));
    cells.push(ncell(0, 3, 3, 2.0));
    cells.push(tcell(0, 4, 3, ""));

    // Formulas (col E/F/G, rows 0..10). Each row is independent so one
    // drifting cell doesn't cascade into all the others' oracles.
    let formulas: &[(u32, u32, &str, CellValue)] = &[
        // SUM family
        (0, 4, "SUM(A1:A20)", num(210.0)),
        (1, 4, "SUM(B1:B10)", num(550.0)),
        (2, 4, "SUM(A1:A20, B1:B10)", num(760.0)),
        (3, 4, "SUM(C1:C5)", num(17.5)),
        // AVERAGE family
        (4, 4, "AVERAGE(A1:A20)", num(10.5)),
        (5, 4, "AVERAGE(B1:B10)", num(55.0)),
        (6, 4, "AVERAGE(C1:C5)", num(3.5)),
        // MIN/MAX
        (7, 4, "MIN(A1:A20)", num(1.0)),
        (8, 4, "MAX(A1:A20)", num(20.0)),
        (9, 4, "MIN(B1:B10)", num(10.0)),
        (10, 4, "MAX(B1:B10)", num(100.0)),
        // COUNT family — D3, D4 are numeric → COUNT = 2
        (0, 5, "COUNT(D1:D5)", num(2.0)),
        // COUNTA on D1..D5 → non-empty. D5 is an empty-string text cell.
        // "" is rendered as text content, so COUNTA counts it: D1="a", D2="b",
        // D3=1, D4=2, D5="" → 5. If parse collapses "" to null in the mirror,
        // we'd see 4. The canonical Excel oracle is 5.
        (1, 5, "COUNTA(D1:D5)", num(5.0)),
        // Arithmetic on aggregates
        (2, 5, "SUM(A1:A5)+SUM(B1:B3)", num(15.0 + 60.0)), // 1+2+3+4+5=15, 10+20+30=60
        (3, 5, "AVERAGE(A1:A10)*2", num(5.5 * 2.0)),
        // SUMSQ: 1^2 + 2^2 + ... + 10^2 = 385
        (4, 5, "SUMSQ(A1:A10)", num(385.0)),
        // Nested
        (5, 5, "SUM(A1:A10)+AVERAGE(B1:B5)", num(55.0 + 30.0)), // 1..10→55, avg(10,20,30,40,50)=30
        // PRODUCT across C1:C3 = 1.5*2.5*3.5 = 13.125
        (6, 5, "PRODUCT(C1:C3)", num(13.125)),
        // Mixed ranges
        (7, 5, "SUM(A1:A5,C1:C3)", num(15.0 + 7.5)), // 1+2+3+4+5=15, 1.5+2.5+3.5=7.5
        // Whole-column variant (exercises a sparse full-column bbox)
        (8, 5, "SUM(A:A)", num(210.0)),
        (9, 5, "SUM(B:B)", num(550.0)),
    ];

    let mut oracle = Vec::with_capacity(formulas.len());
    for (row, col, formula, expected) in formulas {
        cells.push(fcell(0, *row, *col, formula));
        oracle.push(OracleEntry::new("Sheet1", *row, *col, expected.clone()));
    }

    let snapshot = build_workbook(vec![("Sheet1", 200, 20, cells)]);

    Fixture {
        name: "agg_heavy",
        snapshot,
        oracle,
    }
}

// ---------------------------------------------------------------------------
// Fixture: multisheet — cross-sheet references
// ---------------------------------------------------------------------------

/// Multi-sheet workbook with cross-sheet references.
///
/// - `Data` sheet holds the numeric inputs (A1..A10 = 1..10).
/// - `Data2` holds a text column (A1..A5 = "x","y","z","w","v") and
///   numeric col B (1..5).
/// - `Report` formulas consume both.
pub fn multisheet() -> Fixture {
    // Sheet 0: Data — A1..A10 = 1..10, B1..B10 = 2..20 (i*2)
    let mut data_cells: Vec<CellData> = Vec::new();
    for i in 0..10u32 {
        data_cells.push(ncell(0, i, 0, f64::from(i + 1)));
        data_cells.push(ncell(0, i, 1, f64::from((i + 1) * 2)));
    }

    // Sheet 1: Data2
    let data2_cells = vec![
        tcell(1, 0, 0, "x"),
        tcell(1, 1, 0, "y"),
        tcell(1, 2, 0, "z"),
        tcell(1, 3, 0, "w"),
        tcell(1, 4, 0, "v"),
        ncell(1, 0, 1, 1.0),
        ncell(1, 1, 1, 2.0),
        ncell(1, 2, 1, 3.0),
        ncell(1, 3, 1, 4.0),
        ncell(1, 4, 1, 5.0),
    ];

    // Sheet 2: Report
    let report_formulas: &[(u32, u32, &str, CellValue)] = &[
        // Basic cross-sheet refs
        (0, 0, "Data!A5", num(5.0)),
        (1, 0, "Data!A1+Data!A10", num(1.0 + 10.0)),
        // Cross-sheet aggregates
        (2, 0, "SUM(Data!A1:A10)", num(55.0)),
        (3, 0, "AVERAGE(Data!A1:A10)", num(5.5)),
        (4, 0, "SUM(Data!B1:B10)", num(110.0)),
        (5, 0, "MAX(Data!A1:A10)", num(10.0)),
        (6, 0, "MIN(Data!A1:A10)", num(1.0)),
        // Cross-sheet SUMPRODUCT: Σ(A_i * B_i) = Σ(i * 2i) = 2*Σi² = 2*385=770
        (7, 0, "SUMPRODUCT(Data!A1:A10, Data!B1:B10)", num(770.0)),
        // Mixed across two source sheets
        (8, 0, "SUM(Data!A1:A5)+SUM(Data2!B1:B5)", num(15.0 + 15.0)),
        // Text lookup
        (9, 0, "Data2!A3", CellValue::Text("z".into())),
        // CONCAT-ish via & operator (binary concat)
        (10, 0, "Data2!A1&Data2!A2", CellValue::Text("xy".into())),
        // Full-column cross-sheet
        (11, 0, "SUM(Data!A:A)", num(55.0)),
        (12, 0, "COUNTA(Data2!A1:A10)", num(5.0)),
        // COUNTIF across sheets (criterion on values)
        (13, 0, "COUNTIF(Data!A1:A10, \">5\")", num(5.0)),
        // Back-reference: sum of a formula cell referencing data
        (14, 0, "Data!A1*100+Data!A2", num(102.0)),
        // SUMIF basic cross-sheet
        (
            15,
            0,
            "SUMIF(Data!A1:A10, \">5\")",
            num(6.0 + 7.0 + 8.0 + 9.0 + 10.0),
        ), // 40
        // Deep chain: Report!B0 references Report!A0 which references Data!A5
        (0, 1, "A1*3", num(15.0)),
        (1, 1, "B1+1", num(16.0)),
        // MATCH + INDEX across sheets
        (
            2,
            1,
            "INDEX(Data!A1:A10, MATCH(7, Data!A1:A10, 0))",
            num(7.0),
        ),
        // XLOOKUP across sheet
        (3, 1, "XLOOKUP(\"y\", Data2!A1:A5, Data2!B1:B5)", num(2.0)),
        // VLOOKUP across sheet (exact match)
        (4, 1, "VLOOKUP(\"w\", Data2!A1:B5, 2, FALSE)", num(4.0)),
        // Round-trip: chain of cross-sheet formulas.
        // Report!A3 (row 2) = SUM(Data!A1:A10) = 55.
        // Report!A4 (row 3) = AVERAGE(Data!A1:A10) = 5.5.
        // Sum = 60.5.
        (5, 1, "Report!A3+Report!A4", num(55.0 + 5.5)),
        // IF + cross-sheet
        (6, 1, "IF(Data!A1=1, Data!A10, Data!A5)", num(10.0)),
    ];

    let mut report_cells = Vec::new();
    let mut oracle = Vec::with_capacity(report_formulas.len());
    for (row, col, formula, expected) in report_formulas {
        report_cells.push(fcell(2, *row, *col, formula));
        oracle.push(OracleEntry::new("Report", *row, *col, expected.clone()));
    }

    let snapshot = build_workbook(vec![
        ("Data", 50, 10, data_cells),
        ("Data2", 50, 10, data2_cells),
        ("Report", 50, 10, report_cells),
    ]);

    Fixture {
        name: "multisheet",
        snapshot,
        oracle,
    }
}

// ---------------------------------------------------------------------------
// Fixture: sumifs_heavy — SUMIFS / COUNTIFS / AVERAGEIFS across a small
// table of categorical + numeric columns.
// ---------------------------------------------------------------------------

/// Heavy SUMIFS / COUNTIFS / AVERAGEIFS workbook.
///
/// Data table at rows 0..10, A..D:
///   Row:  A (cat)  B (region)  C (value)  D (flag)
///    1    "apple"   "N"           10         1
///    2    "apple"   "S"           20         0
///    3    "banana"  "N"           30         1
///    4    "banana"  "S"           40         1
///    5    "apple"   "N"           50         0
///    6    "cherry"  "E"           60         1
///    7    "cherry"  "W"           70         0
///    8    "apple"   "E"           80         1
///    9    "banana"  "E"           90         1
///   10    "cherry"  "S"          100         0
pub fn sumifs_heavy() -> Fixture {
    let table: &[(&str, &str, f64, f64)] = &[
        ("apple", "N", 10.0, 1.0),
        ("apple", "S", 20.0, 0.0),
        ("banana", "N", 30.0, 1.0),
        ("banana", "S", 40.0, 1.0),
        ("apple", "N", 50.0, 0.0),
        ("cherry", "E", 60.0, 1.0),
        ("cherry", "W", 70.0, 0.0),
        ("apple", "E", 80.0, 1.0),
        ("banana", "E", 90.0, 1.0),
        ("cherry", "S", 100.0, 0.0),
    ];

    let mut cells = Vec::new();
    for (i, (cat, region, value, flag)) in table.iter().enumerate() {
        let r = i as u32;
        cells.push(tcell(0, r, 0, cat));
        cells.push(tcell(0, r, 1, region));
        cells.push(ncell(0, r, 2, *value));
        cells.push(ncell(0, r, 3, *flag));
    }

    // Hand-computed totals (pre-confirmed by walking the table).
    // apple:      10+20+50+80 = 160    count=4   avg=40
    // banana:     30+40+90    = 160    count=3   avg≈53.333..
    // cherry:     60+70+100   = 230    count=3   avg≈76.666..
    // N region:   10+30+50    = 90     count=3
    // S region:   20+40+100   = 160    count=3
    // E region:   60+80+90    = 230    count=3
    // W region:   70          = 70     count=1
    // apple N:    10+50       = 60     count=2
    // apple E:    80          = 80     count=1
    // banana flag=1: 30+40+90 = 160    count=3
    // value >= 50: 50+60+70+80+90+100 = 450, count=6
    // value > 50 AND flag=1: 60+80+90 = 230, count=3
    let formulas: &[(u32, u32, &str, CellValue)] = &[
        // SUMIF basics (single-criterion)
        (0, 5, "SUMIF(A1:A10,\"apple\",C1:C10)", num(160.0)),
        (1, 5, "SUMIF(A1:A10,\"banana\",C1:C10)", num(160.0)),
        (2, 5, "SUMIF(A1:A10,\"cherry\",C1:C10)", num(230.0)),
        // SUMIFS multi-criterion
        (
            3,
            5,
            "SUMIFS(C1:C10, A1:A10, \"apple\", B1:B10, \"N\")",
            num(60.0),
        ),
        (
            4,
            5,
            "SUMIFS(C1:C10, A1:A10, \"apple\", B1:B10, \"E\")",
            num(80.0),
        ),
        (
            5,
            5,
            "SUMIFS(C1:C10, A1:A10, \"banana\", D1:D10, 1)",
            num(160.0),
        ),
        (6, 5, "SUMIFS(C1:C10, C1:C10, \">=50\")", num(450.0)),
        (
            7,
            5,
            "SUMIFS(C1:C10, C1:C10, \">50\", D1:D10, 1)",
            num(230.0),
        ),
        // COUNTIF basics
        (8, 5, "COUNTIF(A1:A10,\"apple\")", num(4.0)),
        (9, 5, "COUNTIF(A1:A10,\"banana\")", num(3.0)),
        (10, 5, "COUNTIF(B1:B10,\"N\")", num(3.0)),
        // COUNTIFS
        (11, 5, "COUNTIFS(A1:A10,\"apple\", B1:B10,\"N\")", num(2.0)),
        (12, 5, "COUNTIFS(C1:C10,\">50\", D1:D10, 1)", num(3.0)),
        // AVERAGEIF / AVERAGEIFS
        (13, 5, "AVERAGEIF(A1:A10,\"apple\",C1:C10)", num(40.0)),
        (
            14,
            5,
            "AVERAGEIF(A1:A10,\"banana\",C1:C10)",
            num(160.0 / 3.0),
        ),
        (
            15,
            5,
            "AVERAGEIFS(C1:C10, A1:A10, \"cherry\", D1:D10, 1)",
            num(60.0),
        ),
        // MINIFS / MAXIFS
        (16, 5, "MAXIFS(C1:C10, A1:A10, \"apple\")", num(80.0)),
        (17, 5, "MINIFS(C1:C10, A1:A10, \"apple\")", num(10.0)),
        // Comparison-criterion
        (18, 5, "SUMIF(C1:C10, \">50\")", num(400.0)), // 60+70+80+90+100
        (19, 5, "COUNTIF(C1:C10, \"<=40\")", num(4.0)), // 10,20,30,40
    ];

    let mut oracle = Vec::with_capacity(formulas.len());
    for (row, col, formula, expected) in formulas {
        cells.push(fcell(0, *row, *col, formula));
        oracle.push(OracleEntry::new("Sheet1", *row, *col, expected.clone()));
    }

    let snapshot = build_workbook(vec![("Sheet1", 100, 20, cells)]);

    Fixture {
        name: "sumifs_heavy",
        snapshot,
        oracle,
    }
}

// ---------------------------------------------------------------------------
// Fixture: xlookup_heavy — VLOOKUP / XLOOKUP / INDEX-MATCH
// ---------------------------------------------------------------------------

/// Heavy lookup-function workbook.
///
/// Lookup table in A1..C10:
///   key (A)    name (B)        value (C)
///   "k01"      "Alice"         100
///   "k02"      "Bob"           200
///   "k03"      "Charlie"       300
///   "k04"      "Diana"         400
///   "k05"      "Eve"           500
///   "k06"      "Frank"         600
///   "k07"      "Grace"         700
///   "k08"      "Heidi"         800
///   "k09"      "Ivan"          900
///   "k10"      "Judy"         1000
pub fn xlookup_heavy() -> Fixture {
    let rows: &[(&str, &str, f64)] = &[
        ("k01", "Alice", 100.0),
        ("k02", "Bob", 200.0),
        ("k03", "Charlie", 300.0),
        ("k04", "Diana", 400.0),
        ("k05", "Eve", 500.0),
        ("k06", "Frank", 600.0),
        ("k07", "Grace", 700.0),
        ("k08", "Heidi", 800.0),
        ("k09", "Ivan", 900.0),
        ("k10", "Judy", 1000.0),
    ];

    let mut cells = Vec::new();
    for (i, (k, n, v)) in rows.iter().enumerate() {
        let r = i as u32;
        cells.push(tcell(0, r, 0, k));
        cells.push(tcell(0, r, 1, n));
        cells.push(ncell(0, r, 2, *v));
    }

    let formulas: &[(u32, u32, &str, CellValue)] = &[
        // VLOOKUP exact
        (
            0,
            4,
            "VLOOKUP(\"k01\", A1:C10, 2, FALSE)",
            CellValue::Text("Alice".into()),
        ),
        (1, 4, "VLOOKUP(\"k05\", A1:C10, 3, FALSE)", num(500.0)),
        (
            2,
            4,
            "VLOOKUP(\"k10\", A1:C10, 2, FALSE)",
            CellValue::Text("Judy".into()),
        ),
        (3, 4, "VLOOKUP(\"k03\", A1:C10, 3, FALSE)", num(300.0)),
        // XLOOKUP basic
        (
            4,
            4,
            "XLOOKUP(\"k07\", A1:A10, B1:B10)",
            CellValue::Text("Grace".into()),
        ),
        (5, 4, "XLOOKUP(\"k08\", A1:A10, C1:C10)", num(800.0)),
        // XLOOKUP with if-not-found
        (6, 4, "XLOOKUP(\"missing\", A1:A10, C1:C10, -1)", num(-1.0)),
        // INDEX + MATCH
        (
            7,
            4,
            "INDEX(B1:B10, MATCH(\"k09\", A1:A10, 0))",
            CellValue::Text("Ivan".into()),
        ),
        (8, 4, "INDEX(C1:C10, MATCH(\"k02\", A1:A10, 0))", num(200.0)),
        // MATCH alone
        (9, 4, "MATCH(\"k06\", A1:A10, 0)", num(6.0)),
        (10, 4, "MATCH(400, C1:C10, 0)", num(4.0)),
        // HLOOKUP on transposed-ish region — skip; cover HLOOKUP via a
        // small horizontal table on row 20.
        // SUMPRODUCT with lookup-flavour: Σ(value where key=="k04")
        (11, 4, "SUMPRODUCT((A1:A10=\"k04\")*C1:C10)", num(400.0)),
        // Chained: XLOOKUP result used in arithmetic
        (12, 4, "XLOOKUP(\"k05\", A1:A10, C1:C10)*2", num(1000.0)),
        // XLOOKUP "approximate" backwards search (match mode -1, search mode -1)
        // Use a sorted numeric col to validate.
        (
            13,
            4,
            "XLOOKUP(250, C1:C10, B1:B10, \"none\", -1)",
            CellValue::Text("Bob".into()),
        ),
        // INDEX with a direct row num
        (14, 4, "INDEX(C1:C10, 7)", num(700.0)),
        // Nested INDEX-MATCH in an arithmetic expression
        (
            15,
            4,
            "INDEX(C1:C10, MATCH(\"k01\", A1:A10, 0))+INDEX(C1:C10, MATCH(\"k10\", A1:A10, 0))",
            num(1100.0),
        ),
        // CHOOSE
        (
            16,
            4,
            "CHOOSE(3, \"first\", \"second\", \"third\")",
            CellValue::Text("third".into()),
        ),
        // XLOOKUP on a number column returning text
        (
            17,
            4,
            "XLOOKUP(600, C1:C10, B1:B10)",
            CellValue::Text("Frank".into()),
        ),
        // XMATCH (exact)
        (18, 4, "XMATCH(\"k04\", A1:A10)", num(4.0)),
        // Full table scan: find max(value) then lookup name
        (
            19,
            4,
            "INDEX(B1:B10, MATCH(MAX(C1:C10), C1:C10, 0))",
            CellValue::Text("Judy".into()),
        ),
    ];

    let mut oracle = Vec::with_capacity(formulas.len());
    for (row, col, formula, expected) in formulas {
        cells.push(fcell(0, *row, *col, formula));
        oracle.push(OracleEntry::new("Sheet1", *row, *col, expected.clone()));
    }

    let snapshot = build_workbook(vec![("Sheet1", 100, 20, cells)]);

    Fixture {
        name: "xlookup_heavy",
        snapshot,
        oracle,
    }
}

// ---------------------------------------------------------------------------
// Fixture: dynarray — FILTER / UNIQUE / SORT spill sources
// ---------------------------------------------------------------------------

/// Dynamic-array workbook.
///
/// Engine semantics: spill sources store the full array at the formula
/// cell; `mirror.get_cell_value()` unwraps to the top-left element. We
/// pin the top-left of each spill plus a handful of scalar reductions
/// over the spilled range (e.g. `ROWS(UNIQUE(...))`) to catch both
/// spill-anchor correctness and overall spill shape.
pub fn dynarray() -> Fixture {
    let mut cells = Vec::new();

    // Input data on Sheet1 A1..A10.
    // A: 3, 1, 4, 1, 5, 9, 2, 6, 5, 3  (classic π prefix, intentionally duplicated)
    let src_a = [3.0, 1.0, 4.0, 1.0, 5.0, 9.0, 2.0, 6.0, 5.0, 3.0];
    for (i, v) in src_a.iter().enumerate() {
        cells.push(ncell(0, i as u32, 0, *v));
    }
    // B: 10..19 (all > 0, used for FILTER condition)
    for i in 0..10u32 {
        cells.push(ncell(0, i, 1, f64::from(i + 10)));
    }
    // C flag column — true for i in {0,2,4,6,8} else false
    for i in 0..10u32 {
        cells.push(ncell(0, i, 2, f64::from(i % 2 == 0)));
    }

    // Spill-source formulas live on distinct columns so each anchor has
    // enough empty room to expand downward without colliding with
    // another spill. Each spill source is placed at row 0 of its column;
    // scalar reductions over the spilled range can share columns since
    // they don't themselves spill.
    //
    // UNIQUE(A1:A10) preserves first-occurrence order = 3, 1, 4, 5, 9,
    //   2, 6 → 7 distinct. Top-left is 3.
    // SORT(A1:A10) ascending default → 1,1,2,3,3,4,5,5,6,9; top-left = 1.
    // FILTER(B1:B10, C1:C10=1) → rows 0,2,4,6,8 → values 10,12,14,16,18;
    //   top-left = 10; SUM = 70.
    // Σ input = 3+1+4+1+5+9+2+6+5+3 = 39.
    let formulas: &[(u32, u32, &str, CellValue)] = &[
        // Top-left of UNIQUE spill (col E, rows 0..6 after spill).
        (0, 4, "UNIQUE(A1:A10)", num(3.0)),
        // Shape of UNIQUE spill — scalar, can sit away from the spill.
        (0, 5, "ROWS(UNIQUE(A1:A10))", num(7.0)),
        // Top-left of ascending SORT spill (col G, rows 0..9).
        (0, 6, "SORT(A1:A10)", num(1.0)),
        (0, 7, "ROWS(SORT(A1:A10))", num(10.0)),
        // Descending SORT — its own column (H) to avoid SORT-spill collision.
        (0, 8, "SORT(A1:A10, 1, -1)", num(9.0)),
        // FILTER top-left (col J, rows 0..4).
        (0, 9, "FILTER(B1:B10, C1:C10=1)", num(10.0)),
        (0, 10, "ROWS(FILTER(B1:B10, C1:C10=1))", num(5.0)),
        (1, 10, "SUM(FILTER(B1:B10, C1:C10=1))", num(70.0)),
        // SEQUENCE scalar reductions (reducer consumes spill inline — no
        // array is materialized at the cell).
        (2, 10, "SUM(SEQUENCE(10))", num(55.0)),
        (3, 10, "ROWS(SEQUENCE(10))", num(10.0)),
        // SORTBY (sort A by B descending → B is ascending by
        // construction, so descending B places A10 first → top-left = A10 = 3).
        (0, 11, "SORTBY(A1:A10, B1:B10, -1)", num(3.0)),
        // FILTER with if-empty fallback (scalar result, no spill).
        (
            5,
            10,
            "FILTER(A1:A10, A1:A10>100, \"none\")",
            CellValue::Text("none".into()),
        ),
        // SUM consumes the SORT spill inline — scalar result, no spill.
        (6, 10, "SUM(SORT(A1:A10))", num(39.0)),
    ];

    let mut oracle = Vec::with_capacity(formulas.len());
    for (row, col, formula, expected) in formulas {
        cells.push(fcell(0, *row, *col, formula));
        oracle.push(OracleEntry::new("Sheet1", *row, *col, expected.clone()));
    }

    let snapshot = build_workbook(vec![("Sheet1", 100, 20, cells)]);

    Fixture {
        name: "dynarray",
        snapshot,
        oracle,
    }
}

// ---------------------------------------------------------------------------
// Drift reproducers
// ---------------------------------------------------------------------------

/// Drift-repro 1: the `Ib6CYMnT` pattern from FINDINGS.md §"Class B".
///
/// Pattern: SUMIFS over a **full-column** range on one sheet, with a
/// dependent formula on a second sheet. The `SourceData` sheet has a
/// populated table in rows 1..20 and a sentinel write at a very high row
/// (r=39187) that the bbox cache may or may not include depending on
/// when it was last refreshed.
///
/// For full recalc (Check B), the fresh engine should match the
/// hand-computed oracle regardless of bbox cache state — so this
/// fixture *also* pins that the initial `from_snapshot` produces the
/// correct value before any iterative edits occur. The iterative-recalc
/// drift happens on the *revert* trip in Classes I–III; Class V just
/// checks the baseline.
///
/// Oracle: sum of `value` where `category == "A"`:
/// - Rows 1..20 contribute entries A/B/A/B/... with values 1..20.
/// - The high-row sentinel at r=39188 (0-indexed 39187) is category "A"
///   with value 1 — adds 1 to the A total when counted.
/// Expected total: rows 1..20 odd-indexed (A: row 0,2,4,...,18 = values
/// 1,3,5,...,19 → 10 values summing to 100) plus the sentinel (value 1)
/// = 101.
pub fn drift_repro_1_ib6cymnt() -> Fixture {
    let mut source_cells = Vec::new();

    // Rows 1..20: alternating category A/B, value = row index+1
    for i in 0..20u32 {
        let cat = if i % 2 == 0 { "A" } else { "B" };
        source_cells.push(tcell(0, i, 0, cat)); // col A
        source_cells.push(ncell(0, i, 1, f64::from(i + 1))); // col B
    }
    // Sentinel at r=39187 (0-indexed), Excel row 39188.
    // Use same col A / col B layout.
    source_cells.push(tcell(0, 39187, 0, "A"));
    source_cells.push(ncell(0, 39187, 1, 1.0));

    // Dependent sheet: single SUMIFS formula pointing at SourceData's
    // full-column ranges.
    let report_formulas: &[(u32, u32, &str, CellValue, &'static str)] = &[
        // Full-column SUMIFS: should see the sentinel cell.
        (
            0,
            0,
            "SUMIFS(SourceData!B:B, SourceData!A:A, \"A\")",
            num(1.0 + 3.0 + 5.0 + 7.0 + 9.0 + 11.0 + 13.0 + 15.0 + 17.0 + 19.0 + 1.0),
            "Ib6CYMnT",
        ),
        // Same sum via bounded range up to row 50000 (should catch the
        // sentinel at row 39188 too).
        (
            1,
            0,
            "SUMIFS(SourceData!B1:B50000, SourceData!A1:A50000, \"A\")",
            num(101.0),
            "Ib6CYMnT",
        ),
        // COUNTIFS over full column — checks the count side of the bug.
        (
            2,
            0,
            "COUNTIFS(SourceData!A:A, \"A\")",
            num(11.0), // 10 in rows 1..20 + 1 sentinel
            "Ib6CYMnT",
        ),
        // Bounded COUNTIFS inside the populated extent — should NOT see
        // the sentinel; oracle is 10. Useful to differentiate bbox-cache
        // behavior.
        (
            3,
            0,
            "COUNTIFS(SourceData!A1:A100, \"A\")",
            num(10.0),
            "Ib6CYMnT",
        ),
        // SUMIF on a different criterion (B rows) to ensure the dep
        // infrastructure isn't stuck on category A.
        (
            4,
            0,
            "SUMIF(SourceData!A:A, \"B\", SourceData!B:B)",
            num(2.0 + 4.0 + 6.0 + 8.0 + 10.0 + 12.0 + 14.0 + 16.0 + 18.0 + 20.0), // 110
            "Ib6CYMnT",
        ),
        // AVERAGEIFS with full-column — avg of A values = 101 / 11
        (
            5,
            0,
            "AVERAGEIFS(SourceData!B:B, SourceData!A:A, \"A\")",
            num(101.0 / 11.0),
            "Ib6CYMnT",
        ),
        // Chain: another cell referencing the formula above (tests
        // two-hop dependency through a full-column range).
        (6, 0, "A1+A3", num(101.0 + 11.0), "Ib6CYMnT"),
        // Scalar reference to the sentinel itself — checks the cell is
        // actually materialized at the reported high row.
        (7, 0, "SourceData!B39188", num(1.0), "Ib6CYMnT"),
    ];

    let mut report_cells = Vec::new();
    let mut oracle = Vec::with_capacity(report_formulas.len());
    for (row, col, formula, expected, label) in report_formulas {
        report_cells.push(fcell(1, *row, *col, formula));
        oracle.push(OracleEntry::with_label(
            "Report",
            *row,
            *col,
            expected.clone(),
            label,
        ));
    }

    let snapshot = build_workbook(vec![
        ("SourceData", 50_000, 10, source_cells),
        ("Report", 50, 10, report_cells),
    ]);

    Fixture {
        name: "drift_repro_1",
        snapshot,
        oracle,
    }
}

/// Drift-repro 2: the `qKjqZiEx` float-cascade pattern from FINDINGS.md
/// §"Class B".
///
/// Pattern: a chain of formulas where precision-fragile seeds (0.1, 0.2,
/// 0.3, 0.4) cascade through arithmetic. Excel's cached value for these
/// cascades is deterministic (IEEE 754 arithmetic), so we can
/// hand-compute the exact bit-pattern using Rust's `f64`.
///
/// This is the Class-V counterpart to the Class-III bitwise test — here
/// we care about the *initial* full-recalc result matching the f64
/// oracle, not the revert trip.
pub fn drift_repro_2_float_cascade() -> Fixture {
    let mut cells = Vec::new();

    // Seeds — precision-fragile.
    cells.push(ncell(0, 0, 0, 0.1)); // A1
    cells.push(ncell(0, 1, 0, 0.2)); // A2
    cells.push(ncell(0, 2, 0, 0.3)); // A3
    cells.push(ncell(0, 3, 0, 0.4)); // A4
    cells.push(ncell(0, 4, 0, 0.7)); // A5
    cells.push(ncell(0, 5, 0, 1.0 / 3.0)); // A6

    // Hand-computed expected values using Rust f64 (matches Excel
    // because both are IEEE 754 double-precision).
    let e_a1_plus_a2 = 0.1_f64 + 0.2_f64; // 0.30000000000000004
    let e_sum_1234 = 0.1_f64 + 0.2_f64 + 0.3_f64 + 0.4_f64;
    // For SUM(A1:A4) the aggregation order may differ (could be
    // Kahan-compensated in some engines). We still pin the naive order
    // here because that's what both Excel and our engine emit for
    // plain SUM. If the engine uses Kahan in SUM and Excel doesn't, this
    // oracle drifts intentionally — Class V catches that.
    let e_a1_plus_a2_minus_a3 = (0.1_f64 + 0.2_f64) - 0.3_f64; // 5.55e-17
    let e_a1_a2_a3 = (0.1_f64 + 0.2_f64) * 0.3_f64;
    let e_7_minus_p3 = 0.7_f64 - 0.3_f64; // 0.3999999999999999
    let e_div_third = (1.0_f64 / 3.0_f64) * 3.0_f64; // 0.9999999999999999

    let formulas: &[(u32, u32, &str, CellValue, &'static str)] = &[
        // Canonical float-cascade: 0.1 + 0.2 should be 0.30000000000000004
        (0, 2, "A1+A2", num(e_a1_plus_a2), "float-cascade"),
        (1, 2, "SUM(A1:A4)", num(e_sum_1234), "float-cascade"),
        (
            2,
            2,
            "(A1+A2)-A3",
            num(e_a1_plus_a2_minus_a3),
            "float-cascade",
        ),
        (3, 2, "(A1+A2)*A3", num(e_a1_a2_a3), "float-cascade"),
        (4, 2, "A5-A3", num(e_7_minus_p3), "float-cascade"),
        (5, 2, "A6*3", num(e_div_third), "float-cascade"),
        // Chain that depends on the float-cascade cell.
        (6, 2, "C1+0", num(e_a1_plus_a2), "float-cascade"),
        // The qKjqZiEx signature (0.4 → 0.7000000000000001):
        // The exact Excel formula from FINDINGS.md isn't given — the
        // signature is that setting a dependency to 0.4 and reading
        // back a dependent formula produces 0.7000000000000001. We
        // reproduce with `A4 + A2 + A1`. Hand-compute with f64.
        (
            7,
            2,
            "A4+A2+A1",
            num(0.4_f64 + 0.2_f64 + 0.1_f64),
            "qKjqZiEx",
        ),
        // And the alternative association that Excel canonicalizes left-to-right:
        (
            8,
            2,
            "A1+A2+A4",
            num(0.1_f64 + 0.2_f64 + 0.4_f64),
            "qKjqZiEx",
        ),
        // Subtract-to-zero: the classic catastrophic-cancellation probe.
        (
            9,
            2,
            "(A1+A2+A3)-0.6",
            num((0.1_f64 + 0.2_f64 + 0.3_f64) - 0.6_f64),
            "float-cascade",
        ),
    ];

    let mut oracle = Vec::with_capacity(formulas.len());
    for (row, col, formula, expected, label) in formulas {
        cells.push(fcell(0, *row, *col, formula));
        oracle.push(OracleEntry::with_label(
            "Sheet1",
            *row,
            *col,
            expected.clone(),
            label,
        ));
    }

    let snapshot = build_workbook(vec![("Sheet1", 100, 10, cells)]);

    Fixture {
        name: "drift_repro_2",
        snapshot,
        oracle,
    }
}

// ---------------------------------------------------------------------------
// Aggregate helpers
// ---------------------------------------------------------------------------

/// Return every built-in fixture in canonical order. Order matches the
/// reporting format declared in the Class V plan.
pub fn all_fixtures() -> Vec<Fixture> {
    vec![
        agg_heavy(),
        multisheet(),
        sumifs_heavy(),
        xlookup_heavy(),
        dynarray(),
        drift_repro_1_ib6cymnt(),
        drift_repro_2_float_cascade(),
    ]
}

/// Convenience: build a `CellValue::Number` without `FiniteF64::must`
/// boilerplate at every call site.
fn num(n: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(n))
}

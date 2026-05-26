//! Demo test for cell error diagnostic messages.
//!
//! Run:
//!   cargo test -p compute-core --test error_messages_demo -- --nocapture

use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, RecalcResult, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellError, CellValue};

fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

fn build_snapshot(
    sheets: Vec<(&str, u32, u32, Vec<(u32, u32, CellValue, Option<&str>)>)>,
) -> WorkbookSnapshot {
    let sheet_snapshots = sheets
        .into_iter()
        .enumerate()
        .map(|(si, (name, rows, cols, cells))| {
            let si = si as u32;
            let cell_data: Vec<CellData> = cells
                .into_iter()
                .map(|(row, col, value, formula)| CellData {
                    cell_id: cell_uuid(si, row, col),
                    row,
                    col,
                    value,
                    formula: formula.map(|s| s.to_string()),
                    identity_formula: None,
                    array_ref: None,
                })
                .collect();
            SheetSnapshot {
                id: sheet_uuid(si),
                name: name.to_string(),
                rows,
                cols,
                cells: cell_data,
                ranges: vec![],
            }
        })
        .collect();

    WorkbookSnapshot {
        sheets: sheet_snapshots,
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

fn find_value(result: &RecalcResult, sheet_idx: u32, row: u32, col: u32) -> Option<CellValue> {
    let target = cell_uuid(sheet_idx, row, col);
    result
        .changed_cells
        .iter()
        .find(|cc| cc.cell_id == target)
        .map(|cc| cc.value.clone())
}

fn print_error(label: &str, val: &Option<CellValue>) {
    match val {
        Some(CellValue::Error(e, Some(msg))) => {
            println!("  {label}: {e} — \"{msg}\"");
        }
        Some(CellValue::Error(e, None)) => {
            println!("  {label}: {e} — (no message)");
        }
        Some(other) => {
            println!("  {label}: {other:?} (not an error)");
        }
        None => {
            println!("  {label}: (cell not in changed_cells)");
        }
    }
}

#[test]
fn demo_error_messages() {
    println!("\n========================================");
    println!("  Cell Error Diagnostic Messages Demo");
    println!("========================================\n");

    let snapshot = build_snapshot(vec![(
        "Sheet1",
        20,
        10,
        vec![
            // --- Engine-level errors ---
            // Too many args
            (0, 0, CellValue::Null, Some("IRR(1,2,3,4)")),
            // Unknown function
            (1, 0, CellValue::Null, Some("FOOBAR(1)")),
            // Text-to-number coercion failure (in SUM)
            (2, 0, CellValue::Text("hello".into()), None),
            (2, 1, CellValue::Null, Some("A3+1")),
            // --- Math errors ---
            // LOG of negative
            (3, 0, CellValue::Null, Some("LOG(-5)")),
            // SQRT of negative
            (4, 0, CellValue::Null, Some("SQRT(-1)")),
            // FACT too large
            (5, 0, CellValue::Null, Some("FACT(200)")),
            // COMBIN invalid
            (6, 0, CellValue::Null, Some("COMBIN(3,5)")),
            // --- Text errors ---
            // FIND not found
            (7, 0, CellValue::Text("hello world".into()), None),
            (7, 1, CellValue::Null, Some("FIND(\"xyz\",A8)")),
            // LEFT negative
            (8, 0, CellValue::Null, Some("LEFT(\"test\",-1)")),
            // VALUE of non-numeric text
            (9, 0, CellValue::Null, Some("VALUE(\"abc\")")),
            // --- Statistical errors ---
            // NORM.DIST with std_dev <= 0
            (10, 0, CellValue::Null, Some("NORM.DIST(1,0,-1,TRUE)")),
            // STDEV with 1 point
            (11, 0, CellValue::Null, Some("STDEV(5)")),
            // PERCENTILE out of range
            (12, 0, CellValue::Null, Some("PERCENTILE({1,2,3},1.5)")),
            // --- Lookup errors ---
            // VLOOKUP not found — need table data
            (13, 0, CellValue::number(1.0), None),
            (13, 1, CellValue::Text("a".into()), None),
            (14, 0, CellValue::number(2.0), None),
            (14, 1, CellValue::Text("b".into()), None),
            (15, 0, CellValue::Null, Some("VLOOKUP(99,A14:B15,2,FALSE)")),
            // --- Engineering errors ---
            // BIN2DEC invalid
            (16, 0, CellValue::Null, Some("BIN2DEC(\"102\")")),
            // --- Financial errors ---
            // RATE with nper=0
            (17, 0, CellValue::Null, Some("RATE(0,100,-1000)")),
        ],
    )]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("--- Engine-Level Errors ---");
    print_error(
        "IRR(1,2,3,4)  [too many args]",
        &find_value(&result, 0, 0, 0),
    );
    print_error(
        "FOOBAR(1)     [unknown func]",
        &find_value(&result, 0, 1, 0),
    );
    print_error(
        "\"hello\"+1    [text coercion]",
        &find_value(&result, 0, 2, 1),
    );

    println!("\n--- Math Errors ---");
    print_error(
        "LOG(-5)       [negative log]",
        &find_value(&result, 0, 3, 0),
    );
    print_error(
        "SQRT(-1)      [negative sqrt]",
        &find_value(&result, 0, 4, 0),
    );
    print_error("FACT(200)     [too large]", &find_value(&result, 0, 5, 0));
    print_error("COMBIN(3,5)   [n < k]", &find_value(&result, 0, 6, 0));

    println!("\n--- Text Errors ---");
    print_error(
        "FIND(\"xyz\",..) [not found]",
        &find_value(&result, 0, 7, 1),
    );
    print_error("LEFT(\"t\",-1)  [negative]", &find_value(&result, 0, 8, 0));
    print_error(
        "VALUE(\"abc\")  [non-numeric]",
        &find_value(&result, 0, 9, 0),
    );

    println!("\n--- Statistical Errors ---");
    print_error(
        "NORM.DIST(..,-1,..) [std<=0]",
        &find_value(&result, 0, 10, 0),
    );
    print_error("STDEV(5)      [need 2 pts]", &find_value(&result, 0, 11, 0));
    print_error(
        "PERCENTILE(..,1.5) [k range]",
        &find_value(&result, 0, 12, 0),
    );

    println!("\n--- Lookup Errors ---");
    print_error("VLOOKUP(99,..) [not found]", &find_value(&result, 0, 15, 0));

    println!("\n--- Engineering Errors ---");
    print_error(
        "BIN2DEC(\"102\") [invalid bin]",
        &find_value(&result, 0, 16, 0),
    );

    println!("\n--- Financial Errors ---");
    print_error("RATE(0,100,-1000) [nper=0]", &find_value(&result, 0, 17, 0));

    println!("\n========================================\n");

    // Verify at least some messages exist
    let irr_val = find_value(&result, 0, 0, 0);
    match &irr_val {
        Some(CellValue::Error(_, Some(msg))) => {
            assert!(
                msg.contains("argument"),
                "IRR message should mention arguments: {msg}"
            );
        }
        other => panic!("Expected Error with message for IRR, got: {other:?}"),
    }

    let foobar_val = find_value(&result, 0, 1, 0);
    match &foobar_val {
        Some(CellValue::Error(CellError::Name, Some(msg))) => {
            assert!(
                msg.contains("FOOBAR"),
                "Unknown function message should contain FOOBAR: {msg}"
            );
        }
        other => panic!("Expected #NAME? with message for FOOBAR, got: {other:?}"),
    }
}

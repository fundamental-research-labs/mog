//! End-to-end storage comparison. See scripts/bench/storage_bench.py.

use cell_types::SheetId;
use compute_core::storage::engine::ComputeEngine as Engine;
use compute_core::storage::{WorkbookStorage, properties};
use compute_document::hex::id_to_hex;
use snapshot_types::{CellData, CellProperties, SheetSnapshot, WorkbookSnapshot};
use std::{hint::black_box, time::Instant};
use value_types::CellValue;

const SHEET_ID: &str = "00000000-0000-0000-0000-000000000001";

fn cell(row: u32, col: u32, value: f64, formula: Option<String>) -> CellData {
    CellData {
        cell_id: format!(
            "10000000-0000-0000-0000-{:012x}",
            row as u64 * 16 + col as u64
        ),
        row,
        col,
        value: CellValue::number(value),
        formula,
        identity_formula: None,
        array_ref: None,
    }
}

fn snapshot(rows: u32, cols: u32, cells: Vec<CellData>) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: SHEET_ID.to_owned(),
            name: "Sheet1".to_owned(),
            rows,
            cols,
            cells,
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn measured<T>(name: &str, f: impl FnOnce() -> T) -> T {
    let start = Instant::now();
    let result = f();
    println!("phase\t{name}\t{:.9}", start.elapsed().as_secs_f64());
    result
}

fn assert_number(engine: &Engine, sid: &SheetId, row: u32, col: u32, expected: f64) {
    assert_eq!(
        engine.get_cell_value(sid, row, col).as_number(),
        Some(expected)
    );
}

fn live_rss() {
    if let Ok(status) = std::fs::read_to_string("/proc/self/status") {
        if let Some(rss) = status.lines().find(|line| line.starts_with("VmRSS:")) {
            println!("live_rss_kib\t{}", rss.split_whitespace().nth(1).unwrap());
        }
    }
}

fn properties_100k(sid: &SheetId) {
    let mut storage = WorkbookStorage::from_snapshot(snapshot(100_000, 1, vec![])).unwrap();
    // Imported shared strings preserve their source index and lexical value.
    // Exercise the real metadata store without retaining an input DTO collection.
    measured("write_properties", || {
        for row in 0..100_000 {
            properties::set_properties(
                &mut storage,
                sid,
                &id_to_hex(u128::from(row) + 1),
                &CellProperties {
                    original_sst_index: Some(row + 1),
                    original_value: Some(format!("shared string {row}")),
                    ..Default::default()
                },
            );
        }
    });
    let checksum = measured("read_properties", || {
        (0..100_000)
            .map(|row| {
                let props =
                    properties::get_properties(&storage, sid, &id_to_hex(u128::from(row) + 1))
                        .expect("stored properties");
                assert_eq!(props.original_value, Some(format!("shared string {row}")));
                assert_eq!(props.original_sst_index, Some(row + 1));
                u64::from(props.original_sst_index.unwrap())
            })
            .sum::<u64>()
    });
    assert_eq!(checksum, 5_000_050_000);
    println!("checksum\t{checksum}");
    live_rss();
    black_box(&storage);
}

fn main() {
    let workload = std::env::args().nth(1).expect("workload argument");
    let sid = SheetId::from_uuid_str(SHEET_ID).unwrap();
    if workload == "properties_100k" {
        properties_100k(&sid);
        return;
    }
    let engine = match workload.as_str() {
        "blank_one" => {
            let mut engine = measured("create", || {
                Engine::from_snapshot(snapshot(1_000, 26, vec![]))
                    .unwrap()
                    .0
            });
            measured("write", || {
                engine.set_cell_value_parsed(&sid, 0, 0, "1").unwrap()
            });
            assert_number(&engine, &sid, 0, 0, 1.0);
            engine
        }
        "history_1k" => {
            let mut engine = Engine::from_snapshot(snapshot(1_000, 2, vec![])).unwrap().0;
            measured("write_1000", || {
                for row in 0..1_000 {
                    engine
                        .set_cell_value_parsed(&sid, row, 0, &(row + 1).to_string())
                        .unwrap();
                }
            });
            assert_eq!(engine.get_undo_state().undo_depth, 1_000);
            measured("undo_1000", || {
                for row in (0..1_000).rev() {
                    engine.undo().unwrap();
                    assert_eq!(engine.get_cell_value(&sid, row, 0), CellValue::Null);
                }
            });
            assert!(!engine.can_undo());
            measured("redo_1000", || {
                for row in 0..1_000 {
                    engine.redo().unwrap();
                    assert_number(&engine, &sid, row, 0, f64::from(row + 1));
                }
            });
            assert!(!engine.can_redo());
            engine
        }
        "numeric_100k" => {
            let cells = (0..100_000)
                .map(|row| cell(row, 0, f64::from(row + 1), None))
                .collect();
            let engine = measured("hydrate", || {
                Engine::from_snapshot(snapshot(100_000, 2, cells))
                    .unwrap()
                    .0
            });
            measured("read_100k", || {
                for row in 0..100_000 {
                    assert_number(&engine, &sid, row, 0, f64::from(row + 1));
                }
            });
            engine
        }
        "chain_10k" => {
            let cells = (0..10_000)
                .map(|row| cell(row, 0, 1.0, (row > 0).then(|| format!("A{row}+1"))))
                .collect();
            let mut engine = measured("hydrate_recalc", || {
                Engine::from_snapshot(snapshot(10_000, 1, cells)).unwrap().0
            });
            assert_number(&engine, &sid, 9_999, 0, 10_000.0);
            measured("recalc_10", || {
                for iteration in 0..10 {
                    let value = if iteration % 2 == 0 { "2" } else { "1" };
                    engine.set_cell_value_parsed(&sid, 0, 0, value).unwrap();
                    assert_number(
                        &engine,
                        &sid,
                        9_999,
                        0,
                        9_999.0 + value.parse::<f64>().unwrap(),
                    );
                }
            });
            engine
        }
        "sum_100k" => {
            let mut cells: Vec<_> = (0..100_000)
                .map(|row| cell(row, 0, f64::from(row + 1), None))
                .collect();
            cells.push(cell(0, 1, 0.0, Some("SUM(A1:A100000)".to_owned())));
            let mut engine = measured("hydrate_recalc", || {
                Engine::from_snapshot(snapshot(100_000, 2, cells))
                    .unwrap()
                    .0
            });
            const SUM: f64 = 5_000_050_000.0;
            assert_number(&engine, &sid, 0, 1, SUM);
            measured("recalc_100", || {
                for iteration in 0..100 {
                    let value = if iteration % 2 == 0 { "2" } else { "1" };
                    engine.set_cell_value_parsed(&sid, 0, 0, value).unwrap();
                    assert_number(
                        &engine,
                        &sid,
                        0,
                        1,
                        SUM - 1.0 + value.parse::<f64>().unwrap(),
                    );
                }
            });
            engine
        }
        "xlsx_100k" => {
            let path = std::env::args().nth(2).expect("XLSX fixture argument");
            let bytes = std::fs::read(path).expect("read fixture");
            let engine = measured("parse_hydrate", || {
                Engine::from_xlsx_bytes(&bytes).unwrap().0
            });
            let imported_sid = *engine.cell_store().sheet_ids().next().unwrap();
            measured("read_100k", || {
                for row in 0..10_000 {
                    for col in 0..10 {
                        assert_number(
                            &engine,
                            &imported_sid,
                            row,
                            col,
                            f64::from(row * 10 + col + 1),
                        );
                    }
                }
            });
            engine
        }
        _ => panic!("unknown workload: {workload}"),
    };
    // Sample while the complete live document is retained. Process peak RSS
    // (including setup, validation, and teardown) is measured by the runner.
    live_rss();
    black_box(&engine);
}

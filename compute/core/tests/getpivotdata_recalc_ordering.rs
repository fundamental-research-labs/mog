//! Behavioral regression tests for GETPIVOTDATA / pivot-materialization ordering.
//!
//! `ComputeEngine::recalculate*()` must materialize stored pivot output before
//! full formula recalculation. GETPIVOTDATA reads the rendered pivot region
//! through the cell store, so stale or absent pivot output would make the
//! formula evaluate to the wrong value.

use cell_types::{SheetId, SheetPos};
use compute_core::storage::engine::ComputeEngine;
use serde_json::json;
use snapshot_types::{CellData, RecalcOptions, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

const DATA_SHEET_ID: &str = "550e8400-e29b-41d4-a716-446655440000";
const PIVOT_SHEET_ID: &str = "550e8400-e29b-41d4-a716-446655440100";

fn cell_uuid(sheet_digit: u8, row: u32, col: u32) -> String {
    format!("c0000000{sheet_digit:04x}{row:04x}{col:04x}000000000000")
}

fn text_cell(sheet_digit: u8, row: u32, col: u32, text: &str) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_digit, row, col),
        row,
        col,
        value: CellValue::Text(text.into()),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn number_cell(sheet_digit: u8, row: u32, col: u32, value: f64) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_digit, row, col),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(value)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn formula_cell(sheet_digit: u8, row: u32, col: u32, formula: &str) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_digit, row, col),
        row,
        col,
        value: CellValue::Null,
        formula: Some(formula.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

fn workbook_with_getpivotdata_formula() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                identities: Vec::new(),
                row_axis: None,
                col_axis: None,
                id: DATA_SHEET_ID.to_string(),
                name: "Data".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![
                    text_cell(0, 0, 0, "Category"),
                    text_cell(0, 0, 1, "Amount"),
                    text_cell(0, 1, 0, "A"),
                    number_cell(0, 1, 1, 10.0),
                    text_cell(0, 2, 0, "A"),
                    number_cell(0, 2, 1, 20.0),
                    text_cell(0, 3, 0, "B"),
                    number_cell(0, 3, 1, 7.0),
                ],
                ranges: vec![],
            },
            SheetSnapshot {
                identities: Vec::new(),
                row_axis: None,
                col_axis: None,
                id: PIVOT_SHEET_ID.to_string(),
                name: "Pivot".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![formula_cell(
                    1,
                    0,
                    6,
                    r#"=GETPIVOTDATA("Sum of Amount",$A$1,"Category","A")"#,
                )],
                ranges: vec![],
            },
        ],
        ..Default::default()
    }
}

fn create_pivot(engine: &mut ComputeEngine) {
    let config = json!({
        "id": "pivot-getpivotdata-ordering",
        "name": "PivotForGetPivotData",
        "sourceSheetId": DATA_SHEET_ID,
        "sourceSheetName": "Data",
        "sourceRange": { "startRow": 0, "startCol": 0, "endRow": 3, "endCol": 1 },
        "outputSheetName": "Pivot",
        "outputLocation": { "row": 0, "col": 0 },
        "fields": [
            { "id": "Category", "name": "Category", "sourceColumn": 0, "dataType": "string" },
            { "id": "Amount", "name": "Amount", "sourceColumn": 1, "dataType": "number" }
        ],
        "placements": [
            { "fieldId": "Category", "area": "row", "position": 0 },
            { "fieldId": "Amount", "area": "value", "position": 0, "aggregateFunction": "sum" }
        ],
        "filters": []
    });

    engine.pivot_create(config).expect("pivot_create");
}

fn pivot_sheet_id() -> SheetId {
    SheetId::from_uuid_str(PIVOT_SHEET_ID).unwrap()
}

fn getpivotdata_value(engine: &ComputeEngine) -> f64 {
    match engine
        .cell_store()
        .get_cell_value_at(&pivot_sheet_id(), SheetPos::new(0, 6))
    {
        Some(CellValue::Number(n)) => n.get(),
        other => {
            let pivot_cells: Vec<_> = (0..6)
                .map(|row| {
                    (0..3)
                        .map(|col| {
                            engine
                                .cell_store()
                                .get_cell_value_at(&pivot_sheet_id(), SheetPos::new(row, col))
                                .cloned()
                        })
                        .collect::<Vec<_>>()
                })
                .collect();
            panic!(
                "expected GETPIVOTDATA formula to evaluate to 30, got {other:?}; pivot cells: {pivot_cells:?}; pivot defs: {:?}",
                engine.cell_store().all_pivot_tables()
            );
        }
    }
}

#[test]
fn recalculate_materializes_pivots_before_full_recalc() {
    let (mut engine, _) =
        ComputeEngine::from_snapshot(workbook_with_getpivotdata_formula()).unwrap();
    create_pivot(&mut engine);

    engine.recalculate().expect("recalculate");

    assert_eq!(getpivotdata_value(&engine), 30.0);
}

#[test]
fn recalculate_with_options_materializes_pivots_before_full_recalc() {
    let (mut engine, _) =
        ComputeEngine::from_snapshot(workbook_with_getpivotdata_formula()).unwrap();
    create_pivot(&mut engine);

    engine
        .recalculate_with_options(&RecalcOptions::default())
        .expect("recalculate_with_options");

    assert_eq!(getpivotdata_value(&engine), 30.0);
}

#[test]
fn native_overall_totals_follow_each_rendered_measure_for_every_axis_layout() {
    for row_group in [false, true] {
        for col_group in [false, true] {
            let mut snapshot = workbook_with_getpivotdata_formula();
            snapshot.sheets[0].cells.extend([
                text_cell(0, 0, 2, "Region"),
                text_cell(0, 1, 2, "East"),
                text_cell(0, 2, 2, "West"),
                text_cell(0, 3, 2, "East"),
            ]);
            snapshot.sheets[1].cells = vec![
                formula_cell(1, 20, 0, r#"=GETPIVOTDATA("Sum of Amount",$B$3)"#),
                formula_cell(1, 21, 0, r#"=GETPIVOTDATA("Count of Amount",$B$3)"#),
                formula_cell(1, 22, 0, r#"=GETPIVOTDATA("Constant Two",$B$3)"#),
            ];
            let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
            let mut placements = vec![
                json!({"fieldId":"Amount","area":"value","position":0,"aggregateFunction":"sum"}),
                json!({"fieldId":"Amount","area":"value","position":1,"aggregateFunction":"count"}),
            ];
            if row_group {
                placements.push(json!({"fieldId":"Category","area":"row","position":0}));
            }
            if col_group {
                placements.push(json!({"fieldId":"Region","area":"column","position":0}));
            }
            engine.pivot_create(json!({
                "id":"overall", "name":"Overall", "sourceSheetId":DATA_SHEET_ID,
                "sourceSheetName":"Data", "sourceRange":{"startRow":0,"startCol":0,"endRow":3,"endCol":2},
                "outputSheetName":"Pivot", "outputLocation":{"row":2,"col":1},
                "fields":[
                    {"id":"Category","name":"Category","sourceColumn":0,"dataType":"string"},
                    {"id":"Amount","name":"Amount","sourceColumn":1,"dataType":"number"},
                    {"id":"Region","name":"Region","sourceColumn":2,"dataType":"string"}
                ], "placements":placements,"filters":[],"calculatedFields":[{"fieldId":"double","name":"Constant Two","formula":"1 + 1"}]
            })).unwrap();
            engine.recalculate().unwrap();
            for (row, expected) in [(20, 37.0), (21, 3.0), (22, 2.0)] {
                assert_eq!(
                    engine
                        .cell_store()
                        .get_cell_value_at(&pivot_sheet_id(), SheetPos::new(row, 0)),
                    Some(&CellValue::Number(FiniteF64::must(expected))),
                    "row_group={row_group}, col_group={col_group}; defs={:?}",
                    engine.cell_store().all_pivot_tables()
                );
            }
        }
    }
}

/// Authored cache-only package: CT_CacheSource permits its child choice to be
/// absent (minOccurs=0), so there is no live worksheet range to refresh.
/// GETPIVOTDATA must read the existing result using its imported axis layout.
/// Schema: ISO/IEC 29500-1 A.2 CT_CacheSource; Open XML SDK CacheSource metadata
/// uses CompositeParticle.Builder(ParticleType.Choice, 0, 1).
fn imported_overall_fixture(data_on_rows: bool, include_totals: bool) -> Vec<u8> {
    use xlsx_parser::write::ZipWriter;
    let main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    let rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    let mut zip = ZipWriter::new();
    let files = [
        (
            "[Content_Types].xml",
            format!(
                r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/pivotTables/pivotTable1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"/><Override PartName="/xl/pivotCache/pivotCacheDefinition1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"/></Types>"#
            ),
        ),
        (
            "_rels/.rels",
            format!(
                r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="{rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>"#
            ),
        ),
        (
            "xl/workbook.xml",
            format!(
                r#"<workbook xmlns="{main}" xmlns:r="{rel}"><sheets><sheet name="Pivot" sheetId="1" r:id="r1"/></sheets><pivotCaches><pivotCache cacheId="1" r:id="r2"/></pivotCaches></workbook>"#
            ),
        ),
        (
            "xl/_rels/workbook.xml.rels",
            format!(
                r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="{rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Type="{rel}/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition1.xml"/></Relationships>"#
            ),
        ),
        (
            "xl/worksheets/_rels/sheet1.xml.rels",
            format!(
                r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="p1" Type="{rel}/pivotTable" Target="../pivotTables/pivotTable1.xml"/></Relationships>"#
            ),
        ),
        (
            "xl/pivotTables/_rels/pivotTable1.xml.rels",
            format!(
                r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="c1" Type="{rel}/pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition1.xml"/></Relationships>"#
            ),
        ),
        (
            "xl/pivotCache/pivotCacheDefinition1.xml",
            format!(
                r#"<pivotCacheDefinition xmlns="{main}" recordCount="0"><cacheSource type="worksheet"/><cacheFields count="4"><cacheField name="Category"><sharedItems/></cacheField><cacheField name="Region"><sharedItems/></cacheField><cacheField name="Amount"><sharedItems/></cacheField><cacheField name="Units"><sharedItems/></cacheField></cacheFields></pivotCacheDefinition>"#
            ),
        ),
    ];
    for (path, xml) in files {
        zip.add_file(path, xml.into_bytes());
    }
    let grand = if include_totals { "grand" } else { "data" };
    // The second measure comes first in the physical total band. A trailing
    // blank item proves totals are resolved by axis semantics, not last cells.
    let expanded = format!(
        r#"<i><x/></i><i t="{grand}" i="1"><x/></i><i t="{grand}" i="0"><x/></i><i t="blank"><x/></i>"#
    );
    let single = format!(r#"<i><x/></i><i t="{grand}"><x/></i><i t="blank"><x/></i>"#);
    let (rows, cols, cells) = if data_on_rows {
        (
            &expanded,
            &single,
            r#"<row r="4"><c r="C4"><v>6</v></c><c r="D4"><v>123</v></c></row><row r="5"><c r="D5"><v>9</v></c></row><row r="6"><c r="D6"><v>57</v></c></row>"#,
        )
    } else {
        (
            &single,
            &expanded,
            r#"<row r="4"><c r="C4"><v>6</v></c></row><row r="5"><c r="C5"><v>6</v></c><c r="D5"><v>9</v></c><c r="E5"><v>57</v></c></row>"#,
        )
    };
    zip.add_file("xl/worksheets/sheet1.xml",format!(r#"<worksheet xmlns="{main}"><sheetData><row r="1"><c r="A1"><f>GETPIVOTDATA("Sum of Amount",B3)</f><v>0</v></c></row><row r="2"><c r="A2"><f>GETPIVOTDATA("Sum of Units",B3)</f><v>0</v></c></row>{cells}</sheetData></worksheet>"#).into_bytes());
    zip.add_file("xl/pivotTables/pivotTable1.xml",format!(r#"<pivotTableDefinition xmlns="{main}" name="ImportedOverall" cacheId="1" dataCaption="Values" dataOnRows="{}"><location ref="B3:F8" firstHeaderRow="0" firstDataRow="1" firstDataCol="1"/><pivotFields count="4"><pivotField axis="axisRow"/><pivotField axis="axisCol"/><pivotField dataField="1"/><pivotField dataField="1"/></pivotFields><rowFields count="1"><field x="0"/></rowFields><colFields count="1"><field x="1"/></colFields><rowItems count="{}">{rows}</rowItems><colItems count="{}">{cols}</colItems><dataFields count="2"><dataField name="Sum of Amount" fld="2" subtotal="sum"/><dataField name="Sum of Units" fld="3" subtotal="sum"/></dataFields></pivotTableDefinition>"#,u8::from(data_on_rows),if data_on_rows {4}else{3},if data_on_rows {3}else{4}).into_bytes());
    zip.finish().unwrap()
}

#[test]
fn imported_overall_totals_use_axis_measure_indices_on_either_axis() {
    for data_on_rows in [false, true] {
        for include_totals in [false, true] {
            let (mut engine, _) =
                ComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
            engine
                .import_from_xlsx_bytes_deferred(&imported_overall_fixture(
                    data_on_rows,
                    include_totals,
                ))
                .unwrap();
            for roundtrip in 0..2 {
                engine.complete_deferred_hydration().unwrap();
                if roundtrip == 0 {
                    // Hydration and ordinary export preserve the authored cache.
                    // Pending first calculation is consumed only by recalculate.
                    let bytes = engine.export_to_xlsx_bytes().unwrap();
                    let (mut preserved, _) =
                        ComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
                    preserved.import_from_xlsx_bytes_deferred(&bytes).unwrap();
                    preserved.complete_deferred_hydration().unwrap();
                    let sheet = SheetId::from_uuid_str(&preserved.get_all_sheet_ids()[0]).unwrap();
                    for row in [0, 1] {
                        assert_eq!(
                            preserved
                                .cell_store()
                                .get_cell_value_at(&sheet, SheetPos::new(row, 0)),
                            Some(&CellValue::number(0.0)),
                            "preserve-cache export/reimport must not calculate"
                        );
                    }
                }
                let sheet = SheetId::from_uuid_str(&engine.get_all_sheet_ids()[0]).unwrap();
                assert!(
                    engine.pivot_get_all(&sheet).is_empty(),
                    "cache-only pivot must not acquire a refreshable native source"
                );
                engine.recalculate().unwrap();
                for (row, expected) in [(0, 57.0), (1, 9.0)] {
                    let expected = if include_totals {
                        CellValue::Number(FiniteF64::must(expected))
                    } else {
                        CellValue::Error(value_types::CellError::Ref, None)
                    };
                    assert_eq!(
                        engine
                            .cell_store()
                            .get_cell_value_at(&sheet, SheetPos::new(row, 0)),
                        Some(&expected),
                        "on_rows={data_on_rows}, totals={include_totals}, roundtrip={roundtrip}; defs={:?}",
                        engine.cell_store().all_pivot_tables()
                    );
                }
                if roundtrip == 0 {
                    let bytes = engine.export_to_xlsx_bytes().unwrap();
                    engine.import_from_xlsx_bytes_deferred(&bytes).unwrap();
                }
            }
        }
    }
}

#[test]
fn overall_totals_require_one_in_bounds_cell_for_the_requested_measure() {
    use snapshot_types::{PivotGrandTotalCell, PivotTableDef};
    let total = PivotGrandTotalCell {
        data_field_index: 0,
        row: 3,
        col: 4,
    };
    for cells in [
        vec![],
        vec![total.clone(), total.clone()],
        vec![PivotGrandTotalCell {
            row: 12,
            ..total.clone()
        }],
        vec![total],
    ] {
        let valid = cells.len() == 1 && cells[0].row == 3;
        let mut snapshot = workbook_with_getpivotdata_formula();
        snapshot.sheets[1].cells = vec![
            formula_cell(1, 0, 6, r#"=GETPIVOTDATA("Sum of Amount",A1)"#),
            number_cell(1, 3, 4, 57.0),
        ];
        snapshot.pivot_tables = vec![PivotTableDef {
            id: "snapshot-pivot".into(),
            name: "SnapshotPivot".into(),
            sheet: pivot_sheet_id().to_uuid_string(),
            start_row: 0,
            start_col: 0,
            end_row: 5,
            end_col: 5,
            data_field_names: vec!["Sum of Amount".into()],
            grand_total_cells: cells,
            ..Default::default()
        }];
        let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
        engine.recalculate().unwrap();
        let expected = if valid {
            CellValue::Number(FiniteF64::must(57.0))
        } else {
            CellValue::Error(value_types::CellError::Ref, None)
        };
        assert_eq!(
            engine
                .cell_store()
                .get_cell_value_at(&pivot_sheet_id(), SheetPos::new(0, 6)),
            Some(&expected)
        );
    }
}

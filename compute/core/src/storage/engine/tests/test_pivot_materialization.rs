use super::super::*;
use super::helpers::*;
use crate::snapshot::{CellData, SheetSnapshot};
use serde_json::json;
use value_types::{CellValue, ComputeError, FiniteF64};

fn stored_number_format_at(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<String> {
    let cell_id = engine
        .mirror()
        .resolve_cell_id(sheet_id, SheetPos::new(row, col))
        .expect("cell allocated");
    engine
        .get_cell_format(sheet_id, &cell_id, row, col)
        .number_format
}

fn pivot_snapshot(sid: SheetId) -> WorkbookSnapshot {
    WorkbookSnapshot {
        axis_run_high_water_mark: None,
        identity_high_water_mark: None,
        canonical_tables: Vec::new(),
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: sid.to_uuid_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440201".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Text("Region".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440202".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::Text("Sales".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440203".to_string(),
                    row: 1,
                    col: 0,
                    value: CellValue::Text("North".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440204".to_string(),
                    row: 1,
                    col: 1,
                    value: CellValue::Number(FiniteF64::must(100.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440205".to_string(),
                    row: 2,
                    col: 0,
                    value: CellValue::Text("South".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440206".to_string(),
                    row: 2,
                    col: 1,
                    value: CellValue::Number(FiniteF64::must(300.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

fn create_region_sales_pivot(engine: &mut ComputeEngine, sid: SheetId, name: &str) -> String {
    create_region_sales_pivot_on_sheet(engine, sid, sid, "Sheet1", name)
}

fn create_region_sales_pivot_on_sheet(
    engine: &mut ComputeEngine,
    source_sid: SheetId,
    output_sid: SheetId,
    output_sheet_name: &str,
    name: &str,
) -> String {
    engine
        .pivot_create(json!({
            "id": name,
            "name": name,
            "sourceSheetId": source_sid.to_uuid_string(),
            "sourceSheetName": "Sheet1",
            "sourceRange": { "startRow": 0, "startCol": 0, "endRow": 2, "endCol": 1 },
            "outputSheetId": output_sid.to_uuid_string(),
            "outputSheetName": output_sheet_name,
            "outputLocation": { "row": 0, "col": 4 },
            "fields": [
                { "id": "Region", "name": "Region", "sourceColumn": 0, "dataType": "string" },
                { "id": "Sales", "name": "Sales", "sourceColumn": 1, "dataType": "number" }
            ],
            "placements": [
                { "fieldId": "Region", "area": "row", "position": 0 },
                {
                    "fieldId": "Sales",
                    "area": "value",
                    "position": 0,
                    "aggregateFunction": "sum"
                }
            ],
            "filters": []
        }))
        .expect("create pivot");
    engine
        .pivot_get_all(&output_sid)
        .into_iter()
        .find(|config| config.name == name)
        .expect("created pivot")
        .id
}

#[test]
fn api_created_pivot_exports_refresh_safe_ooxml_metadata() {
    let sid = sheet_id();
    let snap = pivot_snapshot(sid);
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();
    let (output_sheet_hex, _) = engine
        .create_sheet("PivotOutput")
        .expect("create separate pivot output sheet");
    let output_sid = SheetId::from_uuid_str(&output_sheet_hex).expect("output sheet id");
    let pivot_id = create_region_sales_pivot_on_sheet(
        &mut engine,
        sid,
        output_sid,
        "PivotOutput",
        "ExportSafePivot",
    );
    engine.recalculate().expect("materialize pivot");

    let def = engine
        .mirror()
        .find_pivot_table_def(&pivot_id, "ExportSafePivot", &output_sid.to_uuid_string())
        .expect("materialized pivot definition")
        .clone();
    let expected_range = format!(
        "{}:{}",
        crate::range_manager::pos_to_a1(def.start_row, def.start_col),
        crate::range_manager::pos_to_a1(def.end_row, def.end_col),
    );

    let exported = engine
        .export_to_parse_output()
        .expect("export parse output")
        .parse_output;
    let pivot = exported
        .pivot_tables
        .iter()
        .find(|pivot| pivot.config.id == pivot_id)
        .expect("exported pivot");
    assert_eq!(
        pivot.config.ref_range.as_deref(),
        Some(expected_range.as_str())
    );
    assert_eq!(pivot.config.first_data_row, Some(def.first_data_row));
    assert_eq!(pivot.config.first_data_col, Some(def.first_data_col));
    assert_eq!(
        pivot
            .config
            .style
            .as_ref()
            .and_then(|style| style.style_name.as_deref()),
        Some("PivotStyleLight16")
    );

    let bytes = engine.export_to_xlsx_bytes().expect("export xlsx bytes");
    let pivot_xml =
        archive_text(&bytes, "xl/pivotTables/pivotTable1.xml").expect("pivot table part");
    assert!(pivot_xml.contains(&format!("ref=\"{expected_range}\"")));
    assert!(pivot_xml.contains("<items count=\"1\"><item t=\"default\"/></items>"));
    assert!(pivot_xml.contains("name=\"PivotStyleLight16\""));
}

#[test]
fn pivot_output_cells_reject_user_writes() {
    let sid = sheet_id();
    let snap = pivot_snapshot(sid);
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();

    create_region_sales_pivot(&mut engine, sid, "GuardedPivot");
    engine.recalculate().expect("materialize pivot");

    let err = engine
        .batch_set_cells_by_position(
            vec![(
                sid,
                1,
                4,
                crate::storage::engine::mutation::CellInput::Parse {
                    text: "asdf".into(),
                },
            )],
            true,
        )
        .expect_err("pivot output user write should reject");

    assert!(matches!(
        err,
        ComputeError::PartialArrayWrite {
            row: 1,
            col: 4,
            anchor_row: 0,
            anchor_col: 4,
            ..
        }
    ));
    assert!(!engine.can_edit_cell(&sid, 1, 4));
    assert_eq!(cell_value_at(&engine, &sid, 1, 4), CellValue::from("North"));
}

#[test]
fn copied_sheet_pivots_retarget_output_and_same_sheet_source() {
    let sid = sheet_id();
    let snap = pivot_snapshot(sid);
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();

    let original_id = create_region_sales_pivot(&mut engine, sid, "CopyablePivot");
    engine.recalculate().expect("materialize source pivot");

    let (copy_hex, _) = engine.copy_sheet(&sid, "Copy").expect("copy sheet");
    let copy_id_raw = compute_document::hex::hex_to_id(&copy_hex).expect("copy sheet id hex");
    let copy_sid = SheetId::from_raw(copy_id_raw);
    let copied_pivots = engine.pivot_get_all(&copy_sid);
    assert_eq!(copied_pivots.len(), 1);
    let copied = &copied_pivots[0];
    assert_ne!(copied.id, original_id);
    assert_eq!(
        copied.output_sheet_id.as_deref(),
        Some(copy_sid.to_uuid_string().as_str())
    );
    assert_eq!(copied.output_sheet_name, "Copy");
    assert_eq!(
        copied.source_sheet_id.as_deref(),
        Some(copy_sid.to_uuid_string().as_str())
    );
    assert_eq!(copied.source_sheet_name, "Copy");

    let original = engine
        .pivot_get_all(&sid)
        .into_iter()
        .find(|config| config.id == original_id)
        .expect("source pivot still exists");
    let original_placement_ids: std::collections::HashSet<_> = original
        .placements
        .iter()
        .map(|placement| placement.placement_id.as_str().to_string())
        .collect();
    let copied_placement_ids: std::collections::HashSet<_> = copied
        .placements
        .iter()
        .map(|placement| placement.placement_id.as_str().to_string())
        .collect();
    assert_eq!(copied_placement_ids.len(), copied.placements.len());
    assert!(copied_placement_ids.is_disjoint(&original_placement_ids));

    engine
        .pivot_update_and_materialize(&copy_sid, &copied.id, copied.clone(), None)
        .expect("copied pivot update should use copied output identity");
}

#[test]
fn percent_show_values_as_materializes_percent_display_format() {
    let sid = sheet_id();
    let snap = WorkbookSnapshot {
        axis_run_high_water_mark: None,
        identity_high_water_mark: None,
        canonical_tables: Vec::new(),
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: sid.to_uuid_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440101".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Text("Region".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440102".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::Text("Revenue".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440103".to_string(),
                    row: 1,
                    col: 0,
                    value: CellValue::Text("North".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440104".to_string(),
                    row: 1,
                    col: 1,
                    value: CellValue::Number(FiniteF64::must(250.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440105".to_string(),
                    row: 2,
                    col: 0,
                    value: CellValue::Text("South".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440106".to_string(),
                    row: 2,
                    col: 1,
                    value: CellValue::Number(FiniteF64::must(500.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440107".to_string(),
                    row: 3,
                    col: 0,
                    value: CellValue::Text("East".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440108".to_string(),
                    row: 3,
                    col: 1,
                    value: CellValue::Number(FiniteF64::must(250.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    };
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();

    engine
        .pivot_create(json!({
            "id": "percent-pivot",
            "name": "PercentPivot",
            "sourceSheetId": sid.to_uuid_string(),
            "sourceSheetName": "Sheet1",
            "sourceRange": { "startRow": 0, "startCol": 0, "endRow": 3, "endCol": 1 },
            "outputSheetName": "Sheet1",
            "outputLocation": { "row": 0, "col": 4 },
            "fields": [
                { "id": "Region", "name": "Region", "sourceColumn": 0, "dataType": "string" },
                { "id": "Revenue", "name": "Revenue", "sourceColumn": 1, "dataType": "number" }
            ],
            "placements": [
                { "fieldId": "Region", "area": "row", "position": 0 },
                {
                    "fieldId": "Revenue",
                    "area": "value",
                    "position": 0,
                    "aggregateFunction": "sum",
                    "showValuesAs": { "type": "percentOfGrandTotal" }
                }
            ],
            "filters": []
        }))
        .expect("create percent pivot");
    engine.recalculate().expect("materialize pivot");

    assert_eq!(cell_value_at(&engine, &sid, 1, 5), num(0.25));
    assert_eq!(engine.format_cell_display(&sid, 1, 5), "25%");
    assert_eq!(engine.format_cell_display(&sid, 2, 5), "25%");
    assert_eq!(engine.format_cell_display(&sid, 3, 5), "50%");
    assert_eq!(engine.format_cell_display(&sid, 4, 5), "100%");
}

#[test]
fn source_axis_edits_update_pivots_on_other_output_sheets() {
    let source = sheet_id();
    let (mut engine, _) = ComputeEngine::from_snapshot(pivot_snapshot(source)).unwrap();
    let (output, _) = engine.create_sheet("PivotOutput").unwrap();
    let output = SheetId::from_uuid_str(&output).unwrap();
    let pivot_id = create_region_sales_pivot_on_sheet(
        &mut engine,
        source,
        output,
        "PivotOutput",
        "SalesPivot",
    );
    engine
        .structure_change(
            &source,
            &formula_types::StructureChange::InsertRows {
                at: 0,
                count: 2,
                new_row_ids: vec![],
            },
        )
        .unwrap();
    let pivot = engine
        .pivot_get_all(&output)
        .into_iter()
        .find(|pivot| pivot.id == pivot_id)
        .unwrap();
    assert_eq!(pivot.source_range, cell_types::SheetRange::new(2, 0, 4, 1));
    assert_eq!(pivot.output_location.row, 0);
    assert_eq!(pivot.output_location.col, 4);
    let exported = engine.export_to_parse_output().unwrap().parse_output;
    let pivot = exported
        .pivot_tables
        .iter()
        .find(|pivot| pivot.config.name == "SalesPivot")
        .unwrap();
    assert_eq!(
        pivot.config.source_range,
        cell_types::SheetRange::new(2, 0, 4, 1)
    );
}

#[test]
fn copied_imported_pivot_uses_an_independent_cache_for_its_copied_source() {
    let sid = sheet_id();
    let (mut engine, _) = ComputeEngine::from_snapshot(pivot_snapshot(sid)).unwrap();
    create_region_sales_pivot(&mut engine, sid, "ImportedCopy");
    let bytes = engine.export_to_xlsx_bytes().unwrap();
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let source = engine.storage().sheet_order()[0];
    let original = engine.pivot_get_all(&source).pop().unwrap();
    let original_cache = original.cache_id.expect("imported cache identity");
    // Imported pivot-backed objects use the OOXML pivot name. A nonsequential
    // sheet ID catches accidental use of worksheet position as the OOXML tab ID.
    engine
        .stores
        .storage
        .sheet_metadata
        .get_mut(&source)
        .unwrap()
        .original_sheet_id = Some(7);
    let slicer = domain_types::domain::slicer::xlsx_import_to_stored_slicer(
        &ooxml_types::slicers::SlicerDef {
            name: "Regions".into(),
            cache: "RegionCache".into(),
            ..Default::default()
        },
        Some(&ooxml_types::slicers::SlicerCacheDef {
            name: "RegionCache".into(),
            source_name: "Region".into(),
            pivot_tables: vec![ooxml_types::slicers::SlicerPivotTableRef {
                tab_id: 7,
                name: original.name.clone(),
            }],
            tabular_data: Some(ooxml_types::slicers::SlicerTabularData {
                pivot_cache_id: original_cache,
                ..Default::default()
            }),
            ..Default::default()
        }),
        None,
        domain_types::domain::slicer::XlsxSlicerImportContext {
            sheet_id: &source.to_uuid_string(),
            source_table_id: None,
            source_table_column_id: None,
            table_filter_selected_values: None,
        },
    );
    engine
        .stores
        .storage
        .metadata
        .slicers
        .insert(slicer.id.clone(), slicer);
    let timeline = domain_types::domain::slicer::xlsx_import_to_stored_timeline(
        &ooxml_types::timelines::TimelineDef {
            name: "Dates".into(),
            cache: "DateCache".into(),
            ..Default::default()
        },
        Some(&ooxml_types::timelines::TimelineCacheDef {
            name: "DateCache".into(),
            source_name: "Region".into(),
            pivot_cache_id: Some(original_cache),
            pivot_tables: vec![ooxml_types::timelines::TimelinePivotTableRef {
                tab_id: 7,
                name: original.name.clone(),
            }],
            ..Default::default()
        }),
        None,
        &source.to_uuid_string(),
    );
    engine
        .stores
        .storage
        .metadata
        .timelines
        .insert(timeline.id.clone(), timeline);
    let (copy, _) = engine.copy_sheet(&source, "CopiedImport").unwrap();
    let copy = SheetId::from_uuid_str(&copy).unwrap();
    let copied = engine.pivot_get_all(&copy).pop().unwrap();
    let copied_cache = copied.cache_id.expect("copied cache identity");
    assert_ne!(original_cache, copied_cache);
    assert_eq!(
        copied.source_sheet_id.as_deref(),
        Some(copy.to_uuid_string().as_str())
    );
    let exported = engine.export_to_parse_output().unwrap();
    for (cache_id, expected_sheet) in [(original_cache, "Sheet1"), (copied_cache, "CopiedImport")] {
        let source = exported
            .parse_output
            .pivot_cache_sources
            .iter()
            .find(|source| source.cache_id == cache_id)
            .unwrap();
        assert_eq!(source.source_sheet.as_deref(), Some(expected_sheet));
    }
    let bytes = engine.export_to_xlsx_bytes().unwrap();
    let mut output = xlsx_parser::parse_xlsx_to_output(&bytes).unwrap().0;
    output.slicer_caches.sort_by(|a, b| a.name.cmp(&b.name));
    output.timeline_caches.sort_by(|a, b| a.name.cmp(&b.name));
    let cache_ids: std::collections::HashSet<_> = output
        .pivot_tables
        .iter()
        .filter_map(|pivot| pivot.config.cache_id)
        .collect();
    assert_eq!(cache_ids.len(), 2);
    for (pivot_name, cache_id, tab_id) in [
        (&original.name, original_cache, 7),
        (&copied.name, copied_cache, 8),
    ] {
        let slicer_cache = output
            .slicer_caches
            .iter()
            .find(|cache| {
                cache
                    .pivot_tables
                    .iter()
                    .any(|pivot| pivot.name == *pivot_name)
            })
            .expect("slicer follows its pivot");
        assert_eq!(slicer_cache.pivot_tables[0].tab_id, tab_id);
        assert_eq!(
            slicer_cache.tabular_data.as_ref().unwrap().pivot_cache_id,
            cache_id
        );
        let timeline_cache = output
            .timeline_caches
            .iter()
            .find(|cache| {
                cache
                    .pivot_tables
                    .iter()
                    .any(|pivot| pivot.name == *pivot_name)
            })
            .unwrap_or_else(|| {
                panic!(
                    "timeline follows {pivot_name}: {:?}",
                    output.timeline_caches
                )
            });
        assert_eq!(timeline_cache.pivot_tables[0].tab_id, tab_id);
        assert_eq!(timeline_cache.pivot_cache_id, Some(cache_id));
    }
    let (engine, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let mut output_again =
        xlsx_parser::parse_xlsx_to_output(&engine.export_to_xlsx_bytes().unwrap())
            .unwrap()
            .0;
    output_again
        .slicer_caches
        .sort_by(|a, b| a.name.cmp(&b.name));
    output_again
        .timeline_caches
        .sort_by(|a, b| a.name.cmp(&b.name));
    assert_eq!(output_again.slicer_caches, output.slicer_caches);
    assert_eq!(output_again.timeline_caches, output.timeline_caches);
}

mod copy_binding_regressions;

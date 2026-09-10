use super::materialize::build_cell_data_for_cell_id;
use super::{export_authored_style_runs_for_sheet, export_cells_for_sheet};
use cell_types::{CellId, SheetId, SheetPos};
use domain_types::{AuthoredStyleRun, CellFormat, DocumentFormat};
use rustc_hash::FxHashMap;
use value_types::CellValue;

use crate::cells::CellStore;
use crate::import::parse_output_to_snapshot::{
    DefaultIdAllocator, parse_output_to_workbook_snapshot,
};
use crate::scheduler::ComputeCore;
use crate::snapshot::{SheetSnapshot, WorkbookSnapshot};
use crate::storage::WorkbookStorage;
use crate::storage::engine::ComputeEngine;
use crate::storage::engine::construction::assemble_engine;
use crate::storage::engine::services::export::LocalPalette;
use crate::storage::properties::CellProperties;
use compute_pivot::types::{
    FieldId, PivotGrandTotals, PivotHeader, PivotRenderedBounds, PivotRow, PivotTableResult,
};
use snapshot_types::PivotTableDef;
use std::sync::Arc;
use value_types::FiniteF64;

fn number(n: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(n))
}

fn workbook(sheet_id: &SheetId, cells: Vec<snapshot_types::CellData>) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: sheet_id.to_uuid_string(),
            name: "PivotOut".to_string(),
            rows: 20,
            cols: 10,
            cells,
            ranges: vec![],
        }],
        ..WorkbookSnapshot::default()
    }
}

fn metadata_only_shared_string_output() -> domain_types::ParseOutput {
    domain_types::ParseOutput {
        sheets: vec![domain_types::SheetData {
            name: "Sheet1".to_string(),
            rows: 1,
            cols: 1,
            cells: vec![domain_types::CellData {
                row: 0,
                col: 0,
                value: CellValue::Text(Arc::<str>::from("")),
                original_sst_index: Some(7),
                original_value: Some("7".to_string()),
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    }
}

fn empty_shared_string_source_xlsx() -> Vec<u8> {
    let output = domain_types::ParseOutput {
        sheets: vec![domain_types::SheetData {
            name: "Sheet1".to_string(),
            rows: 1,
            cols: 1,
            cells: vec![domain_types::CellData {
                row: 0,
                col: 0,
                value: CellValue::Text(Arc::<str>::from("")),
                original_sst_index: Some(0),
                original_value: Some("0".to_string()),
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    };
    xlsx_parser::write::write_xlsx_from_parse_output(&output)
        .expect("source XLSX should be writable")
}

fn engine_from_parse_output(output: &domain_types::ParseOutput) -> (ComputeEngine, SheetId) {
    let mut storage = WorkbookStorage::new();
    let mut allocator = DefaultIdAllocator::new();
    let id_map = storage
        .hydrate_from_parse_output(output, &mut allocator)
        .expect("hydrate_from_parse_output");
    let mut snapshot_allocator = DefaultIdAllocator::new();
    let snapshot =
        parse_output_to_workbook_snapshot(output, Some(&id_map), &mut snapshot_allocator);
    let mut cell_store =
        CellStore::from_snapshot(snapshot.clone()).expect("cell_store from snapshot");
    let mut compute = ComputeCore::new();
    compute
        .init_from_snapshot_no_recalc(&mut cell_store, snapshot.clone())
        .expect("compute init");
    let sheet_id = id_map.sheet_ids[0];
    let formats = crate::storage::engine::construction::collect_imported_formats(
        output,
        &id_map.sheet_ids,
        &[],
    );
    let mut engine = assemble_engine(storage, cell_store, compute, &snapshot).expect("engine");
    crate::storage::engine::construction::install_imported_formats(
        &mut engine.cell_store,
        &engine.stores.storage.metadata.style_palette,
        &formats,
    );
    (engine, sheet_id)
}

fn authored_style_run_output() -> domain_types::ParseOutput {
    domain_types::ParseOutput {
        style_palette: vec![
            DocumentFormat::default(),
            DocumentFormat {
                fill: Some(domain_types::FillFormat {
                    background_color: Some("#FFEE00".to_string()),
                    pattern_type: Some("solid".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        ],
        sheets: vec![domain_types::SheetData {
            name: "Sheet1".to_string(),
            rows: 2,
            cols: 2,
            cells: vec![domain_types::CellData {
                row: 0,
                col: 1,
                value: number(12.0),
                ..Default::default()
            }],
            authored_style_runs: vec![AuthoredStyleRun {
                start_row: 0,
                start_col: 0,
                end_row: 1,
                end_col: 1,
                style_id: 1,
            }],
            ..Default::default()
        }],
        ..Default::default()
    }
}

fn imported_cell_xf_lineage_output() -> domain_types::ParseOutput {
    let imported_bold = DocumentFormat {
        font: Some(domain_types::FontFormat {
            bold: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    };
    let mut raw = xlsx_parser::domain::styles::write::StylesWriter::with_defaults();
    let bold_font_id = raw.add_font(ooxml_types::styles::FontDef {
        bold: Some(true),
        ..raw.fonts[0].clone()
    });
    raw.cell_xfs.push(ooxml_types::styles::CellXfDef {
        num_fmt_id: Some(0),
        font_id: Some(bold_font_id),
        fill_id: Some(0),
        border_id: Some(0),
        xf_id: Some(0),
        apply_font: Some(true),
        ..Default::default()
    });

    domain_types::ParseOutput {
        style_palette: vec![DocumentFormat::default(), imported_bold.clone()],
        workbook_stylesheet: Some(domain_types::WorkbookStylesheet {
            number_formats: raw.num_fmts,
            fonts: raw.fonts,
            fills: raw.fills,
            borders: raw.borders,
            cell_style_xfs: raw.cell_style_xfs,
            cell_xfs: raw.cell_xfs,
            cell_xf_lineage: vec![DocumentFormat::default(), imported_bold],
            named_cell_styles: raw.cell_styles,
            ..Default::default()
        }),
        sheets: vec![domain_types::SheetData {
            name: "Sheet1".to_string(),
            rows: 1,
            cols: 1,
            cells: vec![domain_types::CellData {
                row: 0,
                col: 0,
                value: number(1.0),
                style_id: Some(1),
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    }
}

#[test]
fn authored_style_runs_hydrate_as_format_ranges_without_blank_cells() {
    let output = authored_style_run_output();
    let (engine, sheet_id) = engine_from_parse_output(&output);
    let sheet_store = engine.cell_store.get_sheet(&sheet_id).expect("sheet store");

    assert_eq!(sheet_store.cells().count(), 1);
    assert_eq!(sheet_store.format_ranges().len(), 1);

    let positional = crate::storage::properties::get_positional_format(
        &engine.stores.storage,
        &sheet_id,
        1,
        0,
        engine.grid_index(&sheet_id),
        Some(sheet_store),
    );
    assert_eq!(positional.background_color.as_deref(), Some("#FFEE00"));

    let mut palette = Vec::new();
    let palette = LocalPalette::from_vec(&mut palette);
    let cells = export_cells_for_sheet(&engine.stores, &engine.cell_store, &sheet_id, &palette);
    assert_eq!(
        cells.len(),
        1,
        "format ranges should not emit styled blank cells"
    );
    assert!(
        cells.iter().all(|cell| (cell.row, cell.col) != (0, 0)),
        "authored style run coverage should not materialize A1 as a blank cell"
    );
    let value_cell = cells
        .iter()
        .find(|cell| cell.row == 0 && cell.col == 1)
        .expect("overlapping value cell should export");
    assert_eq!(value_cell.style_id, Some(1));

    let exported_runs = export_authored_style_runs_for_sheet(
        &engine.stores,
        &engine.cell_store,
        &sheet_id,
        &palette,
    );
    assert_eq!(exported_runs, output.sheets[0].authored_style_runs);
}

#[test]
fn mutated_row_and_col_formats_use_authored_palette_ids() {
    let output = domain_types::ParseOutput {
        sheets: vec![domain_types::SheetData {
            name: "Sheet1".to_string(),
            rows: 4,
            cols: 4,
            cells: vec![domain_types::CellData {
                row: 0,
                col: 0,
                value: number(1.0),
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    };
    let (mut engine, sheet_id) = engine_from_parse_output(&output);

    engine
        .set_row_format(
            &sheet_id,
            2,
            CellFormat {
                bold: Some(true),
                ..Default::default()
            },
        )
        .expect("set row format");
    engine
        .set_col_format(
            &sheet_id,
            1,
            CellFormat {
                background_color: Some("#FFEE00".to_string()),
                pattern_type: Some(ooxml_types::styles::PatternType::Solid),
                ..Default::default()
            },
        )
        .expect("set col format");

    let exported = engine.build_parse_output().expect("export projection");
    assert_eq!(exported.style_palette.len(), 3);
    assert_eq!(exported.sheets[0].row_styles[0].style_id, 1);
    assert_eq!(exported.sheets[0].col_styles[0].style_id, 2);
}

#[test]
fn imported_cell_xf_lineage_survives_native_storage_and_live_edits_use_generated_tail() {
    let source = imported_cell_xf_lineage_output();
    let original_xfs = source
        .workbook_stylesheet
        .as_ref()
        .unwrap()
        .cell_xfs
        .clone();
    let (mut engine, sheet_id) = engine_from_parse_output(&source);

    let pristine = engine.build_parse_output().expect("export projection");
    assert_eq!(pristine.sheets[0].cells[0].style_id, Some(1));
    assert_eq!(
        pristine
            .workbook_stylesheet
            .as_ref()
            .unwrap()
            .cell_xf_lineage,
        source.style_palette
    );

    let cell_id = engine
        .cell_store()
        .get_sheet(&sheet_id)
        .unwrap()
        .cell_id_at(SheetPos::new(0, 0))
        .expect("A1 identity");
    engine
        .set_cell_format(
            &sheet_id,
            &cell_id,
            &CellFormat {
                bold: Some(true),
                ..Default::default()
            },
        )
        .expect("re-author the effective imported format");

    let edited = engine.build_parse_output().expect("export projection");
    assert_eq!(edited.sheets[0].cells[0].style_id, Some(2));
    assert_eq!(edited.style_palette.len(), 3);
    assert_ne!(
        edited.style_palette[1], edited.style_palette[2],
        "edited XFs snapshot the full effective cascade instead of reusing the sparse imported semantic entry"
    );
    let edited_font = edited.style_palette[2]
        .font
        .as_ref()
        .expect("generated effective font");
    assert_eq!(edited_font.name.as_deref(), Some("Calibri"));
    assert_eq!(edited_font.bold, Some(true));
    assert_eq!(
        edited.style_palette[2]
            .fill
            .as_ref()
            .and_then(|fill| fill.pattern_type.as_deref()),
        Some("none")
    );
    assert_eq!(
        edited.workbook_stylesheet.as_ref().unwrap().cell_xfs,
        original_xfs,
        "raw imported XFs are immutable lineage records"
    );

    let bytes = engine
        .export_to_xlsx_bytes()
        .expect("export edited workbook");
    let sheet_xml = xlsx_parser::zip::XlsxArchive::new(&bytes)
        .unwrap()
        .read_file("xl/worksheets/sheet1.xml")
        .map(String::from_utf8)
        .unwrap()
        .unwrap();
    assert!(sheet_xml.contains(r#"<c r="A1" s="2""#), "{sheet_xml}");
}

#[test]
fn inline_cell_xfs_snapshot_inherited_row_and_column_fills_and_explicit_no_fill() {
    let output = domain_types::ParseOutput {
        sheets: vec![domain_types::SheetData {
            name: "Sheet1".to_string(),
            rows: 2,
            cols: 3,
            cells: vec![
                domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: number(1.0),
                    ..Default::default()
                },
                domain_types::CellData {
                    row: 1,
                    col: 1,
                    value: number(2.0),
                    ..Default::default()
                },
                domain_types::CellData {
                    row: 0,
                    col: 2,
                    value: number(3.0),
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    };
    let (mut engine, sheet_id) = engine_from_parse_output(&output);
    let cell_id_at = |engine: &ComputeEngine, row, col| {
        engine
            .cell_store()
            .get_sheet(&sheet_id)
            .unwrap()
            .cell_id_at(SheetPos::new(row, col))
            .expect("cell identity")
    };
    let a1_id = cell_id_at(&engine, 0, 0);
    let b2_id = cell_id_at(&engine, 1, 1);
    let c1_id = cell_id_at(&engine, 0, 2);

    // A background-color shorthand is a solid fill after the cascade resolves.
    engine
        .set_row_format(
            &sheet_id,
            0,
            CellFormat {
                background_color: Some("#FF0000".to_string()),
                ..Default::default()
            },
        )
        .expect("set row fill");
    engine
        .set_col_format(
            &sheet_id,
            1,
            CellFormat {
                background_color: Some("#0000FF".to_string()),
                ..Default::default()
            },
        )
        .expect("set column fill");
    engine
        .set_cell_format(
            &sheet_id,
            &a1_id,
            &CellFormat {
                bold: Some(true),
                ..Default::default()
            },
        )
        .expect("set sparse A1 format");
    engine
        .set_cell_format(
            &sheet_id,
            &b2_id,
            &CellFormat {
                italic: Some(true),
                ..Default::default()
            },
        )
        .expect("set sparse B2 format");
    engine
        .set_cell_format(
            &sheet_id,
            &c1_id,
            &CellFormat {
                pattern_type: Some(ooxml_types::styles::PatternType::None),
                ..Default::default()
            },
        )
        .expect("set explicit C1 no-fill");

    let exported = engine.build_parse_output().expect("export projection");
    let format_at = |row, col| {
        let style_id = exported.sheets[0]
            .cells
            .iter()
            .find(|cell| (cell.row, cell.col) == (row, col))
            .and_then(|cell| cell.style_id)
            .expect("generated cell style");
        &exported.style_palette[style_id as usize]
    };
    let a1_fill = format_at(0, 0).fill.as_ref().expect("A1 effective fill");
    assert_eq!(a1_fill.background_color.as_deref(), Some("#FF0000"));
    assert_eq!(a1_fill.pattern_type.as_deref(), Some("solid"));
    let b2_fill = format_at(1, 1).fill.as_ref().expect("B2 effective fill");
    assert_eq!(b2_fill.background_color.as_deref(), Some("#0000FF"));
    assert_eq!(b2_fill.pattern_type.as_deref(), Some("solid"));
    let c1_fill = format_at(0, 2).fill.as_ref().expect("C1 explicit no-fill");
    assert_eq!(c1_fill.background_color, None);
    assert_eq!(c1_fill.pattern_type.as_deref(), Some("none"));

    let bytes = engine.export_to_xlsx_bytes().expect("export XLSX");
    let (reimported, _) = ComputeEngine::from_xlsx_bytes(&bytes).expect("reimport XLSX");
    let reimported_sheet_id = reimported.stores.storage.sheet_order()[0];
    let reimported_format_at = |row, col| {
        let cell_id = reimported
            .cell_store()
            .get_sheet(&reimported_sheet_id)
            .unwrap()
            .cell_id_at(SheetPos::new(row, col))
            .expect("reimported cell identity");
        reimported.get_cell_format(&reimported_sheet_id, &cell_id, row, col)
    };

    let a1 = reimported_format_at(0, 0);
    assert_eq!(a1.background_color.as_deref(), Some("#FF0000"));
    assert_eq!(
        a1.pattern_type,
        Some(ooxml_types::styles::PatternType::Solid)
    );
    let b2 = reimported_format_at(1, 1);
    assert_eq!(b2.background_color.as_deref(), Some("#0000FF"));
    assert_eq!(
        b2.pattern_type,
        Some(ooxml_types::styles::PatternType::Solid)
    );
    let c1 = reimported_format_at(0, 2);
    assert_eq!(c1.background_color, None);
    assert_eq!(
        c1.pattern_type,
        Some(ooxml_types::styles::PatternType::None)
    );
}

#[test]
fn imported_style_only_blank_cells_do_not_export_as_cells() {
    let sheet_id = SheetId::from_raw(103);
    let blank_cell_id = CellId::from_raw(203);
    let mut props = FxHashMap::default();
    props.insert(
        blank_cell_id,
        CellProperties {
            format: None,
            style_id: Some(15),
            ..Default::default()
        },
    );
    let array_refs = FxHashMap::default();
    let formula_metadata = FxHashMap::default();
    let rich_strings = FxHashMap::default();
    let mut palette = Vec::new();
    let palette = LocalPalette::from_vec(&mut palette);
    let (engine, _) = ComputeEngine::from_snapshot(workbook(&sheet_id, vec![])).expect("engine");

    let exported = build_cell_data_for_cell_id(
        &engine.stores,
        &engine.cell_store,
        &sheet_id,
        &blank_cell_id,
        1,
        55,
        &props,
        &array_refs,
        &formula_metadata,
        &rich_strings,
        &palette,
        false,
    );

    assert!(
        exported.is_none(),
        "imported style metadata alone should remain range/style metadata, not a physical blank cell"
    );
}

#[test]
fn explicit_blank_cell_export_ignores_col_data_effective_value() {
    let sheet_id = SheetId::from_raw(104);
    let blank_cell_id = CellId::from_raw(204);
    let (mut engine, _) =
        ComputeEngine::from_snapshot(workbook(&sheet_id, vec![])).expect("engine should build");
    engine
        .cell_store
        .register_identity_only(&sheet_id, SheetPos::new(0, 0), blank_cell_id);
    engine
        .cell_store
        .get_sheet_mut(&sheet_id)
        .expect("sheet store")
        .generated_values
        .insert(SheetPos::new(0, 0), number(88.0));

    assert_eq!(
        engine
            .cell_store
            .get_cell_value_in_sheet(&sheet_id, &blank_cell_id)
            .cloned(),
        Some(number(88.0)),
        "effective reads should still see the materialized col_data value"
    );

    let props = FxHashMap::default();
    let array_refs = FxHashMap::default();
    let formula_metadata = FxHashMap::default();
    let rich_strings = FxHashMap::default();
    let mut palette = Vec::new();
    let palette = LocalPalette::from_vec(&mut palette);
    let exported = build_cell_data_for_cell_id(
        &engine.stores,
        &engine.cell_store,
        &sheet_id,
        &blank_cell_id,
        0,
        0,
        &props,
        &array_refs,
        &formula_metadata,
        &rich_strings,
        &palette,
        true,
    )
    .expect("explicit blank should export when preserve_blank is set");

    assert!(
        exported.value.is_null(),
        "authored blank cell export must not serialize the materialized col_data value"
    );
}

#[test]
fn xlsx_import_rebuild_hydrates_authored_style_ranges() {
    let output = authored_style_run_output();
    let source_xlsx = xlsx_parser::write::write_xlsx_from_parse_output(&output)
        .expect("source XLSX should be writable");
    let bootstrap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: "00000000-0000-4000-8000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 1,
            cols: 1,
            cells: vec![],
            ranges: vec![],
        }],
        ..WorkbookSnapshot::default()
    };
    let (mut engine, _) = ComputeEngine::from_snapshot(bootstrap).expect("bootstrap engine");

    engine
        .import_from_xlsx_bytes_no_recalc(&source_xlsx)
        .expect("import XLSX");

    let exported = engine.build_parse_output().expect("export projection");
    let runs = &exported.sheets[0].authored_style_runs;
    assert!(
        runs.iter()
            .any(|run| run.start_row == 0 && run.start_col == 0),
        "styled blank coverage should survive XLSX import rebuild"
    );
}

#[test]
fn cached_shared_string_metadata_survives_hydration_export() {
    let output = metadata_only_shared_string_output();
    let (engine, sheet_id) = engine_from_parse_output(&output);

    let mut palette = Vec::new();
    let palette = LocalPalette::from_vec(&mut palette);
    let cells = export_cells_for_sheet(&engine.stores, &engine.cell_store, &sheet_id, &palette);
    let exported = cells
        .iter()
        .find(|cell| cell.row == 0 && cell.col == 0)
        .expect("A1 should export");

    assert_eq!(exported.original_sst_index, Some(7));
    assert_eq!(exported.original_value.as_deref(), Some("7"));
}

#[test]
fn spill_target_metadata_identity_does_not_author_cached_value() {
    let source = domain_types::CellData {
        row: 0,
        col: 0,
        value: number(1.0),
        formula: Some("SEQUENCE(1,2)".to_string()),
        cell_metadata_index: Some(1),
        projection_role: domain_types::ImportedCellProjectionRole::DynamicArraySource,
        ..Default::default()
    };
    let spill = domain_types::CellData {
        row: 0,
        col: 1,
        value: number(2.0),
        cell_metadata_index: Some(1),
        original_value: Some("2".to_string()),
        projection_role: domain_types::ImportedCellProjectionRole::DynamicArraySpillTarget,
        ..Default::default()
    };
    let output = domain_types::ParseOutput {
        sheets: vec![domain_types::SheetData {
            name: "Sheet1".to_string(),
            rows: 1,
            cols: 2,
            cells: vec![source, spill.clone()],
            ..Default::default()
        }],
        ..Default::default()
    };

    let (engine, sheet_id) = engine_from_parse_output(&output);
    let grid = engine
        .cell_store()
        .get_sheet(&sheet_id)
        .expect("grid index");
    let (spill_id, _, _) = grid
        .cells()
        .find(|(_, row, col)| *row == 0 && *col == 1)
        .expect("spill metadata retains a positional identity");
    let sheet = engine.cell_store.get_sheet(&sheet_id).expect("sheet store");
    assert!(
        sheet.is_ghost(&spill_id),
        "metadata identity must not become an authored spill blocker"
    );

    let exported = engine.build_parse_output().expect("export projection");
    let cells = &exported.sheets[0].cells;
    assert!(cells.iter().any(|cell| (cell.row, cell.col) == (0, 0)));
    assert!(
        cells
            .iter()
            .filter(|cell| (cell.row, cell.col) == (0, 1))
            .all(|cell| cell.value.is_null() && cell.formula.is_none()),
        "an unowned spill cache must not become an authored value or formula"
    );
}

#[test]
fn original_sst_metadata_survives_l2_import_export() {
    let input = empty_shared_string_source_xlsx();
    let (engine, _) = ComputeEngine::from_xlsx_bytes(&input).expect("import XLSX");

    let output = engine
        .export_to_xlsx_bytes()
        .expect("export_to_xlsx_bytes should succeed");
    let archive = xlsx_parser::XlsxArchive::new(&output).expect("exported XLSX archive");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(
        sheet_xml.contains(r#"<c r="A1" t="s"><v>0</v></c>"#),
        "empty shared-string cell should retain its SST reference; got: {sheet_xml}"
    );
    assert!(
        !sheet_xml.contains(r#"<c r="A1" t="s"/>"#),
        "empty shared-string cell must not regress to a self-closing t=\"s\" cell"
    );
}

#[test]
fn edited_formula_export_does_not_replay_stale_shared_group_metadata() {
    let output = domain_types::ParseOutput {
        sheets: vec![domain_types::SheetData {
            name: "Sheet1".to_string(),
            rows: 2,
            cols: 1,
            cells: vec![domain_types::CellData {
                row: 0,
                col: 0,
                value: number(10.0),
                formula: Some("SUM(A2:A10)".to_string()),
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    };
    let (mut engine, sheet_id) = engine_from_parse_output(&output);
    let cell_id = engine
        .cell_store()
        .get_sheet(&sheet_id)
        .and_then(|grid| {
            grid.cells()
                .find_map(|(cell_id, row, col)| (row == 0 && col == 0).then_some(cell_id))
        })
        .expect("A1 cell id");

    engine
        .set_cell(
            &sheet_id,
            cell_id,
            0,
            0,
            crate::bridge_types::CellInput::Parse {
                text: "=SUM(B2:B10)".into(),
            },
        )
        .expect("formula edit should succeed");

    let xlsx = engine
        .export_to_xlsx_bytes()
        .expect("export_to_xlsx_bytes should succeed");
    let archive = xlsx_parser::XlsxArchive::new(&xlsx).expect("exported XLSX archive");
    xlsx_parser::infra::package_integrity::validate_archive_package_integrity(&archive)
        .expect("exported package should be valid");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("<f>SUM(B2:B10)</f>"));
    assert!(!sheet_xml.contains(r#"t="shared""#));
    assert!(!sheet_xml.contains(r#"si="7""#));
    assert!(!sheet_xml.contains(r#"ref="A1:A2""#));
    assert!(!sheet_xml.contains(r#"ca="1""#));
    assert!(!sheet_xml.contains(r#"xml:space="preserve""#));
}

#[test]
fn edited_formula_export_does_not_replay_stale_array_group_metadata() {
    let output = domain_types::ParseOutput {
        sheets: vec![domain_types::SheetData {
            name: "Sheet1".to_string(),
            rows: 2,
            cols: 1,
            cells: vec![domain_types::CellData {
                row: 0,
                col: 0,
                value: number(10.0),
                formula: Some("SUM(A2:A10)".to_string()),
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    };
    let (mut engine, sheet_id) = engine_from_parse_output(&output);
    let cell_id = engine
        .cell_store()
        .get_sheet(&sheet_id)
        .and_then(|grid| {
            grid.cells()
                .find_map(|(cell_id, row, col)| (row == 0 && col == 0).then_some(cell_id))
        })
        .expect("A1 cell id");

    engine
        .set_cell(
            &sheet_id,
            cell_id,
            0,
            0,
            crate::bridge_types::CellInput::Parse {
                text: "=SUM(B2:B10)".into(),
            },
        )
        .expect("formula edit should succeed");

    let xlsx = engine
        .export_to_xlsx_bytes()
        .expect("export_to_xlsx_bytes should succeed");
    let archive = xlsx_parser::XlsxArchive::new(&xlsx).expect("exported XLSX archive");
    xlsx_parser::infra::package_integrity::validate_archive_package_integrity(&archive)
        .expect("exported package should be valid");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("<f>SUM(B2:B10)</f>"));
    assert!(!sheet_xml.contains(r#"t="array""#));
    assert!(!sheet_xml.contains(r#"ref="A1:A2""#));
    assert!(!sheet_xml.contains(r#"aca="1""#));
    assert!(!sheet_xml.contains(r#"ca="1""#));
}

fn one_value_pivot_result(value: CellValue) -> PivotTableResult {
    PivotTableResult {
        column_headers: vec![],
        rows: vec![PivotRow {
            key: "east".to_string(),
            headers: vec![PivotHeader {
                key: "east".to_string(),
                value: CellValue::Text("East".into()),
                field_id: FieldId::from("region"),
                depth: 0,
                span: 1,
                is_expandable: false,
                is_expanded: true,
                is_subtotal: false,
                is_grand_total: false,
                parent_key: None,
                child_keys: None,
            }],
            values: vec![value],
            depth: 0,
            is_subtotal: false,
            is_grand_total: false,
            source_row_indices: None,
        }],
        grand_totals: PivotGrandTotals {
            row: None,
            column: None,
            grand: None,
            row_label: None,
        },
        rendered_bounds: PivotRenderedBounds {
            total_rows: 2,
            total_cols: 2,
            first_data_row: 1,
            first_data_col: 1,
            num_data_cols: 1,
        },
        source_row_count: 1,
        measure_descriptors: vec![],
        value_records: vec![],
        errors: None,
    }
}

fn register_rendered_pivot(engine: &mut ComputeEngine, sheet_id: &SheetId, value: CellValue) {
    let result = one_value_pivot_result(value);
    engine
        .cell_store
        .materialize_pivot(sheet_id, 0, 0, &result, &["Region".to_string()]);
    engine.cell_store.upsert_pivot_table_def(PivotTableDef {
        grand_total_cells: Vec::new(),
        id: "pivot-1".to_string(),
        name: "Pivot1".to_string(),
        sheet: sheet_id.to_uuid_string(),
        start_row: 0,
        start_col: 0,
        end_row: 1,
        end_col: 1,
        rendered_rows: Some(2),
        rendered_cols: Some(2),
        first_data_row: 1,
        first_data_col: 1,
        data_field_names: vec!["Sum of Sales".to_string()],
        cache_field_names: vec!["Region".to_string(), "Sales".to_string()],
        row_field_indices: vec![0],
        col_field_indices: vec![],
        data_on_rows: false,
        style: None,
        show_row_grand_totals: None,
        show_column_grand_totals: None,
    });
}

#[test]
fn export_cells_includes_pivot_overlay_without_grid_index() {
    let sheet_id = SheetId::from_raw(100);
    let (mut engine, _) =
        ComputeEngine::from_snapshot(workbook(&sheet_id, vec![])).expect("engine");
    register_rendered_pivot(&mut engine, &sheet_id, number(10.0));
    engine.stores.grid_indexes.remove(&sheet_id);

    let mut palette = Vec::new();
    let palette = LocalPalette::from_vec(&mut palette);
    let cells = export_cells_for_sheet(&engine.stores, &engine.cell_store, &sheet_id, &palette);

    assert!(
        cells
            .iter()
            .any(|cell| cell.row == 1 && cell.col == 1 && cell.value == number(10.0)),
        "pivot materialized value should export even when the sheet has no grid index"
    );
}

#[test]
fn export_cells_preserves_explicit_cell_over_pivot_overlay() {
    let sheet_id = SheetId::from_raw(101);
    let explicit_cell_id = cell_types::CellId::from_raw(201);
    let (mut engine, _) = ComputeEngine::from_snapshot(workbook(
        &sheet_id,
        vec![snapshot_types::CellData {
            cell_id: explicit_cell_id.to_uuid_string(),
            row: 1,
            col: 1,
            value: number(99.0),
            formula: None,
            identity_formula: None,
            array_ref: None,
        }],
    ))
    .expect("engine");
    register_rendered_pivot(&mut engine, &sheet_id, number(10.0));

    let mut palette = Vec::new();
    let palette = LocalPalette::from_vec(&mut palette);
    let cells = export_cells_for_sheet(&engine.stores, &engine.cell_store, &sheet_id, &palette);
    let exported = cells
        .iter()
        .find(|cell| cell.row == 1 && cell.col == 1)
        .expect("explicit pivot-overlap cell should export");

    assert_eq!(exported.value, number(99.0));
}

#[test]
fn export_cells_does_not_emit_empty_pivot_overlay_at_origin() {
    let sheet_id = SheetId::from_raw(102);
    let (mut engine, _) =
        ComputeEngine::from_snapshot(workbook(&sheet_id, vec![])).expect("engine");
    let result = one_value_pivot_result(number(10.0));
    engine
        .cell_store
        .materialize_pivot(&sheet_id, 0, 0, &result, &["Region".to_string()]);
    engine.cell_store.upsert_pivot_table_def(PivotTableDef {
        grand_total_cells: Vec::new(),
        id: "empty-pivot".to_string(),
        name: "EmptyPivot".to_string(),
        sheet: sheet_id.to_uuid_string(),
        start_row: 0,
        start_col: 0,
        end_row: 0,
        end_col: 0,
        rendered_rows: Some(0),
        rendered_cols: Some(0),
        first_data_row: 0,
        first_data_col: 0,
        data_field_names: vec![],
        cache_field_names: vec![],
        row_field_indices: vec![],
        col_field_indices: vec![],
        data_on_rows: false,
        style: None,
        show_row_grand_totals: None,
        show_column_grand_totals: None,
    });
    engine.stores.grid_indexes.remove(&sheet_id);

    let mut palette = Vec::new();
    let palette = LocalPalette::from_vec(&mut palette);
    let cells = export_cells_for_sheet(&engine.stores, &engine.cell_store, &sheet_id, &palette);

    assert!(
        cells
            .iter()
            .all(|cell| cell.row != 0 || cell.col != 0 || cell.value.is_null()),
        "empty pivot bounds must not export a phantom A1 overlay"
    );
}

#[test]
fn native_cell_metadata_is_sparse_and_survives_copy_and_authored_replacement() {
    let rich = domain_types::RichSharedString {
        plain_text: "Hello".to_string(),
        runs: vec![domain_types::RichTextRun {
            text: "Hello".to_string(),
            bold: true,
            ..Default::default()
        }],
        ..Default::default()
    };
    let output = domain_types::ParseOutput {
        sheets: vec![domain_types::SheetData {
            name: "Metadata".to_string(),
            rows: 4,
            cols: 4,
            cells: vec![
                domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: number(7.0),
                    ..Default::default()
                },
                domain_types::CellData {
                    row: 0,
                    col: 1,
                    value: number(8.0),
                    formula: Some("A1+1".to_string()),
                    cell_formula: Some(ooxml_types::worksheet::CellFormula {
                        text: "A1+1".to_string(),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                domain_types::CellData {
                    row: 0,
                    col: 2,
                    value: CellValue::Text("Hello".into()),
                    rich_string: Some(rich.clone()),
                    ..Default::default()
                },
                domain_types::CellData {
                    row: 0,
                    col: 3,
                    value: number(7.0),
                    formula: Some("A1".to_string()),
                    array_ref: Some("D1:D2".to_string()),
                    cell_formula: Some(ooxml_types::worksheet::CellFormula {
                        text: "A1".to_string(),
                        t: ooxml_types::worksheet::CellFormulaType::Array,
                        r#ref: Some("D1:D2".to_string()),
                        aca: true,
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    };
    let (mut engine, sheet_id) = engine_from_parse_output(&output);
    assert_eq!(
        engine.stores.storage.cell_metadata.len(),
        3,
        "imported formulas retain their declared result mode alongside rich text and arrays"
    );
    let ordinary_value_id = engine
        .cell_store
        .resolve_cell_id(&sheet_id, SheetPos::new(0, 0))
        .unwrap();
    assert!(
        engine
            .stores
            .storage
            .cell_metadata(&ordinary_value_id)
            .is_none()
    );
    let ordinary_formula_id = engine
        .cell_store
        .resolve_cell_id(&sheet_id, SheetPos::new(0, 1))
        .unwrap();
    assert_eq!(
        engine
            .stores
            .storage
            .cell_metadata(&ordinary_formula_id)
            .unwrap()
            .formula_result_mode,
        Some(crate::cells::cell_metadata::FormulaResultMode::LegacyScalar),
    );
    // Authored replacement discards the imported declaration even when formula
    // text is unchanged. Ordinary authored formulas retain the native sparse
    // representation, and copies must not resurrect their import metadata.
    engine
        .set_cell_value_parsed(&sheet_id, 0, 1, "=A1+1")
        .unwrap();
    assert!(
        engine
            .stores
            .storage
            .cell_metadata(&ordinary_formula_id)
            .is_none()
    );
    assert_eq!(engine.get_cell_value(&sheet_id, 0, 1), number(8.0));
    assert_eq!(engine.stores.storage.cell_metadata.len(), 2);
    let original_rich_id = engine
        .cell_store
        .resolve_cell_id(&sheet_id, SheetPos::new(0, 2))
        .unwrap();
    let (copied_id, _) = engine.copy_sheet(&sheet_id, "Copy").unwrap();
    let copied_id = SheetId::from_uuid_str(&copied_id).unwrap();
    let copied_rich_id = engine
        .cell_store
        .resolve_cell_id(&copied_id, SheetPos::new(0, 2))
        .unwrap();
    assert_ne!(original_rich_id, copied_rich_id);
    assert_eq!(engine.stores.storage.cell_metadata.len(), 4);
    assert_eq!(
        engine
            .stores
            .storage
            .cell_metadata(&copied_rich_id)
            .unwrap()
            .rich_string
            .as_ref(),
        Some(&rich)
    );

    engine
        .set_cell_value_parsed(&sheet_id, 0, 2, "Plain")
        .unwrap();
    engine.clear_range(&sheet_id, 0, 3, 1, 3).unwrap();
    assert!(
        engine
            .stores
            .storage
            .cell_metadata(&original_rich_id)
            .is_none()
    );
    assert_eq!(
        engine.stores.storage.cell_metadata.len(),
        2,
        "only copied cell metadata remains after replacing/clearing originals"
    );
    let exported = engine.build_parse_output().expect("export projection");
    let original = exported
        .sheets
        .iter()
        .find(|s| s.name == "Metadata")
        .unwrap();
    let edited = original
        .cells
        .iter()
        .find(|c| (c.row, c.col) == (0, 2))
        .unwrap();
    assert_eq!(edited.value, CellValue::Text("Plain".into()));
    assert!(edited.rich_string.is_none());
    assert!(
        !original
            .cells
            .iter()
            .any(|c| c.col == 3 && c.array_ref.is_some())
    );
    let copied = exported.sheets.iter().find(|s| s.name == "Copy").unwrap();
    assert_eq!(
        copied
            .cells
            .iter()
            .find(|c| (c.row, c.col) == (0, 2))
            .unwrap()
            .rich_string
            .as_ref(),
        Some(&rich)
    );
    let array = copied
        .cells
        .iter()
        .find(|c| (c.row, c.col) == (0, 3))
        .unwrap();
    assert_eq!(array.array_ref.as_deref(), Some("D1:D2"));
    assert!(array.cell_formula.as_ref().unwrap().aca);
    let bytes = engine.export_to_xlsx_bytes().unwrap();
    let (reloaded, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let reexported = reloaded.build_parse_output().expect("export projection");
    let copied = reexported.sheets.iter().find(|s| s.name == "Copy").unwrap();
    assert_eq!(
        copied
            .cells
            .iter()
            .find(|c| (c.row, c.col) == (0, 2))
            .unwrap()
            .rich_string
            .as_ref(),
        Some(&rich)
    );
    assert_eq!(
        copied
            .cells
            .iter()
            .find(|c| (c.row, c.col) == (0, 3))
            .unwrap()
            .array_ref
            .as_deref(),
        Some("D1:D2")
    );
}

//! Group 11: XLSX export round-trip.

use super::super::*;
use super::helpers::*;
use crate::snapshot::{
    CellData, DataTableOoxmlFlags, DataTableRegionDef, RangeData, SheetSnapshot,
};
use cell_types::{ColId, PayloadEncoding, RangeAnchor, RangeId, RangeKind, RowId};
use domain_types::{
    AutoFilter, ParseOutput, SheetData, SheetDimensions, SortCondition, SortConditionBy, SortState,
    domain::comment::{Comment, CommentType, PersonInfo},
    domain::external_link::{ExternalLink, ImportedExternalLinkIdentity},
    domain::workbook::{WorkbookView, WorkbookViewVisibility, WorkbookWebPublishing},
};
use formula_types::CellRef;
use std::sync::Arc;
use value_types::{CellValue, FiniteF64};

fn worksheet_sort_state() -> SortState {
    SortState {
        range_ref: "A25:AR27".to_string(),
        conditions: vec![SortCondition {
            range_ref: "E25:E27".to_string(),
            descending: true,
            ..Default::default()
        }],
        ..Default::default()
    }
}

fn nested_auto_filter_sort_state() -> SortState {
    SortState {
        range_ref: "A1:B10".to_string(),
        conditions: vec![SortCondition {
            range_ref: "B2:B10".to_string(),
            sort_by: SortConditionBy::CellColor,
            dxf_id: Some(2),
            ..Default::default()
        }],
        ..Default::default()
    }
}

fn worksheet_sort_state_parse_output(include_nested_auto_filter_sort: bool) -> ParseOutput {
    let auto_filter = include_nested_auto_filter_sort.then(|| AutoFilter {
        range_ref: "A1:B10".to_string(),
        columns: Vec::new(),
        sort: Some(nested_auto_filter_sort_state()),
        xr_uid: None,
        ext_lst_raw: None,
    });

    ParseOutput {
        sheets: vec![SheetData {
            name: "SortState".to_string(),
            rows: 30,
            cols: 44,
            cells: Vec::new(),
            dimensions: SheetDimensions::default(),
            auto_filter,
            sort_state: Some(worksheet_sort_state()),
            ..Default::default()
        }],
        ..Default::default()
    }
}

fn archive_entry_names(bytes: &[u8]) -> Vec<String> {
    xlsx_parser::zip::XlsxArchive::new(bytes)
        .expect("exported XLSX should be readable")
        .entries()
        .iter()
        .map(|entry| entry.name.clone())
        .collect()
}

fn assert_substrings_in_order(haystack: &str, needles: &[&str]) {
    let mut offset = 0;
    for needle in needles {
        let Some(relative_index) = haystack[offset..].find(needle) else {
            panic!("expected to find {needle:?} after byte offset {offset}");
        };
        offset += relative_index + needle.len();
    }
}

fn assert_archive_has_entry_prefix(bytes: &[u8], prefix: &str) {
    let names = archive_entry_names(bytes);
    assert!(
        names.iter().any(|name| name.starts_with(prefix)),
        "expected an XLSX part under {prefix}; entries were {names:?}"
    );
}

fn assert_archive_has_no_entry_prefix(bytes: &[u8], prefix: &str) {
    let names = archive_entry_names(bytes);
    assert!(
        names.iter().all(|name| !name.starts_with(prefix)),
        "no XLSX part under {prefix} should remain; entries were {names:?}"
    );
}

fn picture_source_xlsx() -> Vec<u8> {
    let (mut source, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let source_sheet_id = sheet_id();
    let picture_config = serde_json::json!({
        "type": "picture",
        "src": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
        "anchor": {
            "anchorRow": 0,
            "anchorCol": 0,
            "anchorRowOffsetEmu": 0,
            "anchorColOffsetEmu": 0,
            "anchorMode": "oneCell",
            "extentCxEmu": 1905000,
            "extentCyEmu": 1428750
        },
        "width": 200.0,
        "height": 150.0,
        "visible": true,
        "printable": true,
        "flipH": false,
        "flipV": false,
        "opacity": 1.0,
        "rotation": 0.0,
        "name": "Owned Picture"
    });
    source
        .create_floating_object(&source_sheet_id, &picture_config)
        .expect("picture creation should succeed");
    source
        .export_to_xlsx_bytes()
        .expect("source workbook with picture should export")
}

fn form_control_object(
    id: &str,
    shape_id: u32,
    name: &str,
    z_index: i32,
) -> domain_types::domain::floating_object::FloatingObject {
    use domain_types::domain::floating_object::{
        AnchorMode, FloatingObject, FloatingObjectAnchor, FloatingObjectCommon, FloatingObjectData,
        FormControlData, FormControlOoxmlProps,
    };

    FloatingObject {
        common: FloatingObjectCommon {
            id: id.to_string(),
            sheet_id: "sheet-before-hydration".to_string(),
            anchor: FloatingObjectAnchor {
                anchor_mode: AnchorMode::TwoCell,
                anchor_row: z_index as u32,
                anchor_col: 0,
                end_row: Some(z_index as u32 + 1),
                end_col: Some(2),
                ..Default::default()
            },
            width: 120.0,
            height: 30.0,
            z_index,
            name: name.to_string(),
            ..Default::default()
        },
        data: FloatingObjectData::FormControl(FormControlData {
            control_type: "Button".to_string(),
            cell_link: None,
            input_range: None,
            ooxml: Some(FormControlOoxmlProps {
                shape_id,
                anchor_source: "Modern".to_string(),
                ..Default::default()
            }),
        }),
    }
}

#[test]
fn xlsx_export_preserves_imported_form_control_order_through_yrs_storage() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Controls".to_string(),
            rows: 10,
            cols: 4,
            floating_objects: vec![
                form_control_object("fobj-fc-30", 51242, "Button 42", 0),
                form_control_object("fobj-fc-10", 51244, "Button 44", 0),
                form_control_object("fobj-fc-20", 51247, "Button 47", 0),
            ],
            ..Default::default()
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&output);
    let exported_bytes = engine.export_to_xlsx_bytes().expect("export xlsx bytes");

    let sheet_xml = archive_text(&exported_bytes, "xl/worksheets/sheet1.xml")
        .expect("worksheet XML should exist");
    assert_substrings_in_order(
        &sheet_xml,
        &[
            r#"shapeId="51242""#,
            r#"shapeId="51244""#,
            r#"shapeId="51247""#,
        ],
    );

    let vml_xml =
        archive_text(&exported_bytes, "xl/drawings/vmlDrawing1.vml").expect("VML should exist");
    assert_substrings_in_order(
        &vml_xml,
        &["_x0000_s51242", "_x0000_s51244", "_x0000_s51247"],
    );
}

fn ole_owner_parse_output() -> ParseOutput {
    use domain_types::domain::floating_object::{
        AnchorMode, FloatingObject, FloatingObjectAnchor, FloatingObjectCommon, FloatingObjectData,
        OleObjectData, OleObjectOoxmlProps, OleObjectPackageIdentity, OleObjectPreviewIdentity,
    };

    ParseOutput {
        sheets: vec![SheetData {
            name: "Ole".to_string(),
            rows: 2,
            cols: 2,
            floating_objects: vec![FloatingObject {
                common: FloatingObjectCommon {
                    id: "ole-1".to_string(),
                    sheet_id: "sheet-1".to_string(),
                    anchor: FloatingObjectAnchor {
                        anchor_mode: AnchorMode::TwoCell,
                        end_row: Some(1),
                        end_col: Some(1),
                        ..Default::default()
                    },
                    width: 120.0,
                    height: 80.0,
                    name: "Owned OLE".to_string(),
                    ..Default::default()
                },
                data: FloatingObjectData::OleObject(OleObjectData {
                    prog_id: "Package".to_string(),
                    dv_aspect: "DVASPECT_CONTENT".to_string(),
                    is_linked: false,
                    is_embedded: true,
                    preview_image_src: Some("data:image/png;base64,iVBORw0KGgo=".to_string()),
                    alt_text: Some("Owned OLE object".to_string()),
                    ooxml: Some(OleObjectOoxmlProps {
                        shape_id: 1025,
                        r_id: Some("rIdOle1".to_string()),
                        data_path: Some("xl/embeddings/oleObject1.bin".to_string()),
                        name: Some("Owned OLE".to_string()),
                        dv_aspect: "DVASPECT_CONTENT".to_string(),
                        prog_id: "Package".to_string(),
                        ole_update: "OLEUPDATE_ALWAYS".to_string(),
                        preview_image_rel_id: Some("rIdPreview1".to_string()),
                        preview_image_path: Some("xl/media/image1.png".to_string()),
                        embedding: Some(OleObjectPackageIdentity {
                            path: "xl/embeddings/oleObject1.bin".to_string(),
                            kind: "oleObject".to_string(),
                            content_type: None,
                            relationship_id: Some("rIdOle1".to_string()),
                            bytes: b"owned ole bytes".to_vec(),
                        }),
                        preview: Some(OleObjectPreviewIdentity {
                            path: "xl/media/image1.png".to_string(),
                            relationship_id: Some("rIdPreview1".to_string()),
                            bytes: vec![0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n'],
                        }),
                        vml_drawing_path: Some("xl/drawings/vmlDrawing1.vml".to_string()),
                        vml_relationship_id: Some("rIdVml1".to_string()),
                        ..Default::default()
                    }),
                }),
            }],
            ..Default::default()
        }],
        ..Default::default()
    }
}

#[test]
fn shared_string_hints_survive_yrs_hydration_export() {
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            rows: 1,
            cols: 1,
            cells: vec![domain_types::CellData {
                row: 0,
                col: 0,
                value: CellValue::Text(Arc::from("Rich")),
                original_sst_index: Some(0),
                original_value: Some("0".to_string()),
                ..Default::default()
            }],
            ..Default::default()
        }],
        shared_string_hints: vec![domain_types::SharedStringHint {
            index: 0,
            text: "Rich".to_string(),
            rich_text: Some(vec![domain_types::RichTextRun {
                text: "Rich".to_string(),
                bold: true,
                ..Default::default()
            }]),
            phonetic_xml: None,
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&input);
    let exported = engine.export_to_parse_output().unwrap().parse_output;

    assert_eq!(exported.shared_string_hints, input.shared_string_hints);
}

#[test]
fn imported_picture_survives_context_stripped_hydration_export_and_deletion_removes_parts() {
    let source_xlsx = picture_source_xlsx();
    let parsed = xlsx_api::parse(&source_xlsx)
        .expect("source XLSX should parse")
        .output;
    assert_eq!(parsed.sheets[0].floating_objects.len(), 1);

    let mut engine = engine_from_parse_output_normal(&parsed);
    let hydrated_export = engine
        .export_to_xlsx_bytes_context_stripped()
        .expect("context-stripped export should succeed");
    assert_archive_has_entry_prefix(&hydrated_export, "xl/media/");
    assert_archive_has_entry_prefix(&hydrated_export, "xl/drawings/");
    xlsx_parser::infra::package_integrity::validate_archive_package_integrity(
        &xlsx_parser::zip::XlsxArchive::new(&hydrated_export).unwrap(),
    )
    .expect("hydrated picture export package graph should be valid");

    let exported_parse = engine
        .export_to_parse_output()
        .expect("production parse output export should succeed")
        .parse_output;
    let object_id = exported_parse.sheets[0].floating_objects[0]
        .common
        .id
        .clone();
    let sheet_id_after_hydration =
        SheetId::from_uuid_str(&engine.get_all_sheet_ids()[0]).expect("valid hydrated sheet id");
    engine
        .delete_floating_object(&sheet_id_after_hydration, &object_id)
        .expect("picture owner deletion should succeed");

    let deleted_export = engine
        .export_to_xlsx_bytes_context_stripped()
        .expect("context-stripped export after deletion should succeed");
    assert_archive_has_no_entry_prefix(&deleted_export, "xl/media/");
    assert_archive_has_no_entry_prefix(&deleted_export, "xl/drawings/");
    let content_types = archive_text(&deleted_export, "[Content_Types].xml").unwrap();
    assert!(!content_types.contains("/xl/media/"));
    assert!(!content_types.contains("/xl/drawings/"));
}

#[test]
fn modeled_ole_survives_context_stripped_hydration_export_and_deletion_removes_parts() {
    let input = ole_owner_parse_output();
    let mut engine = engine_from_parse_output_normal(&input);

    let hydrated_export = engine
        .export_to_xlsx_bytes_context_stripped()
        .expect("context-stripped OLE export should succeed");
    assert_archive_has_entry_prefix(&hydrated_export, "xl/embeddings/");
    assert_archive_has_entry_prefix(&hydrated_export, "xl/drawings/");
    assert_archive_has_entry_prefix(&hydrated_export, "xl/media/");
    xlsx_parser::infra::package_integrity::validate_archive_package_integrity(
        &xlsx_parser::zip::XlsxArchive::new(&hydrated_export).unwrap(),
    )
    .expect("hydrated OLE export package graph should be valid");

    let exported_parse = engine
        .export_to_parse_output()
        .expect("production parse output export should succeed")
        .parse_output;
    let object_id = exported_parse.sheets[0].floating_objects[0]
        .common
        .id
        .clone();
    let sheet_id_after_hydration =
        SheetId::from_uuid_str(&engine.get_all_sheet_ids()[0]).expect("valid hydrated sheet id");
    engine
        .delete_floating_object(&sheet_id_after_hydration, &object_id)
        .expect("OLE owner deletion should succeed");

    let deleted_export = engine
        .export_to_xlsx_bytes_context_stripped()
        .expect("context-stripped export after OLE deletion should succeed");
    assert_archive_has_no_entry_prefix(&deleted_export, "xl/embeddings/");
    assert_archive_has_no_entry_prefix(&deleted_export, "xl/media/");
    assert_archive_has_no_entry_prefix(&deleted_export, "xl/drawings/");
    let content_types = archive_text(&deleted_export, "[Content_Types].xml").unwrap();
    assert!(!content_types.contains("/xl/embeddings/"));
    assert!(!content_types.contains("/xl/media/"));
    assert!(!content_types.contains("/xl/drawings/"));
}

#[test]
fn workbook_stylesheet_survives_yrs_hydration_export() {
    let mut input = ParseOutput::default();
    input.sheets = vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }];
    input.workbook_stylesheet = Some(domain_types::WorkbookStylesheet::from_stylesheet(
        ooxml_types::styles::Stylesheet {
            dxfs: vec![ooxml_types::styles::DxfDef {
                font: Some(ooxml_types::styles::FontDef {
                    bold: Some(true),
                    ..Default::default()
                }),
                ..Default::default()
            }],
            default_table_style: Some("TableStyleMedium4".to_string()),
            ..Default::default()
        },
        vec![(
            "x14".to_string(),
            "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main".to_string(),
        )],
        Some(br#"<extLst><ext uri="{typed-style-ext}"/></extLst>"#.to_vec()),
    ));

    let engine = engine_from_parse_output_normal(&input);
    let exported = engine.build_parse_output_from_yrs();

    assert_eq!(exported.workbook_stylesheet, input.workbook_stylesheet);
}

#[test]
fn pivot_cache_records_survive_yrs_hydration_export_without_context() {
    let mut input = ParseOutput {
        sheets: vec![SheetData {
            name: "Data".to_string(),
            rows: 3,
            cols: 2,
            cells: vec![
                domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: CellValue::Text(Arc::from("Category")),
                    ..Default::default()
                },
                domain_types::CellData {
                    row: 0,
                    col: 1,
                    value: CellValue::Text(Arc::from("Amount")),
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    };
    input.pivot_cache_records.insert(
        7,
        vec![vec![
            CellValue::Text(Arc::from("A")),
            CellValue::Number(FiniteF64::new(42.0).unwrap()),
        ]],
    );

    let engine = engine_from_parse_output_normal(&input);
    let exported = engine.build_parse_output_from_yrs();

    assert_eq!(exported.pivot_cache_records, input.pivot_cache_records);
}

#[test]
fn pivot_cache_sources_survive_yrs_hydration_export_without_context() {
    let mut input = ParseOutput {
        sheets: vec![SheetData {
            name: "Data".to_string(),
            rows: 3,
            cols: 2,
            ..Default::default()
        }],
        ..Default::default()
    };
    input
        .pivot_cache_sources
        .push(domain_types::PivotCacheSourceDef {
            cache_id: 7,
            workbook_ref_scope: Default::default(),
            source_kind: domain_types::domain::pivot::PivotCacheSourceKind::LocalWorksheet,
            source_name: None,
            source_sheet: Some("Data".to_string()),
            source_range: Some("A1:B3".to_string()),
            external_worksheet: None,
            field_names: vec!["Category".to_string(), "Amount".to_string()],
            shared_items: vec![
                vec![CellValue::Text(Arc::from("A"))],
                vec![CellValue::Number(FiniteF64::new(42.0).unwrap())],
            ],
        });

    let engine = engine_from_parse_output_normal(&input);
    let exported = engine.build_parse_output_from_yrs();

    assert_eq!(exported.pivot_cache_sources, input.pivot_cache_sources);
}

#[test]
fn modeled_export_does_not_recreate_absent_pivot_cache_records() {
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Data".to_string(),
            rows: 1,
            cols: 1,
            ..Default::default()
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&input);
    let exported = engine.build_parse_output_from_yrs();

    assert!(exported.pivot_cache_records.is_empty());
}

#[test]
fn sheet_protection_modern_hash_fields_survive_yrs_hydration_export() {
    let protection = domain_types::SheetProtection {
        is_protected: true,
        password_hash: Some("CC2A".to_string()),
        hash_value: Some("modernHash==".to_string()),
        algorithm_name: Some("SHA-512".to_string()),
        salt_value: Some("modernSalt==".to_string()),
        spin_count: Some(100000),
        select_locked: false,
        select_unlocked: true,
        format_cells: true,
        ..Default::default()
    };
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Protected".to_string(),
            rows: 1,
            cols: 1,
            protection: Some(protection.clone()),
            ..Default::default()
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&input);
    let exported = engine.export_to_parse_output().unwrap().parse_output;

    assert_eq!(exported.sheets[0].protection.as_ref(), Some(&protection));
}

#[test]
fn explicit_empty_cached_formula_value_survives_yrs_hydration_export() {
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            rows: 1,
            cols: 1,
            cells: vec![domain_types::CellData {
                row: 0,
                col: 0,
                value: CellValue::Null,
                formula: Some("A2".to_string()),
                has_empty_cached_value: true,
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&input);
    let exported = engine.export_to_parse_output().unwrap().parse_output;

    let cell = exported.sheets[0]
        .cells
        .iter()
        .find(|cell| cell.row == 0 && cell.col == 0)
        .expect("formula cell should export");
    assert_eq!(cell.formula.as_deref(), Some("A2"));
    assert!(cell.has_empty_cached_value);
}

#[test]
fn editing_formula_clears_explicit_empty_cached_value_metadata() {
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            rows: 1,
            cols: 1,
            cells: vec![domain_types::CellData {
                row: 0,
                col: 0,
                value: CellValue::Null,
                formula: Some("A2".to_string()),
                has_empty_cached_value: true,
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    };

    let mut engine = engine_from_parse_output_normal(&input);
    let sheet_id = *engine
        .stores
        .grid_indexes
        .keys()
        .next()
        .expect("sheet should exist");
    let cell_id = engine
        .stores
        .grid_indexes
        .get(&sheet_id)
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
            crate::bridge_types::CellInput::Parse { text: "=A3".into() },
        )
        .expect("formula edit should succeed");

    let exported = engine.export_to_parse_output().unwrap().parse_output;
    let cell = exported.sheets[0]
        .cells
        .iter()
        .find(|cell| cell.row == 0 && cell.col == 0)
        .expect("formula cell should export");
    assert_eq!(cell.formula.as_deref(), Some("A3"));
    assert!(!cell.has_empty_cached_value);
}

#[test]
fn sheet_extent_survives_yrs_hydration_export_when_sheet_has_data() {
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![domain_types::CellData {
                row: 0,
                col: 0,
                value: CellValue::Number(FiniteF64::new(1.0).unwrap()),
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&input);
    let exported = engine.export_to_parse_output().unwrap().parse_output;

    assert_eq!(exported.sheets[0].rows, 100);
    assert_eq!(exported.sheets[0].cols, 26);
}

#[test]
fn build_parse_output_from_yrs_preserves_xlsx_metadata_domain() {
    let mut output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            ..Default::default()
        }],
        ..Default::default()
    };
    output.metadata = Some(domain_types::WorkbookMetadata {
        metadata_types: vec![domain_types::MetadataType {
            name: "XLDAPR".to_string(),
            min_supported_version: 120000,
            copy: true,
            paste_all: true,
            paste_values: true,
            merge: true,
            split_first: true,
            row_col_shift: true,
            clear_formats: true,
            clear_comments: true,
            assign: true,
            coerce: true,
            cell_meta: true,
            ..Default::default()
        }],
        future_metadata: vec![domain_types::FutureMetadataGroup {
            name: "XLDAPR".to_string(),
            blocks: vec![domain_types::FutureMetadataBlock {
                raw_xml: r#"<xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/>"#.to_string(),
            }],
        }],
        cell_metadata: vec![domain_types::CellMetadataBlock {
            records: vec![domain_types::CellMetadataRecord { t: 1, v: 0 }],
        }],
        value_metadata: vec![],
        rich_data: None,
        imported_metadata_xml: None,
        feature_properties: Default::default(),
    });

    let engine = engine_from_parse_output_normal(&output);
    let exported = engine.build_parse_output_from_yrs();

    assert_eq!(exported.metadata, output.metadata);
}

#[test]
fn l2_xlsx_export_preserves_threaded_comment_persons() {
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Comments".to_string(),
            rows: 1,
            cols: 1,
            cells: vec![domain_types::CellData {
                row: 0,
                col: 0,
                value: CellValue::Text("threaded".into()),
                ..Default::default()
            }],
            comments: vec![Comment {
                id: "comment-1".to_string(),
                cell_ref: "A1".to_string(),
                author: "Modeled Author".to_string(),
                author_id: Some("S::author@example.com::1".to_string()),
                content: Some("Threaded package comment".to_string()),
                thread_id: Some("{THREAD-1}".to_string()),
                person_id: Some("{PERSON-1}".to_string()),
                timestamp: Some("2026-05-27T10:00:00Z".to_string()),
                comment_type: CommentType::ThreadedComment,
                ..Default::default()
            }],
            ..Default::default()
        }],
        persons: vec![PersonInfo {
            id: "{PERSON-1}".to_string(),
            display_name: "Modeled Author".to_string(),
            user_id: Some("S::author@example.com::1".to_string()),
            provider_id: Some("AD".to_string()),
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&input);
    let exported_parse = engine
        .export_to_parse_output()
        .expect("production Yrs export should succeed")
        .parse_output;
    assert_eq!(exported_parse.persons, input.persons);

    let exported_bytes = engine.export_to_xlsx_bytes().expect("export xlsx bytes");
    let parsed = xlsx_api::parse(&exported_bytes)
        .expect("exported XLSX should parse")
        .output;

    assert_eq!(parsed.persons.len(), 1);
    assert_eq!(parsed.persons[0].id, "{PERSON-1}");
    assert_eq!(parsed.persons[0].display_name, "Modeled Author");
    assert!(parsed.sheets[0].comments.iter().any(|comment| {
        comment.comment_type == CommentType::ThreadedComment
            && comment.thread_id.as_deref() == Some("{THREAD-1}")
            && comment.person_id.as_deref() == Some("{PERSON-1}")
            && comment.content.as_deref() == Some("Threaded package comment")
            && comment.author == "Modeled Author"
    }));
}

#[test]
fn l2_xlsx_export_preserves_empty_threaded_comment_persons_part() {
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Comments".to_string(),
            rows: 1,
            cols: 1,
            ..Default::default()
        }],
        has_persons_part: true,
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&input);
    let exported_parse = engine
        .export_to_parse_output()
        .expect("production Yrs export should succeed")
        .parse_output;
    assert!(exported_parse.has_persons_part);
    assert!(exported_parse.persons.is_empty());

    let exported_bytes = engine.export_to_xlsx_bytes().expect("export xlsx bytes");
    let parsed = xlsx_api::parse(&exported_bytes)
        .expect("exported XLSX should parse")
        .output;

    assert!(parsed.has_persons_part);
    assert!(parsed.persons.is_empty());
}

#[test]
fn build_parse_output_from_yrs_preserves_workbook_views() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            ..Default::default()
        }],
        workbook_views: vec![WorkbookView {
            active_tab: 8,
            first_sheet: 3,
            visibility: WorkbookViewVisibility::Visible,
            minimized: false,
            show_horizontal_scroll: true,
            show_vertical_scroll: true,
            show_sheet_tabs: true,
            auto_filter_date_grouping: true,
            x_window: Some(0),
            y_window: Some(0),
            window_width: Some(28800),
            window_height: Some(12225),
            tab_ratio: Some(600.0),
            uid: Some("{1A2B3C4D-0000-0000-0000-000000000000}".to_string()),
            ext_lst_raw: None,
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&output);
    let exported = engine.build_parse_output_from_yrs();

    assert_eq!(exported.workbook_views, output.workbook_views);
}

#[test]
fn build_parse_output_from_yrs_preserves_workbook_web_publishing() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Web".to_string(),
            rows: 1,
            cols: 1,
            dimensions: SheetDimensions::default(),
            ..Default::default()
        }],
        web_publishing: Some(WorkbookWebPublishing {
            css: Some(true),
            thicket: Some(false),
            long_file_names: Some(true),
            vml: Some(false),
            allow_png: Some(true),
            target_screen_size: Some(ooxml_types::web_publish::TargetScreenSize::Size1600x1200),
            dpi: Some(192),
            code_page: None,
            character_set: None,
        }),
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&output);
    let exported = engine.build_parse_output_from_yrs();

    assert_eq!(exported.web_publishing, output.web_publishing);
}

#[test]
fn build_parse_output_from_yrs_preserves_imported_array_refs() {
    let cell_formula = ooxml_types::worksheet::CellFormula {
        t: ooxml_types::worksheet::CellFormulaType::Array,
        r#ref: Some("A1:A3".to_string()),
        text: "_xlfn.SEQUENCE(3)".to_string(),
        aca: true,
        ..Default::default()
    };
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 4,
            cells: vec![domain_types::CellData {
                row: 0,
                col: 0,
                value: CellValue::Text("first".into()),
                formula: Some("_xlfn.SEQUENCE(3)".to_string()),
                array_ref: Some("A1:A3".to_string()),
                cell_formula: Some(cell_formula.clone()),
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&output);
    let exported = engine.build_parse_output_from_yrs();
    let cell = exported.sheets[0]
        .cells
        .iter()
        .find(|cell| cell.row == 0 && cell.col == 0)
        .expect("exported array formula anchor");

    assert_eq!(cell.formula.as_deref(), Some("SEQUENCE(3)"));
    assert_eq!(cell.array_ref.as_deref(), Some("A1:A3"));
    assert_eq!(cell.cell_formula.as_ref(), Some(&cell_formula));
}

fn engine_from_parse_output_with_ranges(output: &ParseOutput) -> YrsComputeEngine {
    use crate::storage::infra::hydration::{
        DefaultIdAllocator, HydrationIdMap, allocate_sheet_ids,
    };

    let mut allocator = DefaultIdAllocator::new();
    let allocations: Vec<_> = output
        .sheets
        .iter()
        .map(|sheet| allocate_sheet_ids(sheet, &mut allocator))
        .collect();

    let mut id_map = HydrationIdMap::default();
    for alloc in &allocations {
        id_map.sheet_ids.push(alloc.sheet_id);
        id_map.cell_ids.push(alloc.cell_ids.clone());
        id_map.row_ids.push(alloc.row_ids.clone());
        id_map.col_ids.push(alloc.col_ids.clone());
        for identity in &alloc.identity_only_cells {
            id_map.identity_only_cells.push((
                alloc.sheet_id,
                identity.cell_id,
                identity.row,
                identity.col,
            ));
        }
    }

    let workbook_snap = crate::import::parse_output_to_snapshot::parse_output_to_workbook_snapshot(
        output,
        Some(&id_map),
        &mut allocator,
    );
    let ranged_positions = output
        .sheets
        .iter()
        .map(|_| std::collections::HashSet::new())
        .collect::<Vec<_>>();
    let range_data_per_sheet = workbook_snap
        .sheets
        .iter()
        .map(|sheet| sheet.ranges.clone())
        .collect::<Vec<_>>();
    let range_style_positions = output
        .sheets
        .iter()
        .map(|_| std::collections::HashSet::new())
        .collect::<Vec<_>>();
    let range_styles_per_sheet = output.sheets.iter().map(|_| Vec::new()).collect::<Vec<_>>();

    let mut storage = crate::storage::YrsStorage::new();
    storage
        .hydrate_from_parse_output_with_ranges(
            output,
            &allocations,
            &ranged_positions,
            &range_style_positions,
            &range_data_per_sheet,
            &range_styles_per_sheet,
            &mut allocator,
        )
        .expect("hydrate ranged parse output");

    assemble_engine_from_parse_output_storage(storage, workbook_snap)
}

// -------------------------------------------------------------------
// Test: XLSX export round-trip -- export then re-parse and verify contents
// -------------------------------------------------------------------

#[test]
fn test_xlsx_export_roundtrip() {
    // 1. Create engine from a snapshot with diverse cell types
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "RoundTrip".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                // A1: number
                CellData {
                    cell_id: "a0000000-0000-0000-0000-000000000001".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(42.5)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                // B1: text
                CellData {
                    cell_id: "a0000000-0000-0000-0000-000000000002".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::Text("Hello".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                // A2: boolean
                CellData {
                    cell_id: "a0000000-0000-0000-0000-000000000003".to_string(),
                    row: 1,
                    col: 0,
                    value: CellValue::Boolean(true),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                // B2: formula =1+2 (cached value 0, will be recalculated)
                CellData {
                    cell_id: "a0000000-0000-0000-0000-000000000004".to_string(),
                    row: 1,
                    col: 1,
                    value: CellValue::Number(FiniteF64::must(0.0)),
                    formula: Some("=1+2".to_string()),
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
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };

    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // 2. Add a merge region: A3:B3 (row=2, col 0..1)
    let merge_result = engine.merge_range(&sid, 2, 0, 2, 1);
    assert!(merge_result.is_ok(), "merge_range should succeed");

    // 3. Export to XLSX bytes
    let xlsx_bytes = engine
        .export_to_xlsx_bytes()
        .expect("export_to_xlsx_bytes should succeed");
    assert!(!xlsx_bytes.is_empty(), "exported bytes should be non-empty");

    // 4. Re-parse the exported XLSX
    let parsed = xlsx_api::parse(&xlsx_bytes).expect("re-parsing exported XLSX should succeed");

    // 5. Verify sheet count and name (ParseOutput uses domain_types)
    assert_eq!(
        parsed.output.sheets.len(),
        1,
        "should have exactly one sheet"
    );
    let sheet = &parsed.output.sheets[0];
    assert_eq!(
        sheet.name, "RoundTrip",
        "sheet name should survive round-trip"
    );

    // 6. Verify cell count -- at least our 4 data cells
    assert!(
        sheet.cells.len() >= 4,
        "should have at least 4 cells, got {}",
        sheet.cells.len()
    );

    // Build a lookup by (row, col) for easier assertions
    let cell_map: std::collections::HashMap<(u32, u32), &domain_types::CellData> =
        sheet.cells.iter().map(|c| ((c.row, c.col), c)).collect();

    // A1: number 42.5
    let a1 = cell_map.get(&(0, 0)).expect("A1 should exist");
    match &a1.value {
        value_types::CellValue::Number(n) => {
            assert!((n.get() - 42.5).abs() < 0.001, "A1 should be 42.5")
        }
        other => panic!("A1 should be Number, got {:?}", other),
    }

    // B1: text "Hello"
    let b1 = cell_map.get(&(0, 1)).expect("B1 should exist");
    match &b1.value {
        value_types::CellValue::Text(s) => assert_eq!(&**s, "Hello"),
        other => panic!("B1 should be Text, got {:?}", other),
    }

    // A2: boolean true
    let a2 = cell_map.get(&(1, 0)).expect("A2 should exist");
    match &a2.value {
        value_types::CellValue::Boolean(b) => assert!(*b, "A2 should be true"),
        other => panic!("A2 should be Boolean, got {:?}", other),
    }

    // B2: formula =1+2 with computed value 3
    let b2 = cell_map.get(&(1, 1)).expect("B2 should exist");
    assert_eq!(
        b2.formula.as_deref(),
        Some("1+2"),
        "B2 should preserve formula '1+2' (export strips '=' prefix)"
    );

    // 7. Verify merge region A3:B3
    assert!(
        !sheet.merges.is_empty(),
        "should have at least one merge region"
    );
    let merge = &sheet.merges[0];
    assert_eq!(merge.start_row, 2, "merge start_row should be 2");
    assert_eq!(merge.start_col, 0, "merge start_col should be 0");
    assert_eq!(merge.end_row, 2, "merge end_row should be 2");
    assert_eq!(merge.end_col, 1, "merge end_col should be 1");
}

// -------------------------------------------------------------------
// Test: XLSX export produces valid, re-parseable bytes from simple_snapshot
// -------------------------------------------------------------------

#[test]
fn test_xlsx_export_simple_snapshot_reparseable() {
    // 1. Create engine from the standard simple_snapshot (A1=10, B1=20, A2==A1+B1)
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // 2. Export to XLSX bytes
    let xlsx_bytes = engine
        .export_to_xlsx_bytes()
        .expect("export should succeed");
    assert!(xlsx_bytes.len() > 100, "XLSX output should be non-trivial");

    // 3. Re-parse the exported bytes
    let parsed = xlsx_api::parse(&xlsx_bytes).expect("re-parsing exported XLSX should succeed");

    // 4. Verify structure (ParseOutput uses domain_types)
    assert_eq!(parsed.output.sheets.len(), 1);
    let sheet = &parsed.output.sheets[0];
    assert_eq!(sheet.name, "Sheet1");

    // 5. Verify cells
    assert_eq!(sheet.cells.len(), 3, "should have 3 cells (A1, B1, A2)");

    let cell_map: std::collections::HashMap<(u32, u32), &domain_types::CellData> =
        sheet.cells.iter().map(|c| ((c.row, c.col), c)).collect();

    // A1 = 10
    let a1 = cell_map.get(&(0, 0)).expect("A1 should exist");
    match &a1.value {
        value_types::CellValue::Number(n) => assert!((n.get() - 10.0).abs() < 0.001),
        other => panic!("A1 should be Number(10), got {:?}", other),
    }

    // B1 = 20
    let b1 = cell_map.get(&(0, 1)).expect("B1 should exist");
    match &b1.value {
        value_types::CellValue::Number(n) => assert!((n.get() - 20.0).abs() < 0.001),
        other => panic!("B1 should be Number(20), got {:?}", other),
    }

    // A2 = =A1+B1, computed value 30
    let a2 = cell_map.get(&(1, 0)).expect("A2 should exist");
    assert_eq!(a2.formula.as_deref(), Some("A1+B1"));
}

fn range_export_row_id(row: u32) -> RowId {
    RowId::from_raw((row + 1) as u128)
}

fn range_export_col_id(rows: u32, col: u32) -> ColId {
    ColId::from_raw((rows + col + 1) as u128)
}

fn range_export_snapshot() -> WorkbookSnapshot {
    let rows = 4;
    let cols = 3;
    let row_ids: Vec<RowId> = (0..rows).map(range_export_row_id).collect();
    let col_ids: Vec<ColId> = (0..cols)
        .map(|col| range_export_col_id(rows, col))
        .collect();
    let mut payload = Vec::new();
    for row in 0..rows {
        for col in 0..cols {
            let value = (row * 10 + col + 1) as f64;
            payload.extend_from_slice(&value.to_le_bytes());
        }
    }

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "RangeExport".to_string(),
            rows,
            cols,
            cells: vec![],
            ranges: vec![RangeData {
                range_id: RangeId::from_uuid_str("b2000000-0000-4000-8000-000000000001").unwrap(),
                kind: RangeKind::Data,
                anchor: RangeAnchor::Elastic {
                    start_row: row_ids[0],
                    end_row: row_ids[(rows - 1) as usize],
                    start_col: col_ids[0],
                    end_col: col_ids[(cols - 1) as usize],
                },
                encoding: PayloadEncoding::F64Le,
                payload,
                row_axis: None,
                col_axis: None,
                row_ids,
                col_ids,
            }],
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

#[test]
fn xlsx_export_calculation_settings_use_modeled_storage() {
    let mut input = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            rows: 1,
            cols: 1,
            dimensions: SheetDimensions::default(),
            ..Default::default()
        }],
        ..Default::default()
    };
    input.calculation.calc_mode = domain_types::domain::workbook::CalcMode::Manual;
    input.calculation.iterate = true;
    input.calculation.iterate_count = 42;
    input.calculation.iterate_delta = 0.25;
    input.calculation.calc_id = Some(191029);

    let input_bytes = xlsx_api::export_from_parse_output(&input).expect("write input xlsx");
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes(&input_bytes, false)
        .expect("import xlsx bytes");

    engine
        .set_calculation_mode("auto")
        .expect("set modeled calculation mode");
    engine
        .set_iterative_calculation(false)
        .expect("set modeled iterative calculation");

    let exported = engine
        .export_to_parse_output()
        .expect("export_to_parse_output")
        .parse_output;

    assert_eq!(
        exported.calculation.calc_mode,
        domain_types::domain::workbook::CalcMode::Auto
    );
    assert!(!exported.calculation.iterate);
    assert_eq!(exported.calculation.iterate_count, 42);
    assert_eq!(exported.calculation.calc_id, Some(0));
    assert!(!exported.calculation.full_calc_on_load);
    assert!(!exported.calculation.force_full_calc);
    assert!(exported.calculation.calc_completed);
}

fn imported_external_link() -> ExternalLink {
    ExternalLink {
        id: "1".to_string(),
        file_path: Some("Book2.xlsx".to_string()),
        imported_identity: Some(ImportedExternalLinkIdentity {
            excel_ordinal: 1,
            workbook_rel_id: "rId20".to_string(),
            part_name: "externalLinks/externalLink9.xml".to_string(),
            external_book_rid: Some("rId1".to_string()),
            target: Some("externalLinks/externalLink9.xml".to_string()),
            target_mode: None,
        }),
        ..Default::default()
    }
}

#[test]
fn imported_external_links_export_from_modeled_storage() {
    let mut input = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            rows: 1,
            cols: 1,
            dimensions: SheetDimensions::default(),
            ..Default::default()
        }],
        ..Default::default()
    };
    input.external_links = vec![imported_external_link()];

    let input_bytes = xlsx_api::export_from_parse_output(&input).expect("write input xlsx");
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes(&input_bytes, false)
        .expect("import xlsx bytes");

    let exported = engine
        .export_to_parse_output()
        .expect("export_to_parse_output")
        .parse_output;

    assert_eq!(exported.external_links.len(), 1);
    assert_eq!(
        exported.external_links[0].file_path.as_deref(),
        Some("Book2.xlsx")
    );
    assert_eq!(
        exported.external_links[0]
            .imported_identity
            .as_ref()
            .map(|identity| identity.workbook_rel_id.as_str()),
        Some("rId20")
    );
}

#[test]
fn absent_modeled_external_links_do_not_export_external_references() {
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            rows: 1,
            cols: 1,
            dimensions: SheetDimensions::default(),
            ..Default::default()
        }],
        ..Default::default()
    };
    let engine = engine_from_parse_output_normal(&input);

    let exported_bytes = engine.export_to_xlsx_bytes().expect("export xlsx bytes");
    let parsed = xlsx_api::parse(&exported_bytes).expect("parse exported xlsx");

    assert!(
        parsed.output.external_links.is_empty(),
        "absent modeled external links must not create workbook externalReferences"
    );
}

fn exported_cell_map(
    engine: &YrsComputeEngine,
) -> std::collections::HashMap<(u32, u32), domain_types::CellData> {
    let exported = engine
        .export_to_parse_output()
        .expect("range-backed export should succeed")
        .parse_output;
    exported.sheets[0]
        .cells
        .iter()
        .cloned()
        .map(|cell| ((cell.row, cell.col), cell))
        .collect()
}

fn assert_exported_number(
    cells: &std::collections::HashMap<(u32, u32), domain_types::CellData>,
    row: u32,
    col: u32,
    expected: f64,
) {
    let cell = cells
        .get(&(row, col))
        .unwrap_or_else(|| panic!("expected exported cell at ({row}, {col})"));
    match &cell.value {
        CellValue::Number(n) => assert!(
            (n.get() - expected).abs() < 0.001,
            "expected ({row}, {col}) to export {expected}, got {}",
            n.get()
        ),
        other => panic!("expected ({row}, {col}) to be Number, got {other:?}"),
    }
}

#[test]
fn range_backed_defined_name_exports_without_virtual_cell_ref() {
    let rows = 400;
    let cols = 8;
    let mut cells = Vec::with_capacity((rows * cols) as usize);
    for row in 0..rows {
        for col in 0..cols {
            cells.push(domain_types::CellData {
                row,
                col,
                value: CellValue::Number(FiniteF64::must((row * 10 + col) as f64)),
                ..Default::default()
            });
        }
    }

    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Proppant Inventory".to_string(),
            rows,
            cols,
            cells,
            dimensions: SheetDimensions::default(),
            ..Default::default()
        }],
        named_ranges: vec![domain_types::NamedRange {
            name: "_xlnm.Print_Area".to_string(),
            refers_to: "'Proppant Inventory'!$A$374:$H$377".to_string(),
            local_sheet_id: Some(0),
            ..Default::default()
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_with_ranges(&input);
    let exported = engine
        .export_to_parse_output()
        .expect("range-backed defined-name export should succeed")
        .parse_output;

    assert_eq!(exported.named_ranges.len(), 1);
    assert_eq!(exported.named_ranges[0].name, "_xlnm.Print_Area");
    assert_eq!(exported.named_ranges[0].local_sheet_id, Some(0));
    assert_eq!(
        exported.named_ranges[0].refers_to,
        "'Proppant Inventory'!$A$374:$H$377"
    );
}

#[test]
fn hidden_imported_defined_name_exports_from_modeled_storage() {
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Names".to_string(),
            rows: 10,
            cols: 4,
            dimensions: SheetDimensions::default(),
            ..Default::default()
        }],
        named_ranges: vec![domain_types::NamedRange {
            name: "_xlnm._FilterDatabase".to_string(),
            refers_to: "Names!$A$1:$B$4".to_string(),
            local_sheet_id: Some(0),
            hidden: true,
            ..Default::default()
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&input);
    let exported = engine
        .export_to_parse_output()
        .expect("hidden defined-name export should succeed")
        .parse_output;

    assert_eq!(exported.named_ranges.len(), 1);
    assert_eq!(exported.named_ranges[0].name, "_xlnm._FilterDatabase");
    assert_eq!(exported.named_ranges[0].refers_to, "Names!$A$1:$B$4");
    assert_eq!(exported.named_ranges[0].local_sheet_id, Some(0));
    assert!(exported.named_ranges[0].hidden);
}

#[test]
fn workbook_scoped_broken_defined_name_exports_from_modeled_storage() {
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Names".to_string(),
            rows: 10,
            cols: 4,
            dimensions: SheetDimensions::default(),
            ..Default::default()
        }],
        named_ranges: vec![domain_types::NamedRange {
            name: "LegacyInput".to_string(),
            refers_to: "#REF!".to_string(),
            local_sheet_id: None,
            hidden: false,
            ..Default::default()
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&input);
    let exported = engine
        .export_to_parse_output()
        .expect("broken workbook-scoped defined-name export should succeed")
        .parse_output;

    assert_eq!(exported.named_ranges.len(), 1);
    assert_eq!(exported.named_ranges[0].name, "LegacyInput");
    assert_eq!(exported.named_ranges[0].refers_to, "#REF!");
    assert_eq!(exported.named_ranges[0].local_sheet_id, None);
    assert!(!exported.named_ranges[0].hidden);
}

#[test]
fn deleted_named_ranges_do_not_resurrect_on_export() {
    let stale_name = domain_types::NamedRange {
        name: "ToDelete".to_string(),
        refers_to: "Names!$A$1".to_string(),
        ..Default::default()
    };
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Names".to_string(),
            rows: 10,
            cols: 4,
            dimensions: SheetDimensions::default(),
            ..Default::default()
        }],
        named_ranges: vec![stale_name.clone()],
        ..Default::default()
    };
    let mut engine = engine_from_parse_output_normal(&input);
    let id = engine
        .get_named_ranges_by_scope(None)
        .into_iter()
        .find(|name| name.name == "ToDelete")
        .expect("imported name should exist")
        .id;
    engine
        .remove_named_range_by_id(&id)
        .expect("remove imported name");

    let exported = engine
        .export_to_parse_output()
        .expect("defined-name export should succeed")
        .parse_output;

    assert!(
        exported.named_ranges.is_empty(),
        "modeled deletion must control defined-name export"
    );
}

#[test]
fn test_xlsx_export_streams_range_backed_cells_without_grid_entries() {
    let (engine, _) = YrsComputeEngine::from_snapshot(range_export_snapshot()).unwrap();
    let cells = exported_cell_map(&engine);

    assert_eq!(cells.len(), 12, "all range payload cells should export");
    assert_exported_number(&cells, 0, 0, 1.0);
    assert_exported_number(&cells, 2, 1, 22.0);
    assert_exported_number(&cells, 3, 2, 33.0);
}

#[test]
fn test_xlsx_export_range_override_matches_dense_materialization() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(range_export_snapshot()).unwrap();
    let sid = sheet_id();
    let override_id = CellId::virtual_at(sid, range_export_row_id(1), range_export_col_id(4, 1));

    engine
        .set_cell(
            &sid,
            override_id,
            1,
            1,
            crate::bridge_types::CellInput::Parse { text: "999".into() },
        )
        .expect("range-backed override edit should succeed");

    let dense_value = engine
        .mirror()
        .get_sheet(&sid)
        .and_then(|sheet| sheet.get_column_slice(1))
        .and_then(|col| col.get(1))
        .cloned()
        .expect("dense column materialization should include override");
    assert_eq!(dense_value, CellValue::Number(FiniteF64::must(999.0)));

    let cells = exported_cell_map(&engine);
    assert_exported_number(&cells, 1, 1, 999.0);
}

#[test]
fn test_xlsx_export_blank_range_override_suppresses_payload_value() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(range_export_snapshot()).unwrap();
    let sid = sheet_id();
    let override_id = CellId::virtual_at(sid, range_export_row_id(2), range_export_col_id(4, 2));

    engine
        .set_cell(
            &sid,
            override_id,
            2,
            2,
            crate::bridge_types::CellInput::Clear,
        )
        .expect("range-backed clear override should succeed");

    let dense_value = engine
        .mirror()
        .get_sheet(&sid)
        .and_then(|sheet| sheet.get_column_slice(2))
        .and_then(|col| col.get(2))
        .cloned()
        .expect("dense column materialization should include cleared override");
    assert_eq!(dense_value, CellValue::Null);

    let cells = exported_cell_map(&engine);
    let cleared = cells
        .get(&(2, 2))
        .expect("cleared override should export as an explicit blank cell");
    assert_eq!(cleared.value, CellValue::Null);
    assert!(cleared.formula.is_none());
}

#[test]
fn worksheet_sort_state_survives_normal_parse_output_hydration_export() {
    let input = worksheet_sort_state_parse_output(false);
    let engine = engine_from_parse_output_normal(&input);

    let exported = engine
        .export_to_parse_output()
        .expect("production Yrs export should succeed")
        .parse_output;

    assert_eq!(exported.sheets[0].sort_state, input.sheets[0].sort_state);
    assert!(
        exported.sheets[0].auto_filter.is_none(),
        "standalone worksheet sort state must not synthesize an autoFilter"
    );
}

#[test]
fn worksheet_sort_state_survives_range_aware_parse_output_hydration_export() {
    let input = worksheet_sort_state_parse_output(false);
    let engine = engine_from_parse_output_with_ranges(&input);

    let exported = engine
        .export_to_parse_output()
        .expect("production Yrs export should succeed")
        .parse_output;

    assert_eq!(exported.sheets[0].sort_state, input.sheets[0].sort_state);
    assert!(
        exported.sheets[0].auto_filter.is_none(),
        "range-aware hydration must keep worksheet sort state out of runtime filters"
    );
}

#[test]
fn worksheet_sort_state_l2_xlsx_export_keeps_standalone_distinct_from_autofilter_sort() {
    let input = worksheet_sort_state_parse_output(true);
    let input_bytes = xlsx_api::export_from_parse_output(&input).expect("write input xlsx");
    let initial = xlsx_api::parse(&input_bytes).expect("parse input xlsx");

    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes(&input_bytes, false)
        .expect("import xlsx bytes");
    let exported_bytes = engine.export_to_xlsx_bytes().expect("export xlsx bytes");
    let parsed = xlsx_api::parse(&exported_bytes).expect("parse exported xlsx");

    let sheet = &parsed.output.sheets[0];
    let initial_sheet = &initial.output.sheets[0];
    assert_eq!(sheet.sort_state, initial_sheet.sort_state);
    assert_eq!(
        sheet.auto_filter.as_ref().and_then(|af| af.sort.clone()),
        initial_sheet
            .auto_filter
            .as_ref()
            .and_then(|af| af.sort.clone()),
        "nested autoFilter sort state must remain nested, not replace worksheet sort state"
    );
}

#[test]
fn test_parse_output_export_preserves_yrs_data_table_regions() {
    let row_input = CellRef::Positional {
        sheet: sheet_id(),
        row: 0,
        col: 0,
    };
    let col_input = CellRef::Positional {
        sheet: sheet_id(),
        row: 0,
        col: 1,
    };
    let mut snap = simple_snapshot();
    snap.data_table_regions.push(DataTableRegionDef {
        sheet: sheet_id().to_uuid_string(),
        start_row: 1,
        start_col: 1,
        end_row: 3,
        end_col: 3,
        row_input_ref: Some(row_input),
        col_input_ref: Some(col_input),
        ooxml_flags: None,
    });

    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let exported = engine
        .export_to_parse_output()
        .expect("production Yrs export should succeed")
        .parse_output;

    assert_eq!(
        exported.data_table_regions.len(),
        1,
        "Yrs-backed ParseOutput export must carry data table regions"
    );
    let region = &exported.data_table_regions[0];
    assert_eq!(region.sheet_index, 0);
    assert_eq!((region.start_row, region.start_col), (1, 1));
    assert_eq!((region.end_row, region.end_col), (3, 3));
    assert_eq!(region.row_input_ref, Some(row_input));
    assert_eq!(region.col_input_ref, Some(col_input));
}

#[test]
fn test_parse_output_export_preserves_data_table_ooxml_flags() {
    let row_input = CellRef::Positional {
        sheet: sheet_id(),
        row: 0,
        col: 0,
    };
    let col_input = CellRef::Positional {
        sheet: sheet_id(),
        row: 0,
        col: 1,
    };
    let mut snap = simple_snapshot();
    snap.data_table_regions.push(DataTableRegionDef {
        sheet: sheet_id().to_uuid_string(),
        start_row: 1,
        start_col: 1,
        end_row: 3,
        end_col: 3,
        row_input_ref: Some(row_input),
        col_input_ref: Some(col_input),
        ooxml_flags: Some(DataTableOoxmlFlags {
            r1: None,
            r2: None,
            aca: true,
            ca: true,
            bx: true,
            dt2d: true,
            dtr: true,
            del1: true,
            del2: true,
        }),
    });

    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let exported = engine
        .export_to_parse_output()
        .expect("production Yrs export should succeed")
        .parse_output;
    let flags = exported.data_table_regions[0]
        .ooxml_flags
        .as_ref()
        .expect("data table OOXML flags should export from canonical Yrs metadata");

    assert!(flags.aca);
    assert!(flags.ca);
    assert!(flags.bx);
    assert!(flags.dt2d);
    assert!(flags.dtr);
    assert!(flags.del1);
    assert!(flags.del2);
}

use super::*;
use crate::domain::styles::types::CellXfDef;
use crate::infra::error::{ErrorCode, ParseErrorDetail};

#[test]
fn test_parse_result_success() {
    let result = ParseResult::success(3, 1000, 5000);
    assert!(result.is_ok());
    assert_eq!(result.sheet_count(), 3);
    assert_eq!(result.cell_count(), 1000);
    assert_eq!(result.parse_time_us(), 5000);
}

#[test]
fn test_parse_result_error() {
    let result = ParseResult::error("Test error");
    assert!(!result.is_ok());
    assert_eq!(result.error_message(), "Test error");
}

#[test]
fn test_lazy_parse_result_success() {
    let result = LazyParseResult::success(
        3,
        vec![
            "Sheet1".to_string(),
            "Sheet2".to_string(),
            "Sheet3".to_string(),
        ],
    );
    assert!(result.is_ok());
    assert_eq!(result.sheet_count(), 3);
    assert_eq!(result.sheet_names(), vec!["Sheet1", "Sheet2", "Sheet3"]);
    assert_eq!(result.error_message(), "");
}

#[test]
fn test_lazy_parse_result_error() {
    let result = LazyParseResult::error("Test error");
    assert!(!result.is_ok());
    assert_eq!(result.sheet_count(), 0);
    assert!(result.sheet_names().is_empty());
    assert_eq!(result.error_message(), "Test error");
}

#[test]
fn test_parse_result_with_errors_success() {
    let result = ParseResultWithErrors::success(
        3,    // sheet_count
        1000, // cell_count
        5,    // cells_skipped
        2,    // warning_count
        1,    // error_count
        5000, // parse_time_us
        String::from("[]"),
    );
    assert!(result.is_ok());
    assert!(!result.is_clean()); // has errors
    assert_eq!(result.sheet_count(), 3);
    assert_eq!(result.cell_count(), 1000);
    assert_eq!(result.cells_skipped(), 5);
    assert_eq!(result.warning_count(), 2);
    assert_eq!(result.error_count(), 1);
    assert_eq!(result.parse_time_us(), 5000);
    assert_eq!(result.fatal_error(), "");
    assert_eq!(result.errors_json(), "[]");
}

#[test]
fn test_parse_result_with_errors_clean() {
    let result = ParseResultWithErrors::success(
        1,    // sheet_count
        100,  // cell_count
        0,    // cells_skipped
        0,    // warning_count
        0,    // error_count
        1000, // parse_time_us
        String::from("[]"),
    );
    assert!(result.is_ok());
    assert!(result.is_clean()); // no errors
}

#[test]
fn test_parse_result_with_errors_fatal() {
    let result = ParseResultWithErrors::fatal("Something went wrong");
    assert!(!result.is_ok());
    assert!(!result.is_clean());
    assert_eq!(result.sheet_count(), 0);
    assert_eq!(result.cell_count(), 0);
    assert_eq!(result.fatal_error(), "Something went wrong");
    assert_eq!(result.errors_json(), "[]");
}

#[test]
fn test_parse_stats_serialize() {
    let stats = ParseStats {
        total_cells: 100,
        total_sheets: 3,
        parse_time_us: 5000,
    };
    // Just verify it can be serialized
    let json = serde_json::to_string(&stats).unwrap();
    assert!(json.contains("\"totalCells\":100"));
    assert!(json.contains("\"totalSheets\":3"));
}

#[test]
fn test_full_cell_data_serialize() {
    let cell = FullCellData {
        row: 0,
        col: 0,
        cell_type: CELL_TYPE_VAL_NUMBER,
        style_idx: 1,
        value: Some("42".to_string()),
        formula: None,
        force_recalc: false,
        array_ref: None,
        cell_metadata_index: None,
        vm: None,
        phonetic: false,
        date_lexical_value: None,
        cached_value_type: 0,
        cell_formula: None,
        preserve_space_formula: false,
        preserve_space_value: false,
        sst_index: None,
        has_explicit_style: false,
    };
    let json = serde_json::to_string(&cell).unwrap();
    assert!(json.contains("\"row\":0"));
    assert!(json.contains("\"value\":\"42\""));
    // cm=false should be skipped in serialization
    assert!(!json.contains("\"cm\""));
    // cached_value_type=0 should be skipped in serialization
    assert!(!json.contains("\"cachedValueType\""));
}

#[test]
fn test_merge_range_serialize() {
    let merge = MergeRange::from_ref("A1:B2");
    let json = serde_json::to_string(&merge).unwrap();
    assert!(json.contains("\"ref_range\":\"A1:B2\""));
}

#[test]
fn test_sheet_pane_serialize() {
    let pane = SheetPane::from_parsed(1.0, 2.0, Some("B3"), Pane::BottomRight, PaneState::Frozen);
    let json = serde_json::to_string(&pane).unwrap();
    assert!(json.contains("\"x_split\":1.0"));
    assert!(json.contains("\"y_split\":2.0"));
    assert!(json.contains("\"active_pane\""));
    assert!(json.contains("\"state\""));
}

#[test]
fn test_full_parse_error_from_detail() {
    let detail = ParseErrorDetail::error(ErrorCode::InvalidCellReference, "Bad ref");
    let full_error: FullParseError = (&detail).into();
    assert_eq!(full_error.code, 300);
    assert_eq!(full_error.severity, "error");
    assert_eq!(full_error.message, "Bad ref");
}

// =========================================================================
// ParsedTable and range parsing tests
// =========================================================================

#[test]
fn test_parse_a1_range_simple() {
    let result = parse_a1_range("A1:Q34");
    assert_eq!(result, Some((0, 0, 33, 16)));
}

#[test]
fn test_parse_a1_range_single_cell() {
    let result = parse_a1_range("B2:B2");
    assert_eq!(result, Some((1, 1, 1, 1)));
}

#[test]
fn test_parse_a1_range_large() {
    let result = parse_a1_range("A1:XFD1048576");
    assert_eq!(result, Some((0, 0, 1048575, 16383)));
}

#[test]
fn test_parse_a1_range_invalid_no_colon() {
    let result = parse_a1_range("A1");
    assert_eq!(result, None);
}

#[test]
fn test_parse_a1_range_with_dollars() {
    // Absolute references like $A$1:$Q$34
    let result = parse_a1_range("$A$1:$Q$34");
    assert_eq!(result, Some((0, 0, 33, 16)));
}

#[test]
fn test_parsed_table_serialization() {
    let table = ParsedTable {
        id: 1,
        name: "Table1".to_string(),
        display_name: "Table1".to_string(),
        ref_range: "A1:E10".to_string(),
        range: ParsedCellRange {
            start_row: 0,
            start_col: 0,
            end_row: 9,
            end_col: 4,
        },
        columns: vec![
            ParsedTableColumn {
                id: 1,
                name: "Name".to_string(),
                header_row_dxf_id: None,
                data_dxf_id: None,
                totals_row_dxf_id: None,
                header_row_cell_style: None,
                data_cell_style: None,
                totals_row_cell_style: None,
                calculated_column_formula: None,
                totals_row_formula: None,
                totals_row_label: None,
                totals_row_function: None,
                unique_name: None,
                query_table_field_id: None,
                xml_column_pr: None,
                calculated_column_formula_array: false,
                totals_row_formula_array: false,
                xr3_uid: None,
            },
            ParsedTableColumn {
                id: 2,
                name: "Value".to_string(),
                header_row_dxf_id: None,
                data_dxf_id: None,
                totals_row_dxf_id: None,
                header_row_cell_style: None,
                data_cell_style: None,
                totals_row_cell_style: None,
                calculated_column_formula: None,
                totals_row_formula: None,
                totals_row_label: None,
                totals_row_function: None,
                unique_name: None,
                query_table_field_id: None,
                xml_column_pr: None,
                calculated_column_formula_array: false,
                totals_row_formula_array: false,
                xr3_uid: None,
            },
        ],
        has_headers: true,
        has_totals: false,
        style_name: Some("TableStyleMedium2".to_string()),
        show_first_column: false,
        show_last_column: false,
        show_row_stripes: true,
        show_column_stripes: false,
        header_row_dxf_id: None,
        data_dxf_id: None,
        totals_row_dxf_id: None,
        header_row_border_dxf_id: None,
        table_border_dxf_id: None,
        totals_row_border_dxf_id: None,
        header_row_cell_style: None,
        data_cell_style: None,
        totals_row_cell_style: None,
        auto_filter_ref: None,
        auto_filter_xr_uid: None,
        auto_filter_ext_lst_raw: None,
        table_type: None,
        totals_row_shown: None,
        connection_id: None,
        comment: None,
        insert_row: false,
        insert_row_shift: false,
        published: false,
        filter_columns: vec![],
        query_table: None,
        worksheet_relationship_id_hint: None,
        table_part_path_hint: None,
        worksheet_relationship_target_hint: None,
        sort_state: None,
        xr_uid: None,
    };
    let json = serde_json::to_string(&table).unwrap();
    // Check camelCase field names
    assert!(json.contains("\"displayName\":\"Table1\""));
    assert!(json.contains("\"ref\":\"A1:E10\""));
    assert!(json.contains("\"startRow\":0"));
    assert!(json.contains("\"startCol\":0"));
    assert!(json.contains("\"endRow\":9"));
    assert!(json.contains("\"endCol\":4"));
    // Check columns
    assert!(json.contains("\"id\":1"));
    assert!(json.contains("\"name\":\"Name\""));
    assert!(json.contains("\"name\":\"Value\""));
    // Check style fields
    assert!(json.contains("\"styleName\":\"TableStyleMedium2\""));
    assert!(json.contains("\"showRowStripes\":true"));
    assert!(json.contains("\"showColumnStripes\":false"));
}

#[test]
fn test_parsed_cell_range_serialization_camel_case() {
    let range = ParsedCellRange {
        start_row: 5,
        start_col: 2,
        end_row: 20,
        end_col: 10,
    };
    let json = serde_json::to_string(&range).unwrap();
    assert_eq!(
        json,
        r#"{"startRow":5,"startCol":2,"endRow":20,"endCol":10}"#
    );
}

// =========================================================================
// StylesOutput serialization tests
// =========================================================================

#[test]
fn test_styles_output_camel_case() {
    let output = StylesOutput {
        number_formats: vec![NumberFormatOutput {
            id: 164,
            format_code: "yyyy-mm-dd".to_string(),
        }],
        fonts: vec![FontOutput {
            name: "Calibri".to_string(),
            size: 11.0,
            bold: true,
            italic: false,
            underline: Some(ooxml_types::styles::UnderlineStyle::None),
            strikethrough: false,
            color: Some(ColorOutput {
                rgb: Some("FF000000".to_string()),
                theme: None,
                tint: None,
                indexed: None,
                auto: false,
                raw_tint: None,
            }),
            family: Some(2),
            scheme: Some("minor".to_string()),
            vert_align: None,
            condense: None,
            extend: None,
            outline: None,
            shadow: None,
        }],
        fills: vec![FillOutput {
            fill_type: "pattern".to_string(),
            pattern_type: ooxml_types::styles::PatternType::Solid,
            fg_color: Some(ColorOutput {
                rgb: Some("FFFFFF00".to_string()),
                theme: None,
                tint: None,
                indexed: None,
                auto: false,
                raw_tint: None,
            }),
            bg_color: None,
            gradient: None,
        }],
        borders: vec![BorderOutput {
            left: Some(BorderSideOutput {
                style: ooxml_types::styles::BorderStyle::Thin,
                color: None,
            }),
            right: None,
            top: None,
            bottom: None,
            diagonal: None,
            diagonal_up: None,
            diagonal_down: None,
        }],
        cell_xfs: vec![CellXfOutput {
            number_format_id: Some(164),
            font_id: Some(0),
            fill_id: Some(1),
            border_id: Some(0),
            apply_number_format: Some(true),
            apply_font: Some(false),
            apply_fill: Some(true),
            apply_border: Some(false),
            xf_id: Some(0),
            apply_alignment: None,
            alignment: None,
            apply_protection: None,
            protection: None,
            quote_prefix: false,
            pivot_button: false,
        }],
        cell_style_xfs: vec![],
        cell_styles: vec![],
        known_fonts: false,
        raw_fonts: vec![],
        raw_cell_xfs: vec![],
        raw_cell_style_xfs: vec![],
        default_table_style: None,
        default_pivot_style: None,
        raw_dxfs: vec![],
        raw_colors: None,
        raw_table_styles: vec![],
    };
    let json = serde_json::to_string(&output).unwrap();
    // Top-level camelCase keys
    assert!(json.contains("\"cellXfs\""));
    assert!(json.contains("\"numberFormats\""));
    // NumberFormat fields
    assert!(json.contains("\"formatCode\":\"yyyy-mm-dd\""));
    // CellXf: numFmtId (special rename), not numberFormatId
    assert!(json.contains("\"numFmtId\":164"));
    assert!(!json.contains("\"numberFormatId\""));
    // CellXf: camelCase id fields
    assert!(json.contains("\"fontId\":0"));
    assert!(json.contains("\"fillId\":1"));
    assert!(json.contains("\"applyNumberFormat\":true"));
    assert!(json.contains("\"xfId\":0"));
    // Fill: type field + camelCase
    assert!(json.contains("\"type\":\"pattern\""));
    assert!(json.contains("\"patternType\":\"solid\""));
    assert!(json.contains("\"fgColor\""));
    // Font: camelCase
    assert!(json.contains("\"name\":\"Calibri\""));
    // Border: camelCase
    assert!(json.contains("\"left\":{\"style\":\"thin\""));
}

#[test]
fn test_styles_output_from_parsed_styles() {
    let xml = br#"<?xml version="1.0"?>
<styleSheet>
    <numFmts count="1">
        <numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>
    </numFmts>
    <fonts count="1">
        <font><b/><sz val="11"/><name val="Calibri"/></font>
    </fonts>
    <fills count="1">
        <fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill>
    </fills>
    <borders count="1">
        <border><left style="thin"/><right/><top/><bottom/><diagonal/></border>
    </borders>
    <cellXfs count="1">
        <xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1" xfId="0"/>
    </cellXfs>
</styleSheet>"#;

    let styles = crate::domain::styles::read::parse_styles(xml);
    let output = StylesOutput::from(&styles);

    assert_eq!(output.number_formats.len(), 1);
    assert_eq!(output.number_formats[0].id, 164);
    assert_eq!(output.number_formats[0].format_code, "yyyy-mm-dd");

    assert_eq!(output.fonts.len(), 1);
    assert!(output.fonts[0].bold);
    assert_eq!(output.fonts[0].name, "Calibri");

    assert_eq!(output.fills.len(), 1);
    assert_eq!(output.fills[0].fill_type, "pattern");
    assert!(output.fills[0].fg_color.is_some());

    assert_eq!(output.borders.len(), 1);
    assert!(output.borders[0].left.is_some());

    assert_eq!(output.cell_xfs.len(), 1);
    assert_eq!(output.cell_xfs[0].number_format_id, Some(164));
    assert_eq!(output.cell_xfs[0].apply_number_format, Some(true));

    // Verify JSON round-trip produces correct camelCase
    let json = serde_json::to_string(&output).unwrap();
    assert!(json.contains("\"numFmtId\":164"));
    assert!(json.contains("\"formatCode\":\"yyyy-mm-dd\""));
}

// ---- W-styles typed enum round-trip tests (Round D) --------------------

#[test]
fn alignment_output_typed_fields_serialize_as_ooxml_tokens() {
    // Verify the JSON wire format for the retyped fields matches what the
    // pre-Round-D `Option<String>` representation emitted byte-for-byte.
    let a = AlignmentOutput {
        horizontal: Some(HorizontalAlign::CenterContinuous),
        vertical: Some(VerticalAlign::Justify),
        wrap_text: Some(true),
        text_rotation: None,
        indent: None,
        shrink_to_fit: None,
        reading_order: None,
        auto_indent: None,
        relative_indent: None,
        justify_last_line: None,
    };
    let json = serde_json::to_value(&a).unwrap();
    assert_eq!(json["horizontal"], "centerContinuous");
    assert_eq!(json["vertical"], "justify");

    let rt: AlignmentOutput = serde_json::from_value(json).unwrap();
    assert_eq!(rt.horizontal, Some(HorizontalAlign::CenterContinuous));
    assert_eq!(rt.vertical, Some(VerticalAlign::Justify));
}

#[test]
fn alignment_output_none_variants_omitted() {
    // `None` fields must be omitted entirely (skip_serializing_if still works
    // on typed enum Options).
    let a = AlignmentOutput {
        horizontal: None,
        vertical: None,
        wrap_text: None,
        text_rotation: None,
        indent: None,
        shrink_to_fit: None,
        reading_order: None,
        auto_indent: None,
        relative_indent: None,
        justify_last_line: None,
    };
    let json = serde_json::to_string(&a).unwrap();
    assert_eq!(json, "{}");
}

#[test]
fn alignment_output_preserves_explicit_false() {
    // Pre-existing bug: `wrap_text: Some(false)` used to collapse to
    // `None` on the CellXfDef → CellXfOutput conversion, losing the
    // explicit-false override. Guard against regression.
    let xf = CellXfDef {
        alignment: Some(ooxml_types::styles::AlignmentDef {
            wrap_text: Some(false),
            shrink_to_fit: Some(false),
            text_rotation: Some(255), // stacked/vertical sentinel
            reading_order: Some(2),
            relative_indent: Some(-1),
            justify_last_line: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    };
    let out = CellXfOutput::from(&xf);
    let a = out.alignment.unwrap();
    assert_eq!(a.wrap_text, Some(false));
    assert_eq!(a.shrink_to_fit, Some(false));
    assert_eq!(a.text_rotation, Some(255));
    assert_eq!(a.reading_order, Some(2));
    assert_eq!(a.relative_indent, Some(-1));
    assert_eq!(a.justify_last_line, Some(true));
}

#[test]
fn border_output_diagonal_flags_preserve_option() {
    use ooxml_types::styles::{BorderDef, BorderSideDef, BorderStyle};

    // None → None, Some(false) → Some(false), Some(true) → Some(true).
    let cases: Vec<(Option<bool>, Option<bool>)> = vec![
        (None, None),
        (Some(false), None),
        (None, Some(false)),
        (Some(true), None),
        (None, Some(true)),
        (Some(false), Some(false)),
        (Some(true), Some(false)),
        (Some(false), Some(true)),
        (Some(true), Some(true)),
    ];
    for (up, down) in cases {
        let b = BorderDef {
            diagonal: Some(BorderSideDef {
                style: BorderStyle::Thin,
                color: None,
            }),
            diagonal_up: up,
            diagonal_down: down,
            ..Default::default()
        };
        let out = BorderOutput::from(&b);
        assert_eq!(
            out.diagonal_up, up,
            "diagonal_up dropped for ({up:?}, {down:?})"
        );
        assert_eq!(
            out.diagonal_down, down,
            "diagonal_down dropped for ({up:?}, {down:?})"
        );
    }
}

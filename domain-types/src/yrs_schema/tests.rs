//! Round-trip tests for all YrsSchema modules.
//!
//! For each domain type: construct a realistic instance with all fields populated,
//! write to a Yrs Doc via `to_yrs_prelim()`, read back via `from_yrs_map()`,
//! and assert equality.

use yrs::{Doc, Map, MapPrelim, Transact};

use crate::MergeRegion;
use crate::domain::chart::*;
use crate::domain::comment::*;
use crate::domain::connector::*;
use crate::domain::filter::*;
use crate::domain::floating_object::*;
use crate::domain::form_control::*;
use crate::domain::hyperlink::*;
use crate::domain::ole_object::*;
use crate::domain::outline::*;
use crate::domain::pivot::*;
use crate::domain::print::*;
use crate::domain::protection::*;
use crate::domain::smartart::*;
use crate::domain::sparkline::*;
use crate::domain::table::*;
use crate::domain::validation::*;
use crate::domain::workbook::*;

use super::*;

/// Macro to perform a Yrs round-trip test:
/// 1. Write prelim entries to a Y.Map inside a Yrs Doc
/// 2. Read back via from_yrs_map
/// 3. Return the restored value
macro_rules! yrs_roundtrip {
    ($prelim_expr:expr, $from_fn:expr) => {{
        let doc = Doc::new();
        let root = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            let entries = $prelim_expr;
            let prelim: MapPrelim = entries.into_iter().collect();
            root.insert(&mut txn, "item", prelim);
        }
        let txn = doc.transact();
        let map_ref = root
            .get(&txn, "item")
            .unwrap()
            .cast::<yrs::MapRef>()
            .unwrap();
        $from_fn(&map_ref, &txn).unwrap()
    }};
}

// ═══════════════════════════════════════════════════════════════════════
// Tier 1: Flat Y.Map
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn test_comment_yrs_roundtrip() {
    let original = Comment {
        id: "comment_123".to_string(),
        cell_ref: "B5".to_string(),
        author: "Alice".to_string(),
        author_id: Some("author_001".to_string()),
        author_email: Some("alice@example.com".to_string()),
        created_at: Some(1700000000),
        modified_at: Some(1700000001),
        content: Some("Hello world".to_string()),
        runs: vec![RichTextRun {
            text: "Hello".to_string(),
            font_name: Some("Calibri".to_string()),
            font_size: Some(11.0),
            bold: true,
            italic: false,
            underline: true,
            strikethrough: false,
            color: Some("#FF0000".to_string()),
            color_indexed: Some(10),
            color_theme: Some(1),
            color_tint: Some(0.5),
            charset: Some(1),
            family: Some(2),
            scheme: Some("minor".to_string()),
            vert_align: Some("superscript".to_string()),
            preserve_space: true,
        }],
        thread_id: Some("thread_456".into()),
        parent_id: Some("parent_789".to_string()),
        resolved: Some(true),
        person_id: Some("person_001".to_string()),
        timestamp: Some("2026-01-28T02:38:50.07".to_string()),
        xr_uid: Some("{ABC-123}".to_string()),
        shape_id: Some(0),
        ext_lst_xml: Some("<extLst/>".to_string()),
        content_type: None,
        mentions: Vec::new(),
        comment_type: CommentType::Note,
        visible: Some(true),
        note_height: Some(59.25),
        note_width: Some(108.0),
    };

    let restored = yrs_roundtrip!(comment::to_yrs_prelim(&original), comment::from_yrs_map);
    assert_eq!(original, restored);
}

#[test]
fn test_comment_minimal_roundtrip() {
    // Minimal `Comment` defaults `comment_type` to `ThreadedComment`.
    let original = Comment {
        id: String::new(),
        cell_ref: "A1".to_string(),
        author: "Bob".to_string(),
        author_id: None,
        author_email: None,
        created_at: None,
        modified_at: None,
        content: None,
        runs: Vec::new(),
        thread_id: None,
        parent_id: None,
        resolved: None,
        person_id: None,
        timestamp: None,
        xr_uid: None,
        shape_id: None,
        ext_lst_xml: None,
        content_type: None,
        mentions: Vec::new(),
        comment_type: CommentType::ThreadedComment,
        visible: None,
        note_height: None,
        note_width: None,
    };

    let restored = yrs_roundtrip!(comment::to_yrs_prelim(&original), comment::from_yrs_map);
    assert_eq!(original, restored);
}

#[test]
fn test_comment_threaded_roundtrip_survives() {
    // A `ThreadedComment` round-trips with the discriminator preserved.
    let original = Comment {
        id: "threaded-001".to_string(),
        cell_ref: "C3".to_string(),
        author: "Carol".to_string(),
        thread_id: Some("threaded-001".to_string()),
        comment_type: CommentType::ThreadedComment,
        ..Default::default()
    };

    let restored = yrs_roundtrip!(comment::to_yrs_prelim(&original), comment::from_yrs_map);
    assert_eq!(restored.comment_type, CommentType::ThreadedComment);
    assert_eq!(restored.thread_id, Some("threaded-001".to_string()));
}

#[test]
fn test_comment_legacy_yrs_row_without_comment_type_key_defaults_to_threaded() {
    // Migration site: a yrs map missing the `commentType` key (legacy `None`
    // row created before the discriminator was required) reads back as
    // `ThreadedComment`. This is the single migration point — every read
    // flows through `from_yrs_map` so legacy data lazily upgrades.
    use yrs::{Doc, Map, MapPrelim, Transact};

    let doc = Doc::new();
    let root = doc.get_or_insert_map("test");
    {
        let mut txn = doc.transact_mut();
        // Build a prelim that includes the required keys but omits commentType.
        let entries: Vec<(&str, yrs::Any)> = vec![
            (comment::KEY_ID, yrs::Any::String("legacy-001".into())),
            (comment::KEY_CELL_REF, yrs::Any::String("A1".into())),
            (comment::KEY_AUTHOR, yrs::Any::String("Legacy User".into())),
        ];
        let prelim: MapPrelim = entries.into_iter().collect();
        root.insert(&mut txn, "item", prelim);
    }
    let txn = doc.transact();
    let map_ref = root
        .get(&txn, "item")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let restored = comment::from_yrs_map(&map_ref, &txn).expect("should read");
    assert_eq!(restored.comment_type, CommentType::ThreadedComment);
    assert_eq!(restored.cell_ref, "A1");
    assert_eq!(restored.author, "Legacy User");
}

#[test]
fn test_merge_yrs_roundtrip() {
    let original = MergeRegion {
        start_row: 2,
        start_col: 3,
        end_row: 10,
        end_col: 7,
    };

    let restored = yrs_roundtrip!(merge::to_yrs_prelim(&original), merge::from_yrs_map);
    assert_eq!(original, restored);
}

#[test]
fn test_hyperlink_yrs_roundtrip() {
    let original = Hyperlink {
        cell_ref: "C3".to_string(),
        target: Some("https://example.com".to_string()),
        location: Some("Sheet2!A1".to_string()),
        display: Some("Click here".to_string()),
        tooltip: Some("Opens example.com".to_string()),
        uid: None,
        target_kind: Some(crate::domain::hyperlink::HyperlinkTargetKind::Relationship),
        target_mode: Some("External".to_string()),
    };

    let restored = yrs_roundtrip!(hyperlink::to_yrs_prelim(&original), hyperlink::from_yrs_map);
    assert_eq!(original, restored);
}

#[test]
fn test_hyperlink_minimal_roundtrip() {
    let original = Hyperlink {
        cell_ref: "A1".to_string(),
        target: None,
        location: None,
        display: None,
        tooltip: None,
        uid: None,
        target_kind: None,
        target_mode: None,
    };

    let restored = yrs_roundtrip!(hyperlink::to_yrs_prelim(&original), hyperlink::from_yrs_map);
    assert_eq!(original, restored);
}

#[test]
fn test_print_yrs_roundtrip() {
    let original = PrintSettings {
        paper_size: Some(9),
        orientation: Some("landscape".to_string()),
        scale: Some(85),
        fit_to_width: Some(1),
        fit_to_height: Some(2),
        gridlines: true,
        headings: true,
        h_centered: true,
        v_centered: false,
        margins: Some(PageMargins {
            top: 1.0,
            bottom: 0.75,
            left: 0.5,
            right: 0.5,
            header: 0.3,
            footer: 0.3,
        }),
        header_footer: Some(HeaderFooter {
            odd_header: Some("&L&BPage &P".to_string()),
            odd_footer: Some("&CFooter".to_string()),
            even_header: Some("Even Header".to_string()),
            even_footer: None,
            first_header: Some("First Page".to_string()),
            first_footer: None,
            different_odd_even: true,
            different_first: true,
        }),
        black_and_white: true,
        draft: true,
        first_page_number: Some(3),
        page_order: Some("overThenDown".to_string()),
        use_printer_defaults: Some(false),
        horizontal_dpi: Some(300),
        vertical_dpi: Some(300),
        r_id: Some("rId1".to_string()),
        imported_printer_settings: Some(crate::ImportedPrinterSettingsIdentity {
            path: "xl/printerSettings/printerSettings1.bin".to_string(),
            relationship_id: Some("rId1".to_string()),
            page_setup: crate::PrinterSettingsPageSetupFingerprint {
                paper_size: Some(9),
                orientation: Some("landscape".to_string()),
                scale: Some(85),
                fit_to_width: Some(1),
                fit_to_height: Some(2),
                black_and_white: true,
                draft: true,
                first_page_number: Some(3),
                page_order: Some("overThenDown".to_string()),
                use_printer_defaults: Some(false),
                horizontal_dpi: Some(300),
                vertical_dpi: Some(300),
                use_first_page_number: false,
                has_page_setup: true,
                cell_comments: None,
                print_errors: None,
            },
        }),
        has_print_options: true,
        has_page_setup: true,
        use_first_page_number: false,
        cell_comments: None,
        print_errors: None,
    };

    let restored = yrs_roundtrip!(print::to_yrs_prelim(&original), print::from_yrs_map);
    assert_eq!(original, restored);
}

#[test]
fn test_sheet_protection_yrs_roundtrip() {
    let original = SheetProtection {
        is_protected: true,
        password_hash: Some("ABC123".to_string()),
        algorithm_name: Some("SHA-512".to_string()),
        salt_value: Some("base64salt==".to_string()),
        spin_count: Some(100000),
        select_locked: false,
        select_unlocked: true,
        format_cells: true,
        format_columns: true,
        format_rows: false,
        insert_columns: true,
        insert_rows: true,
        insert_hyperlinks: false,
        delete_columns: false,
        delete_rows: true,
        sort: true,
        auto_filter: false,
        pivot_tables: true,
        objects: true,
        scenarios: false,
    };

    let restored = yrs_roundtrip!(
        protection::sheet_to_yrs_prelim(&original),
        protection::sheet_from_yrs_map
    );
    assert_eq!(original, restored);
}

#[test]
fn test_workbook_protection_yrs_roundtrip() {
    let original = WorkbookProtection {
        lock_structure: true,
        lock_windows: true,
        lock_revision: false,
        workbook_hash_value: Some("XYZ789".to_string()),
        workbook_algorithm_name: HashAlgorithm::Sha256,
        workbook_salt_value: Some("saltyvalue==".to_string()),
        workbook_spin_count: Some(50000),
        ..Default::default()
    };

    let restored = yrs_roundtrip!(
        protection::workbook_to_yrs_prelim(&original),
        protection::workbook_from_yrs_map
    );
    assert_eq!(original, restored);
}

#[test]
fn test_outline_yrs_roundtrip() {
    let original = OutlineGroup {
        is_row: false,
        start: 5,
        end: 15,
        level: 3,
        collapsed: true,
        hidden: true,
    };

    let restored = yrs_roundtrip!(outline::to_yrs_prelim(&original), outline::from_yrs_map);
    assert_eq!(original, restored);
}

#[test]
fn test_sparkline_yrs_roundtrip() {
    let original = Sparkline {
        id: "spark-1".to_string(),
        sheet_id: "sheet-abc".to_string(),
        cell: SparklineCellAddress {
            sheet_id: "sheet-abc".to_string(),
            row: 9,
            col: 3,
        },
        data_range: SparklineDataRange {
            start_row: 0,
            start_col: 0,
            end_row: 9,
            end_col: 0,
        },
        sparkline_type: SparklineType::Column,
        data_in_rows: true,
        group_id: Some("grp_001".to_string()),
        visual: SparklineVisualSettings {
            color: "#336699".to_string(),
            negative_color: Some("#CC0000".to_string()),
            show_markers: Some(true),
            marker_color: Some("#000000".to_string()),
            high_point_color: Some("#00FF00".to_string()),
            low_point_color: Some("#FF0000".to_string()),
            first_point_color: Some("#0000FF".to_string()),
            last_point_color: Some("#FFFF00".to_string()),
            line_weight: Some(1.5),
            column_gap: None,
            bar_gap: None,
        },
        axis: SparklineAxisSettings {
            min_value: AxisBound::Value(-10.0),
            max_value: AxisBound::Value(100.0),
            show_axis: Some(true),
            axis_color: Some("#000000".to_string()),
            display_empty_cells: EmptyCellDisplay::Zero,
            right_to_left: Some(true),
        },
        created_at: Some(1700000000),
        updated_at: Some(1700000001),
    };

    let restored = yrs_roundtrip!(sparkline::to_yrs_prelim(&original), sparkline::from_yrs_map);
    assert_eq!(original, restored);
}

#[test]
fn test_sparkline_minimal_yrs_roundtrip() {
    let original = Sparkline {
        id: "spark-min".to_string(),
        sheet_id: "sh1".to_string(),
        cell: SparklineCellAddress {
            sheet_id: "sh1".to_string(),
            row: 0,
            col: 0,
        },
        data_range: SparklineDataRange {
            start_row: 0,
            start_col: 0,
            end_row: 0,
            end_col: 0,
        },
        sparkline_type: SparklineType::Line,
        data_in_rows: false,
        group_id: None,
        visual: SparklineVisualSettings::default(),
        axis: SparklineAxisSettings::default(),
        created_at: None,
        updated_at: None,
    };

    let restored = yrs_roundtrip!(sparkline::to_yrs_prelim(&original), sparkline::from_yrs_map);
    assert_eq!(original, restored);
}

#[test]
fn test_sparkline_group_yrs_roundtrip() {
    let original = SparklineGroup {
        id: "group-1".to_string(),
        sheet_id: "sheet-abc".to_string(),
        sparkline_ids: vec![
            "spark-1".to_string(),
            "spark-2".to_string(),
            "spark-3".to_string(),
        ],
        sparkline_type: SparklineType::Column,
        visual: SparklineVisualSettings {
            color: "#376092".to_string(),
            negative_color: Some("#D00000".to_string()),
            show_markers: None,
            marker_color: None,
            high_point_color: Some("#00B050".to_string()),
            low_point_color: Some("#FF0000".to_string()),
            first_point_color: None,
            last_point_color: None,
            line_weight: Some(0.75),
            column_gap: Some(1.0),
            bar_gap: None,
        },
        axis: SparklineAxisSettings {
            min_value: AxisBound::Label(AxisBoundLabel::Same),
            max_value: AxisBound::Label(AxisBoundLabel::Auto),
            show_axis: None,
            axis_color: None,
            display_empty_cells: EmptyCellDisplay::Connect,
            right_to_left: None,
        },
        created_at: Some(1700000000),
        updated_at: None,
    };

    let restored = yrs_roundtrip!(
        sparkline::group_to_yrs_prelim(&original),
        sparkline::group_from_yrs_map
    );
    assert_eq!(original, restored);
}

// ═══════════════════════════════════════════════════════════════════════
// Tier 2: Y.Map with Y.Array / JSON sub-collections
// ═══════════════════════════════════════════════════════════════════════

// Conditional formatting yrs_schema tests: moved to conditional_format module
// (pending unified yrs_schema coverage)

#[test]
fn test_validation_wholenumber_roundtrip() {
    let original = ValidationSpec {
        ranges: vec!["A1:A100".to_string()],
        rule: ValidationRule::WholeNumber {
            operator: ValidationOperator::Between,
            formula1: "1".to_string(),
            formula2: Some("100".to_string()),
        },
        error_style: ErrorStyle::Stop,
        show_error: true,
        error_title: Some("Invalid Input".to_string()),
        error_message: Some("Must be 1-100".to_string()),
        show_prompt: true,
        prompt_title: Some("Enter Number".to_string()),
        prompt_message: Some("Between 1 and 100".to_string()),
        allow_blank: false,
        ime_mode: ImeMode::NoControl,
        uid: None,
    };

    let restored = yrs_roundtrip!(
        validation::to_yrs_prelim(&original),
        validation::from_yrs_map
    );
    assert_eq!(original, restored);
}

#[test]
fn test_validation_list_roundtrip() {
    let original = ValidationSpec {
        ranges: vec!["B1:B50".to_string()],
        rule: ValidationRule::List {
            formula1: "\"Red,Green,Blue\"".to_string(),
            show_dropdown: true,
        },
        error_style: ErrorStyle::Warning,
        show_error: true,
        error_title: None,
        error_message: None,
        show_prompt: false,
        prompt_title: None,
        prompt_message: None,
        allow_blank: true,
        ime_mode: ImeMode::NoControl,
        uid: None,
    };

    let restored = yrs_roundtrip!(
        validation::to_yrs_prelim(&original),
        validation::from_yrs_map
    );
    assert_eq!(original, restored);
}

#[test]
fn test_validation_decimal_roundtrip() {
    let original = ValidationSpec {
        ranges: vec!["C1:C10".to_string()],
        rule: ValidationRule::Decimal {
            operator: ValidationOperator::GreaterThan,
            formula1: "0.5".to_string(),
            formula2: None,
        },
        error_style: ErrorStyle::Information,
        show_error: false,
        error_title: None,
        error_message: None,
        show_prompt: false,
        prompt_title: None,
        prompt_message: None,
        allow_blank: true,
        ime_mode: ImeMode::NoControl,
        uid: None,
    };

    let restored = yrs_roundtrip!(
        validation::to_yrs_prelim(&original),
        validation::from_yrs_map
    );
    assert_eq!(original, restored);
}

#[test]
fn test_validation_date_roundtrip() {
    let original = ValidationSpec {
        ranges: vec!["D1:D20".to_string()],
        rule: ValidationRule::Date {
            operator: ValidationOperator::Between,
            formula1: "2024-01-01".to_string(),
            formula2: Some("2024-12-31".to_string()),
        },
        error_style: ErrorStyle::Stop,
        show_error: true,
        error_title: Some("Date Error".to_string()),
        error_message: None,
        show_prompt: false,
        prompt_title: None,
        prompt_message: None,
        allow_blank: true,
        ime_mode: ImeMode::NoControl,
        uid: None,
    };

    let restored = yrs_roundtrip!(
        validation::to_yrs_prelim(&original),
        validation::from_yrs_map
    );
    assert_eq!(original, restored);
}

#[test]
fn test_validation_time_roundtrip() {
    let original = ValidationSpec {
        ranges: vec!["E1:E5".to_string()],
        rule: ValidationRule::Time {
            operator: ValidationOperator::LessThan,
            formula1: "0.75".to_string(),
            formula2: None,
        },
        error_style: ErrorStyle::Stop,
        show_error: true,
        error_title: None,
        error_message: None,
        show_prompt: false,
        prompt_title: None,
        prompt_message: None,
        allow_blank: true,
        ime_mode: ImeMode::NoControl,
        uid: None,
    };

    let restored = yrs_roundtrip!(
        validation::to_yrs_prelim(&original),
        validation::from_yrs_map
    );
    assert_eq!(original, restored);
}

#[test]
fn test_validation_textlength_roundtrip() {
    let original = ValidationSpec {
        ranges: vec!["F1:F30".to_string()],
        rule: ValidationRule::TextLength {
            operator: ValidationOperator::LessThanOrEqual,
            formula1: "255".to_string(),
            formula2: None,
        },
        error_style: ErrorStyle::Stop,
        show_error: true,
        error_title: None,
        error_message: None,
        show_prompt: false,
        prompt_title: None,
        prompt_message: None,
        allow_blank: true,
        ime_mode: ImeMode::NoControl,
        uid: None,
    };

    let restored = yrs_roundtrip!(
        validation::to_yrs_prelim(&original),
        validation::from_yrs_map
    );
    assert_eq!(original, restored);
}

#[test]
fn test_validation_custom_roundtrip() {
    let original = ValidationSpec {
        ranges: vec!["G1:G10".to_string()],
        rule: ValidationRule::Custom {
            formula1: "=AND(A1>0,B1>0)".to_string(),
        },
        error_style: ErrorStyle::Stop,
        show_error: true,
        error_title: None,
        error_message: None,
        show_prompt: false,
        prompt_title: None,
        prompt_message: None,
        allow_blank: true,
        ime_mode: ImeMode::NoControl,
        uid: None,
    };

    let restored = yrs_roundtrip!(
        validation::to_yrs_prelim(&original),
        validation::from_yrs_map
    );
    assert_eq!(original, restored);
}

#[test]
fn test_filter_roundtrip() {
    let original = AutoFilter {
        range_ref: "A1:D20".to_string(),
        columns: vec![
            FilterColumn {
                col_index: 0,
                filter_type: Some(OoxmlFilterType::Values {
                    values: vec!["Alpha".to_string(), "Beta".to_string()],
                    blanks: true,
                    calendar_type: None,
                    date_group_items: Vec::new(),
                }),
                ..Default::default()
            },
            FilterColumn {
                col_index: 1,
                filter_type: Some(OoxmlFilterType::Top10 {
                    top: true,
                    percent: false,
                    value: 10.0,
                    filter_val: None,
                }),
                ..Default::default()
            },
            FilterColumn {
                col_index: 2,
                filter_type: Some(OoxmlFilterType::Custom {
                    conditions: vec![OoxmlFilterCondition {
                        operator: "greaterThan".to_string(),
                        value: value_types::CellValue::from("50"),
                        value2: None,
                    }],
                    and_logic: true,
                }),
                ..Default::default()
            },
            FilterColumn {
                col_index: 3,
                filter_type: Some(OoxmlFilterType::Dynamic {
                    dynamic_type: "aboveAverage".to_string(),
                    value: None,
                    max_value: None,
                    value_iso: None,
                    max_value_iso: None,
                }),
                ..Default::default()
            },
        ],
        sort: Some(SortState {
            range_ref: "A1:D20".to_string(),
            column_sort: false,
            case_sensitive: true,
            sort_method: SortMethod::None,
            conditions: vec![SortCondition {
                range_ref: "A1:A20".to_string(),
                descending: true,
                sort_by: SortConditionBy::Value,
                custom_list: Some("High,Medium,Low".to_string()),
                dxf_id: None,
                icon_set: None,
                icon_id: None,
            }],
            ..Default::default()
        }),
        xr_uid: None,
    };

    let restored = yrs_roundtrip!(filter::to_yrs_prelim(&original), filter::from_yrs_map);
    assert_eq!(original, restored);
}

#[test]
fn test_filter_minimal_roundtrip() {
    let original = AutoFilter {
        range_ref: "A1:B5".to_string(),
        columns: Vec::new(),
        sort: None,
        xr_uid: None,
    };

    let restored = yrs_roundtrip!(filter::to_yrs_prelim(&original), filter::from_yrs_map);
    assert_eq!(original, restored);
}

#[test]
fn test_table_roundtrip() {
    let original = TableSpec {
        id: 42,
        name: "SalesData".to_string(),
        display_name: "SalesData".to_string(),
        range_ref: "A1:E100".to_string(),
        has_headers: true,
        has_totals: true,
        style_name: Some("TableStyleMedium9".to_string()),
        row_stripes: true,
        col_stripes: true,
        first_col_highlight: true,
        last_col_highlight: false,
        auto_filter_ref: Some("A1:E1".to_string()),
        columns: vec![
            TableColumnSpec {
                name: "Product".to_string(),
                totals_label: Some("Total".to_string()),
                ..Default::default()
            },
            TableColumnSpec {
                name: "Amount".to_string(),
                totals_function: Some(TotalsFunction::Sum),
                calculated_formula: Some("=[Amount]*[Price]".to_string()),
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let restored = yrs_roundtrip!(table::to_yrs_prelim(&original), table::from_yrs_map);
    assert_eq!(original, restored);
}

// ═══════════════════════════════════════════════════════════════════════
// Tier 3: Structured envelope + JSON definition blob
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn test_chart_yrs_roundtrip() {
    let original = ChartSpec {
        chart_type: ChartType::Column,
        title: Some("Quarterly Revenue".to_string()),
        position: AnchorPosition {
            anchor_row: 5,
            anchor_col: 2,
            anchor_row_offset: 12700,
            anchor_col_offset: 25400,
            end_row: Some(20),
            end_col: Some(8),
            end_row_offset: Some(0),
            end_col_offset: Some(50800),
            extent_cx: None,
            extent_cy: None,
        },
        size: ObjectSize {
            width: 600.0,
            height: 400.0,
        },
        z_index: 3,
        definition: Some(ChartDefinition::Chart(
            ooxml_types::charts::ChartSpace::default(),
        )),
        series: vec![],
        sub_type: None,
        legend: None,
        axes: None,
        data_labels: None,
        data_range: None,
        style: None,
        rounded_corners: None,
        auto_title_deleted: None,
        show_data_labels_over_max: None,
        chart_format: None,
        plot_format: None,
        title_format: None,
        data_table: None,
        display_blanks_as: None,
        plot_visible_only: None,
        gap_width: None,
        overlap: None,
        doughnut_hole_size: None,
        first_slice_angle: None,
        bubble_scale: None,
        split_type: None,
        split_value: None,
        view_3d: None,
        floor_format: None,
        side_wall_format: None,
        back_wall_format: None,
        rt: None,
        chart_frame: None,
        is_chart_ex: false,
        cnv_pr_name: None,
        cnv_pr_id: None,
        cnv_pr_descr: None,
        cnv_pr_title: None,
        cnv_pr_hidden: false,
        no_change_aspect: None,
        has_graphic_frame_locks: false,
        xfrm_off_x: 0,
        xfrm_off_y: 0,
        xfrm_ext_cx: 0,
        xfrm_ext_cy: 0,
        cnv_pr_ext_lst: None,
        anchor_edit_as: None,
        macro_name: None,
        client_data_locks_with_sheet: None,
        client_data_prints_with_sheet: None,
        anchor_index: None,
        import_status: None,
    };

    let restored = yrs_roundtrip!(chart::to_yrs_prelim(&original), chart::from_yrs_map);
    assert_eq!(original, restored);
}

#[test]
fn test_chart_minimal_roundtrip() {
    let original = ChartSpec {
        chart_type: ChartType::Pie,
        title: None,
        position: AnchorPosition {
            anchor_row: 0,
            anchor_col: 0,
            anchor_row_offset: 0,
            anchor_col_offset: 0,
            end_row: None,
            end_col: None,
            end_row_offset: None,
            end_col_offset: None,
            extent_cx: None,
            extent_cy: None,
        },
        size: ObjectSize {
            width: 300.0,
            height: 200.0,
        },
        z_index: 0,
        definition: Some(ChartDefinition::Chart(
            ooxml_types::charts::ChartSpace::default(),
        )),
        series: vec![],
        sub_type: None,
        legend: None,
        axes: None,
        data_labels: None,
        data_range: None,
        style: None,
        rounded_corners: None,
        auto_title_deleted: None,
        show_data_labels_over_max: None,
        chart_format: None,
        plot_format: None,
        title_format: None,
        data_table: None,
        display_blanks_as: None,
        plot_visible_only: None,
        gap_width: None,
        overlap: None,
        doughnut_hole_size: None,
        first_slice_angle: None,
        bubble_scale: None,
        split_type: None,
        split_value: None,
        view_3d: None,
        floor_format: None,
        side_wall_format: None,
        back_wall_format: None,
        rt: None,
        chart_frame: None,
        is_chart_ex: false,
        cnv_pr_name: None,
        cnv_pr_id: None,
        cnv_pr_descr: None,
        cnv_pr_title: None,
        cnv_pr_hidden: false,
        no_change_aspect: None,
        has_graphic_frame_locks: false,
        xfrm_off_x: 0,
        xfrm_off_y: 0,
        xfrm_ext_cx: 0,
        xfrm_ext_cy: 0,
        cnv_pr_ext_lst: None,
        anchor_edit_as: None,
        macro_name: None,
        client_data_locks_with_sheet: None,
        client_data_prints_with_sheet: None,
        anchor_index: None,
        import_status: None,
    };

    let restored = yrs_roundtrip!(chart::to_yrs_prelim(&original), chart::from_yrs_map);
    assert_eq!(original, restored);
}

#[test]
fn test_pivot_yrs_roundtrip() {
    let original = PivotSpec {
        name: "PivotTable1".to_string(),
        location: "Sheet2!A3:F20".to_string(),
        sheet_name: Some("Sheet2".to_string()),
        cache_id: Some(7),
        definition: PivotDefinition(serde_json::json!({
            "rowFields": [{"x": 0}],
            "colFields": [{"x": 1}],
            "dataFields": [{"fld": 2, "subtotal": "sum"}]
        })),
    };

    let restored = yrs_roundtrip!(pivot::to_yrs_prelim(&original), pivot::from_yrs_map);
    assert_eq!(original, restored);
}

#[test]
fn test_pivot_minimal_roundtrip() {
    let original = PivotSpec {
        name: "PT2".to_string(),
        location: "A1:C10".to_string(),
        sheet_name: None,
        cache_id: None,
        definition: PivotDefinition(serde_json::json!(null)),
    };

    let restored = yrs_roundtrip!(pivot::to_yrs_prelim(&original), pivot::from_yrs_map);
    assert_eq!(original, restored);
}

#[test]
fn test_floating_object_yrs_roundtrip() {
    let original = FloatingObject {
        common: FloatingObjectCommon {
            id: String::new(),
            sheet_id: String::new(),
            anchor: FloatingObjectAnchor {
                anchor_row: 3,
                anchor_col: 1,
                anchor_row_offset: 9525,
                anchor_col_offset: 19050,
                anchor_mode: AnchorMode::TwoCell,
                end_row: Some(10),
                end_col: Some(5),
                end_row_offset: Some(0),
                end_col_offset: Some(38100),
                extent_cx: None,
                extent_cy: None,
            },
            width: 400.0,
            height: 300.0,
            z_index: 5,
            rotation: 45.0,
            flip_h: true,
            flip_v: false,
            locked: true,
            visible: true,
            printable: true,
            opacity: 1.0,
            name: "Picture 1".to_string(),
            created_at: 0,
            updated_at: 0,
            group_id: None,
            anchor_cell_id: None,
            to_anchor_cell_id: None,
            import_status: None,
        },
        data: FloatingObjectData::Picture(PictureData {
            src: String::new(),
            original_width: None,
            original_height: None,
            crop: None,
            adjustments: None,
            border: None,
            color_type: None,
            ooxml: Some(serde_json::json!({
                "blipFill": {"rId": "rId1"},
                "altText": "Company logo"
            })),
        }),
    };

    let restored = yrs_roundtrip!(
        floating_object::to_yrs_prelim(&original),
        floating_object::from_yrs_map
    );
    // Compare type and key common fields (FloatingObject doesn't derive PartialEq)
    assert_eq!(restored.object_type(), "picture");
    assert_eq!(restored.common.name, original.common.name);
    assert_eq!(restored.common.z_index, original.common.z_index);
    assert_eq!(restored.common.anchor.anchor_row, 3);
}

#[test]
fn test_floating_object_minimal_roundtrip() {
    let original = FloatingObject {
        common: FloatingObjectCommon {
            id: String::new(),
            sheet_id: String::new(),
            anchor: FloatingObjectAnchor {
                anchor_row: 0,
                anchor_col: 0,
                anchor_row_offset: 0,
                anchor_col_offset: 0,
                anchor_mode: AnchorMode::OneCell,
                end_row: None,
                end_col: None,
                end_row_offset: None,
                end_col_offset: None,
                extent_cx: None,
                extent_cy: None,
            },
            width: 0.0,
            height: 0.0,
            z_index: 0,
            rotation: 0.0,
            flip_h: false,
            flip_v: false,
            locked: false,
            visible: true,
            printable: true,
            opacity: 1.0,
            name: String::new(),
            created_at: 0,
            updated_at: 0,
            group_id: None,
            anchor_cell_id: None,
            to_anchor_cell_id: None,
            import_status: None,
        },
        data: FloatingObjectData::Shape(ShapeData {
            shape_type: "rect".to_string(),
            fill: None,
            outline: None,
            text: None,
            shadow: None,
            adjustments: None,
            scene_3d: None,
            sp_3d: None,
            ooxml: None,
        }),
    };

    let restored = yrs_roundtrip!(
        floating_object::to_yrs_prelim(&original),
        floating_object::from_yrs_map
    );
    assert_eq!(restored.object_type(), "shape");
    assert_eq!(restored.common.visible, true);
}

#[test]
fn test_form_control_yrs_roundtrip() {
    let original = FormControl {
        control_type: "CheckBox".to_string(),
        name: Some("CheckBox1".to_string()),
        cell_link: Some("Sheet1!$A$1".to_string()),
        input_range: Some("Sheet1!$B$1:$B$10".to_string()),
        position: AnchorPosition {
            anchor_row: 2,
            anchor_col: 3,
            anchor_row_offset: 5000,
            anchor_col_offset: 10000,
            end_row: Some(4),
            end_col: Some(5),
            end_row_offset: Some(0),
            end_col_offset: Some(0),
            extent_cx: None,
            extent_cy: None,
        },
        size: ObjectSize {
            width: 120.0,
            height: 30.0,
        },
        properties: serde_json::json!({
            "checked": true,
            "caption": "Enable Feature"
        }),
    };

    let restored = yrs_roundtrip!(
        form_control::to_yrs_prelim(&original),
        form_control::from_yrs_map
    );
    assert_eq!(original, restored);
}

#[test]
fn test_smartart_yrs_roundtrip() {
    let original = SmartArtDiagram {
        diagram_type: Some("hierarchy".to_string()),
        position: AnchorPosition {
            anchor_row: 10,
            anchor_col: 4,
            anchor_row_offset: 0,
            anchor_col_offset: 0,
            end_row: Some(25),
            end_col: Some(12),
            end_row_offset: Some(0),
            end_col_offset: Some(0),
            extent_cx: None,
            extent_cy: None,
        },
        size: ObjectSize {
            width: 800.0,
            height: 600.0,
        },
        definition: serde_json::json!({
            "dataModel": {"ptLst": [{"modelId": "1", "text": "CEO"}]},
            "layout": {"name": "orgChart"}
        }),
    };

    let restored = yrs_roundtrip!(smartart::to_yrs_prelim(&original), smartart::from_yrs_map);
    assert_eq!(original, restored);
}

#[test]
fn test_smartart_minimal_roundtrip() {
    let original = SmartArtDiagram {
        diagram_type: None,
        position: AnchorPosition::default(),
        size: ObjectSize::default(),
        definition: serde_json::json!(null),
    };

    let restored = yrs_roundtrip!(smartart::to_yrs_prelim(&original), smartart::from_yrs_map);
    assert_eq!(original, restored);
}

#[test]
fn test_connector_yrs_roundtrip() {
    let original = Connector {
        name: Some("Connector 1".to_string()),
        preset_geometry: Some("straightConnector1".to_string()),
        start_connection: Some(ConnectorEndpoint {
            shape_id: 42,
            connection_site: 2,
        }),
        end_connection: Some(ConnectorEndpoint {
            shape_id: 43,
            connection_site: 0,
        }),
        position: AnchorPosition {
            anchor_row: 5,
            anchor_col: 3,
            anchor_row_offset: 1000,
            anchor_col_offset: 2000,
            end_row: Some(8),
            end_col: Some(6),
            end_row_offset: Some(500),
            end_col_offset: Some(1500),
            extent_cx: None,
            extent_cy: None,
        },
        size: ObjectSize {
            width: 200.0,
            height: 150.0,
        },
        properties: serde_json::json!({
            "ln": {"w": 12700, "solidFill": "#000000"}
        }),
    };

    let restored = yrs_roundtrip!(connector::to_yrs_prelim(&original), connector::from_yrs_map);
    assert_eq!(original, restored);
}

#[test]
fn test_connector_minimal_roundtrip() {
    let original = Connector {
        name: None,
        preset_geometry: None,
        start_connection: None,
        end_connection: None,
        position: AnchorPosition::default(),
        size: ObjectSize::default(),
        properties: serde_json::json!({}),
    };

    let restored = yrs_roundtrip!(connector::to_yrs_prelim(&original), connector::from_yrs_map);
    assert_eq!(original, restored);
}

#[test]
fn test_ole_object_yrs_roundtrip() {
    let original = OleObject {
        prog_id: "Excel.Sheet.12".to_string(),
        name: Some("Embedded Workbook".to_string()),
        position: AnchorPosition {
            anchor_row: 1,
            anchor_col: 1,
            anchor_row_offset: 0,
            anchor_col_offset: 0,
            end_row: Some(15),
            end_col: Some(8),
            end_row_offset: Some(100),
            end_col_offset: Some(200),
            extent_cx: None,
            extent_cy: None,
        },
        size: ObjectSize {
            width: 500.0,
            height: 350.0,
        },
        properties: serde_json::json!({
            "oleUpdate": "OLEUPDATE_ALWAYS",
            "rId": "rId5"
        }),
    };

    let restored = yrs_roundtrip!(
        ole_object::to_yrs_prelim(&original),
        ole_object::from_yrs_map
    );
    assert_eq!(original, restored);
}

#[test]
fn test_ole_object_minimal_roundtrip() {
    let original = OleObject {
        prog_id: "Package".to_string(),
        name: None,
        position: AnchorPosition::default(),
        size: ObjectSize::default(),
        properties: serde_json::json!({}),
    };

    let restored = yrs_roundtrip!(
        ole_object::to_yrs_prelim(&original),
        ole_object::from_yrs_map
    );
    assert_eq!(original, restored);
}

// ═══════════════════════════════════════════════════════════════════════
// Additional: Filter with Color filter type
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn test_filter_color_roundtrip() {
    let original = AutoFilter {
        range_ref: "A1:F50".to_string(),
        columns: vec![FilterColumn {
            col_index: 2,
            filter_type: Some(OoxmlFilterType::Color {
                dxf_id: Some(4),
                cell_color: false,
            }),
            ..Default::default()
        }],
        sort: None,
        xr_uid: None,
    };

    let restored = yrs_roundtrip!(filter::to_yrs_prelim(&original), filter::from_yrs_map);
    assert_eq!(original, restored);
}

use ooxml_types::web_publish::TargetScreenSize;

use crate::MergeRegion;
use crate::domain::hyperlink::{Hyperlink, HyperlinkTargetKind};
use crate::domain::named_range::DefinedName;
use crate::domain::print::{PageBreakEntry, PageBreaks};
use crate::domain::sheet::{FrozenPanes, SheetViewOptions};
use crate::domain::workbook::{
    FileSharing, FileVersion, ObjectDisplayMode, UpdateLinks, WorkbookProperties,
    WorkbookWebPublishing,
};
use crate::properties::DocumentProperties;
use crate::yrs_schema::{
    doc_properties, file_sharing, file_version, frozen_panes, hyperlink, merge, named_range,
    page_breaks, sheet_view, web_publishing, workbook_properties,
};

use super::support::{roundtrip_map, roundtrip_map_value};

#[test]
fn merge_and_hyperlink_round_trip_through_real_yrs_maps() {
    let merge_region = MergeRegion {
        start_row: 2,
        start_col: 3,
        end_row: 10,
        end_col: 7,
    };
    assert_eq!(
        merge_region,
        roundtrip_map(merge::to_yrs_prelim(&merge_region), |map, txn| {
            merge::from_yrs_map(map, txn)
        })
    );

    let link = Hyperlink {
        cell_ref: "C3".to_string(),
        target: Some("https://example.com".to_string()),
        location: Some("Sheet2!A1".to_string()),
        display: Some("Click here".to_string()),
        tooltip: Some("Opens example.com".to_string()),
        uid: None,
        target_kind: Some(HyperlinkTargetKind::Relationship),
        target_mode: Some("External".to_string()),
    };
    assert_eq!(
        link,
        roundtrip_map(hyperlink::to_yrs_prelim(&link), |map, txn| {
            hyperlink::from_yrs_map(map, txn)
        })
    );
}

#[test]
fn workbook_metadata_round_trips_through_real_yrs_maps() {
    let doc_props = DocumentProperties {
        title: Some("Budget".to_string()),
        creator: Some("Mog".to_string()),
        description: Some("Planning workbook".to_string()),
        custom: vec![("Reviewed".to_string(), "yes".to_string())],
        ..Default::default()
    };
    assert_eq!(
        doc_props,
        roundtrip_map_value(doc_properties::to_yrs_prelim(&doc_props), |map, txn| {
            doc_properties::from_yrs_map(map, txn)
        },)
    );

    let file_version = FileVersion {
        app_name: Some("xl".to_string()),
        last_edited: Some("7".to_string()),
        lowest_edited: Some("5".to_string()),
        rup_build: Some("28120".to_string()),
        code_name: Some("WorkbookCode".to_string()),
    };
    assert_eq!(
        file_version,
        roundtrip_map_value(file_version::to_yrs_prelim(&file_version), |map, txn| {
            file_version::from_yrs_map(map, txn)
        },)
    );

    let file_sharing = FileSharing {
        read_only_recommended: true,
        user_name: Some("Alice".to_string()),
        reservation_password: Some("ABCD".to_string()),
        algorithm_name: Some("SHA-512".to_string()),
        hash_value: Some("hash".to_string()),
        salt_value: Some("salt".to_string()),
        spin_count: Some(100000),
    };
    assert_eq!(
        file_sharing,
        roundtrip_map_value(file_sharing::to_yrs_prelim(&file_sharing), |map, txn| {
            file_sharing::from_yrs_map(map, txn)
        },)
    );
}

#[test]
fn sheet_and_workbook_view_metadata_round_trips_through_real_yrs_maps() {
    let frozen = FrozenPanes { rows: 2, cols: 1 };
    assert_eq!(
        frozen,
        roundtrip_map_value(frozen_panes::to_yrs_prelim(&frozen), |map, txn| {
            frozen_panes::from_yrs_map(map, txn)
        })
    );

    let view = SheetViewOptions {
        show_gridlines: false,
        show_row_headers: true,
        show_column_headers: false,
        right_to_left: true,
        show_formulas: true,
        show_zeros: false,
        zoom_scale: Some(125),
    };
    assert_eq!(
        view,
        roundtrip_map_value(sheet_view::to_yrs_prelim(&view), |map, txn| {
            sheet_view::from_yrs_map(map, txn)
        })
    );

    let page_breaks = PageBreaks {
        row_breaks: vec![PageBreakEntry {
            id: 12,
            min: 0,
            max: 16383,
            manual: true,
            pt: false,
        }],
        col_breaks: vec![PageBreakEntry {
            id: 4,
            min: 0,
            max: 1048575,
            manual: true,
            pt: true,
        }],
    };
    assert_eq!(
        page_breaks,
        roundtrip_map_value(page_breaks::to_yrs_prelim(&page_breaks), |map, txn| {
            page_breaks::from_yrs_map(map, txn)
        },)
    );
}

#[test]
fn named_range_and_workbook_properties_round_trip_through_real_yrs_maps() {
    let defined_name = DefinedName {
        id: "name-1".to_string(),
        name: "SalesData".to_string(),
        refers_to: "=Sheet1!$A$1:$B$10".to_string(),
        raw_refers_to: Some("'Sheet 1'!$A$1:$B$10".to_string()),
        scope: Some("sheet-1".to_string()),
        comment: Some("Imported name".to_string()),
        custom_menu: Some("Run".to_string()),
        description: Some("Sales range".to_string()),
        help: Some("Use this in formulas".to_string()),
        status_bar: Some("Ready".to_string()),
        visible: false,
        xlm: true,
        function: true,
        vb_procedure: true,
        publish_to_server: true,
        workbook_parameter: true,
        xml_space_preserve: true,
        order: Some(3),
        linked_range_id: None,
    };
    assert_eq!(
        defined_name,
        roundtrip_map(named_range::to_yrs_prelim(&defined_name), |map, txn| {
            named_range::from_yrs_map(map, txn)
        },)
    );

    let workbook_props = WorkbookProperties {
        date1904: true,
        show_objects: ObjectDisplayMode::Placeholders,
        show_border_unselected_tables: false,
        filter_privacy: true,
        prompted_solutions: true,
        show_ink_annotation: false,
        backup_file: true,
        save_external_link_values: false,
        update_links: UpdateLinks::Always,
        code_name: Some("ThisWorkbook".to_string()),
        hide_pivot_field_list: true,
        show_pivot_chart_filter: true,
        allow_refresh_query: true,
        publish_items: true,
        check_compatibility: true,
        auto_compress_pictures: false,
        refresh_all_connections: true,
        default_theme_version: Some(166925),
    };
    assert_eq!(
        workbook_props,
        roundtrip_map_value(
            workbook_properties::to_yrs_prelim(&workbook_props),
            |map, txn| workbook_properties::from_yrs_map(map, txn),
        )
    );
}

#[test]
fn web_publishing_round_trips_optional_scalars() {
    let web = WorkbookWebPublishing {
        css: Some(true),
        thicket: Some(false),
        long_file_names: Some(true),
        vml: Some(false),
        allow_png: Some(true),
        target_screen_size: Some(TargetScreenSize::Size1280x1024),
        dpi: Some(144),
        code_page: Some(65001),
        character_set: Some("UTF-8".to_string()),
    };
    assert_eq!(
        web,
        roundtrip_map_value(web_publishing::to_yrs_prelim(&web), |map, txn| {
            web_publishing::from_yrs_map(map, txn)
        },)
    );
}

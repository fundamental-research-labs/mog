use crate::domain::print::{
    HeaderFooter, ImportedPrinterSettingsIdentity, PageMargins, PageSetupProperties, PrintSettings,
    PrinterSettingsPageSetupFingerprint,
};
use crate::yrs_schema::print;

use super::support::roundtrip_map;

#[test]
fn rich_print_settings_round_trip_through_real_yrs_map() {
    let original = PrintSettings {
        paper_size: Some(9),
        paper_width: Some("210mm".to_string()),
        paper_height: Some("297mm".to_string()),
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
            scale_with_doc: Some(true),
            align_with_margins: Some(true),
        }),
        black_and_white: true,
        draft: true,
        first_page_number: Some(3),
        page_order: Some("overThenDown".to_string()),
        use_printer_defaults: Some(false),
        horizontal_dpi: Some(300),
        vertical_dpi: Some(300),
        r_id: Some("rId1".to_string()),
        imported_printer_settings: Some(ImportedPrinterSettingsIdentity {
            path: "xl/printerSettings/printerSettings1.bin".to_string(),
            relationship_id: Some("rId1".to_string()),
            page_setup: PrinterSettingsPageSetupFingerprint {
                paper_size: Some(9),
                paper_width: Some("210mm".to_string()),
                paper_height: Some("297mm".to_string()),
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
                copies: Some(2),
                cell_comments: Some("asDisplayed".to_string()),
                print_errors: Some("dash".to_string()),
            },
        }),
        has_print_options: true,
        has_page_setup: true,
        copies: Some(2),
        grid_lines_set: false,
        page_setup_properties: Some(PageSetupProperties {
            fit_to_page: true,
            auto_page_breaks: false,
        }),
        use_first_page_number: false,
        cell_comments: Some("asDisplayed".to_string()),
        print_errors: Some("dash".to_string()),
    };

    assert_eq!(
        original,
        roundtrip_map(print::to_yrs_prelim(&original), |map, txn| {
            print::from_yrs_map(map, txn)
        })
    );
}

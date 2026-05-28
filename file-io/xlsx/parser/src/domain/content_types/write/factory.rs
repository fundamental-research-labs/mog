use super::manager::ContentTypesManager;

/// Create a complete ContentTypesManager for a basic workbook.
///
/// This is a convenience function that creates a ContentTypesManager with
/// common components for an XLSX file.
///
/// # Arguments
/// * `sheet_count` - Number of worksheets
/// * `has_styles` - Whether to include styles.xml
/// * `has_shared_strings` - Whether to include sharedStrings.xml
/// * `has_theme` - Whether to include theme1.xml
/// * `table_count` - Number of tables
/// * `chart_count` - Number of charts
///
/// # Example
///
/// ```
/// use xlsx_parser::write::create_xlsx_content_types;
///
/// let ct = create_xlsx_content_types(3, true, true, true, 0, 0);
/// let xml = ct.to_xml();
/// ```
pub fn create_xlsx_content_types(
    sheet_count: usize,
    has_styles: bool,
    has_shared_strings: bool,
    has_theme: bool,
    table_count: usize,
    chart_count: usize,
) -> ContentTypesManager {
    let mut ct = ContentTypesManager::with_xlsx_defaults();

    ct.add_workbook();

    for i in 1..=sheet_count {
        ct.add_worksheet(i);
    }

    if has_styles {
        ct.add_styles();
    }
    if has_shared_strings {
        ct.add_shared_strings();
    }
    if has_theme {
        ct.add_theme();
    }
    for i in 1..=table_count {
        ct.add_table(i);
    }
    for i in 1..=chart_count {
        ct.add_chart(i);
    }

    ct
}

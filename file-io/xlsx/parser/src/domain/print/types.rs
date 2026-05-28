//! Combined print settings type.
//!
//! This module contains the main `PrintSettings` struct that aggregates
//! all print-related settings for a worksheet.

use super::header_footer::HeaderFooter;
use super::page_setup::{PageMargins, PageSetup, parse_page_margins};
use super::print_options::{PageBreaks, PrintOptions};
use crate::domain::worksheet::read::parse_page_setup_properties;
use ooxml_types::worksheet::PageSetupProperties;

// ============================================================================
// Combined Print Settings
// ============================================================================

/// All print-related settings for a worksheet
#[derive(Debug, Clone, Default)]
pub struct PrintSettings {
    /// Page setup (paper, orientation, scaling)
    pub page_setup: Option<PageSetup>,
    /// Page margins
    pub page_margins: Option<PageMargins>,
    /// Headers and footers
    pub header_footer: Option<HeaderFooter>,
    /// Print options (gridlines, headings, centering)
    pub print_options: Option<PrintOptions>,
    /// Sheet-level page setup properties from `<sheetPr><pageSetUpPr>`.
    pub page_setup_properties: Option<PageSetupProperties>,
    /// Row page breaks
    pub row_breaks: Option<PageBreaks>,
    /// Column page breaks
    pub col_breaks: Option<PageBreaks>,
}

impl PrintSettings {
    /// Parse all print settings from worksheet XML.
    ///
    /// # Arguments
    /// * `xml` - Raw bytes of the worksheet XML
    ///
    /// # Returns
    /// PrintSettings struct with all available settings
    pub fn parse(xml: &[u8]) -> Self {
        PrintSettings {
            page_setup: PageSetup::parse(xml),
            page_margins: parse_page_margins(xml),
            header_footer: HeaderFooter::parse(xml),
            print_options: PrintOptions::parse(xml),
            page_setup_properties: parse_page_setup_properties(xml),
            row_breaks: PageBreaks::parse_row_breaks(xml),
            col_breaks: PageBreaks::parse_col_breaks(xml),
        }
    }

    /// Check if any print settings are present
    pub fn has_settings(&self) -> bool {
        self.page_setup.is_some()
            || self.page_margins.is_some()
            || self.header_footer.is_some()
            || self.print_options.is_some()
            || self.page_setup_properties.is_some()
            || self.row_breaks.is_some()
            || self.col_breaks.is_some()
    }
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::print::{Orientation, PaperSize};

    #[test]
    fn test_parse_print_settings_all() {
        let xml = br#"<?xml version="1.0"?>
<worksheet>
    <sheetData/>
    <pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.25" footer="0.25"/>
    <pageSetup paperSize="9" orientation="landscape"/>
    <headerFooter><oddHeader>&amp;CTest Header</oddHeader></headerFooter>
    <printOptions gridLines="1"/>
    <rowBreaks count="1"><brk id="20" man="1"/></rowBreaks>
</worksheet>"#;

        let settings = PrintSettings::parse(xml);
        assert!(settings.has_settings());
        assert!(settings.page_setup.is_some());
        assert!(settings.page_margins.is_some());
        assert!(settings.header_footer.is_some());
        assert!(settings.print_options.is_some());
        assert!(settings.row_breaks.is_some());
        assert!(settings.col_breaks.is_none());
    }

    #[test]
    fn test_parse_print_settings_empty() {
        let xml = b"<worksheet><sheetData/></worksheet>";
        let settings = PrintSettings::parse(xml);
        assert!(!settings.has_settings());
    }

    #[test]
    fn test_parse_realistic_worksheet_print_settings() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>
    <sheetFormatPr defaultRowHeight="15"/>
    <sheetData>
        <row r="1"><c r="A1"><v>Test</v></c></row>
    </sheetData>
    <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
    <pageSetup paperSize="1" orientation="portrait" scale="100" fitToWidth="1" fitToHeight="0" horizontalDpi="300" verticalDpi="300"/>
    <headerFooter>
        <oddHeader>&amp;L&amp;F&amp;C&amp;A&amp;RPage &amp;P of &amp;N</oddHeader>
        <oddFooter>&amp;L&amp;D &amp;T&amp;R&amp;"Arial,Bold"Confidential</oddFooter>
    </headerFooter>
    <printOptions gridLines="1" headings="1" horizontalCentered="1"/>
    <rowBreaks count="2" manualBreakCount="2">
        <brk id="25" max="16383" man="1"/>
        <brk id="50" max="16383" man="1"/>
    </rowBreaks>
    <colBreaks count="1" manualBreakCount="1">
        <brk id="5" max="1048575" man="1"/>
    </colBreaks>
</worksheet>"#;

        let settings = PrintSettings::parse(xml);

        // Verify page setup
        let setup = settings.page_setup.unwrap();
        assert_eq!(setup.paper_size, Some(PaperSize::Letter));
        assert_eq!(setup.orientation, Orientation::Portrait);
        assert_eq!(setup.scale, Some(100));
        assert_eq!(setup.fit_to_width, Some(1));
        assert_eq!(setup.fit_to_height, Some(0));
        assert_eq!(setup.horizontal_dpi, Some(300));

        // Verify margins
        let margins = settings.page_margins.unwrap();
        assert!((margins.left - 0.7).abs() < f64::EPSILON);
        assert!((margins.header - 0.3).abs() < f64::EPSILON);

        // Verify header/footer
        let hf = settings.header_footer.unwrap();
        assert!(hf.odd_header.is_some());
        assert!(hf.odd_footer.is_some());
        let header_sections = hf.odd_header_sections();
        assert_eq!(header_sections.left, "&F");
        assert_eq!(header_sections.center, "&A");
        assert_eq!(header_sections.right, "Page &P of &N");

        // Verify print options
        let opts = settings.print_options.unwrap();
        assert!(opts.grid_lines);
        assert!(opts.headings);
        assert!(opts.horizontal_centered);
        assert!(!opts.vertical_centered);

        // Verify row breaks
        let row_breaks = settings.row_breaks.unwrap();
        assert_eq!(row_breaks.count, Some(2));
        assert_eq!(row_breaks.breaks.len(), 2);
        assert_eq!(row_breaks.breaks[0].id, 25);
        assert_eq!(row_breaks.breaks[1].id, 50);

        // Verify col breaks
        let col_breaks = settings.col_breaks.unwrap();
        assert_eq!(col_breaks.count, Some(1));
        assert_eq!(col_breaks.breaks.len(), 1);
        assert_eq!(col_breaks.breaks[0].id, 5);
    }
}

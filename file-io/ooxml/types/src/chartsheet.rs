//! Chartsheet and dialogsheet types (ECMA-376 Part 1, Section 18.3).
//!
//! Types modelling the contents of chartsheet and dialogsheet parts:
//! `xl/chartsheets/sheet{N}.xml` and `xl/dialogsheets/sheet{N}.xml`.

// ============================================================================
// ChartsheetPr — CT_ChartsheetPr
// ============================================================================

/// Chartsheet properties (CT_ChartsheetPr).
///
/// Controls published state, code name, and tab colour for a chartsheet.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartsheetPr {
    /// Whether the chartsheet is published. Default: `true`.
    pub published: bool,
    /// VBA code name for the chartsheet.
    pub code_name: Option<String>,
    /// Tab colour definition.
    pub tab_color: Option<crate::styles::ColorDef>,
}

impl Default for ChartsheetPr {
    fn default() -> Self {
        Self {
            published: true,
            code_name: None,
            tab_color: None,
        }
    }
}

// ============================================================================
// ChartsheetProtection — CT_ChartsheetProtection
// ============================================================================

/// Chartsheet protection settings (CT_ChartsheetProtection).
///
/// Controls password protection and content/object locking for a chartsheet.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct ChartsheetProtection {
    /// Legacy hex password hash (ST_UnsignedShortHex).
    pub password: Option<String>,
    /// Hash algorithm name (e.g. "SHA-512").
    pub algorithm_name: Option<String>,
    /// Base64-encoded hash value.
    pub hash_value: Option<String>,
    /// Base64-encoded salt value.
    pub salt_value: Option<String>,
    /// Number of hash iterations.
    pub spin_count: Option<u32>,
    /// Whether content editing is restricted. Default: `false`.
    pub content: bool,
    /// Whether object editing is restricted. Default: `false`.
    pub objects: bool,
}

// ============================================================================
// ChartsheetView — CT_ChartsheetView
// ============================================================================

/// Chartsheet view settings (CT_ChartsheetView).
///
/// Describes zoom level, selection state, and associated workbook view for a
/// chartsheet window.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartsheetView {
    /// Whether this sheet tab is selected. Default: `false`.
    pub tab_selected: bool,
    /// Zoom percentage (10–400). Default: 100.
    pub zoom_scale: Option<u32>,
    /// Index of the parent workbook view (required).
    pub workbook_view_id: u32,
    /// Whether to zoom to fit the chart in the window. Default: `false`.
    pub zoom_to_fit: bool,
    /// Extension list for vendor-specific data.
    pub ext_lst: Option<crate::ExtensionList>,
}

impl Default for ChartsheetView {
    fn default() -> Self {
        Self {
            tab_selected: false,
            zoom_scale: Some(100),
            workbook_view_id: 0,
            zoom_to_fit: false,
            ext_lst: None,
        }
    }
}

// ============================================================================
// ChartsheetPageSetup — CT_CsPageSetup
// ============================================================================

/// Chartsheet page setup settings (CT_CsPageSetup).
///
/// Controls printing options for a chartsheet such as paper size, orientation,
/// DPI, and printer settings relationship.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartsheetPageSetup {
    /// Paper size enumeration value. Default: 1 (Letter).
    pub paper_size: Option<u32>,
    /// Custom paper height (ST_PositiveUniversalMeasure, e.g. "297mm").
    pub paper_height: Option<String>,
    /// Custom paper width (ST_PositiveUniversalMeasure, e.g. "210mm").
    pub paper_width: Option<String>,
    /// First page number. Default: 1.
    pub first_page_number: Option<u32>,
    /// Page orientation (ST_Orientation). XSD default: `Default`.
    pub orientation: Option<crate::print::Orientation>,
    /// Whether to use printer defaults. Default: `true`.
    pub use_printer_defaults: bool,
    /// Whether to print in black and white. Default: `false`.
    pub black_and_white: bool,
    /// Whether to print in draft quality. Default: `false`.
    pub draft: bool,
    /// Whether to use the first page number. Default: `false`.
    pub use_first_page_number: bool,
    /// Horizontal DPI. Default: 600.
    pub horizontal_dpi: Option<u32>,
    /// Vertical DPI. Default: 600.
    pub vertical_dpi: Option<u32>,
    /// Number of copies to print. Default: 1.
    pub copies: Option<u32>,
    /// Relationship ID to printer settings part.
    pub r_id: Option<String>,
}

impl ChartsheetPageSetup {
    /// Returns the effective orientation, using the XSD default of
    /// `Orientation::Default` when the field is absent.
    #[must_use]
    pub fn effective_orientation(&self) -> crate::print::Orientation {
        self.orientation
            .unwrap_or(crate::print::Orientation::Default)
    }
}

impl Default for ChartsheetPageSetup {
    fn default() -> Self {
        Self {
            paper_size: Some(1),
            paper_height: None,
            paper_width: None,
            first_page_number: Some(1),
            orientation: None,
            use_printer_defaults: true,
            black_and_white: false,
            draft: false,
            use_first_page_number: false,
            horizontal_dpi: Some(600),
            vertical_dpi: Some(600),
            copies: Some(1),
            r_id: None,
        }
    }
}

// ============================================================================
// CustomChartsheetView — CT_CustomChartsheetView
// ============================================================================

/// Custom chartsheet view (CT_CustomChartsheetView).
///
/// A named, per-user view of a chartsheet with independent zoom and visibility.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CustomChartsheetView {
    /// GUID identifying this custom view (required).
    pub guid: String,
    /// Zoom percentage. Default: 100.
    pub scale: Option<u32>,
    /// Visibility state of the sheet in this view. Default: Visible.
    pub state: crate::workbook::SheetState,
    /// Whether to zoom to fit the chart. Default: `false`.
    pub zoom_to_fit: bool,
    /// Page margins for this custom view.
    pub page_margins: Option<crate::ExtensionList>,
    /// Page setup for this custom view.
    pub page_setup: Option<ChartsheetPageSetup>,
    /// Header and footer for this custom view (CT_HeaderFooter, [0..1]).
    pub header_footer: Option<crate::print::HeaderFooter>,
}

impl Default for CustomChartsheetView {
    fn default() -> Self {
        Self {
            guid: String::new(),
            scale: Some(100),
            state: crate::workbook::SheetState::Visible,
            zoom_to_fit: false,
            page_margins: None,
            page_setup: None,
            header_footer: None,
        }
    }
}

// ============================================================================
// Chartsheet — CT_Chartsheet (root element)
// ============================================================================

/// Root element of a chartsheet part (CT_Chartsheet).
///
/// Top-level container for `xl/chartsheets/sheet{N}.xml`, holding chartsheet
/// properties, views, protection, and drawing references.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct Chartsheet {
    /// Chartsheet properties.
    pub sheet_pr: Option<ChartsheetPr>,
    /// Chartsheet view definitions (CT_ChartsheetViews).
    pub sheet_views: Vec<ChartsheetView>,
    /// Chartsheet protection settings.
    pub sheet_protection: Option<ChartsheetProtection>,
    /// Custom chartsheet views (CT_CustomChartsheetViews).
    pub custom_sheet_views: Vec<CustomChartsheetView>,
    /// Page margins for printing.
    pub page_margins: Option<crate::print::PageMargins>,
    /// Page setup for printing.
    pub page_setup: Option<ChartsheetPageSetup>,
    /// Header and footer (CT_HeaderFooter, [0..1]).
    pub header_footer: Option<crate::print::HeaderFooter>,
    /// Drawing header/footer (CT_DrawingHF, [0..1]).
    pub drawing_hf: Option<crate::drawing_refs::DrawingHF>,
    /// Relationship ID to the drawing part.
    pub drawing: Option<String>,
    /// Background picture (CT_SheetBackgroundPicture, [0..1]).
    pub picture: Option<crate::worksheet::SheetBackgroundPicture>,
    /// Web publish items (CT_WebPublishItems, [0..1]).
    pub web_publish_items: Option<crate::web_publish::WebPublishItems>,
    /// Extension list for vendor-specific data.
    pub ext_lst: Option<crate::ExtensionList>,
}

// ============================================================================
// Dialogsheet — CT_Dialogsheet
// ============================================================================

/// Root element of a dialogsheet part (CT_Dialogsheet).
///
/// Dialogsheets are legacy XLM dialog containers. Most child elements are
/// preserved as raw XML for round-tripping.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct Dialogsheet {
    /// Sheet properties, preserved as raw XML.
    pub sheet_pr: Option<crate::ExtensionList>,
    /// Sheet views, preserved as raw XML.
    pub sheet_views: Option<crate::ExtensionList>,
    /// Sheet format properties (CT_SheetFormatPr, [0..1]).
    pub sheet_format_pr: Option<crate::worksheet::SheetFormatProperties>,
    /// Sheet protection, preserved as raw XML.
    pub sheet_protection: Option<crate::ExtensionList>,
    /// Custom sheet views, preserved as raw XML.
    pub custom_sheet_views: Option<crate::ExtensionList>,
    /// Print options (CT_PrintOptions, [0..1]).
    pub print_options: Option<crate::print::PrintOptions>,
    /// Page margins (CT_PageMargins, [0..1]).
    pub page_margins: Option<crate::print::PageMargins>,
    /// Page setup (CT_PageSetup, [0..1]).
    pub page_setup: Option<crate::print::PageSetup>,
    /// Header and footer (CT_HeaderFooter, [0..1]).
    pub header_footer: Option<crate::print::HeaderFooter>,
    /// Drawing header/footer (CT_DrawingHF, [0..1]).
    pub drawing_hf: Option<crate::drawing_refs::DrawingHF>,
    /// Relationship ID to the drawing part.
    pub drawing: Option<String>,
    /// OLE objects, preserved as raw XML (CT_OleObjects, [0..1]).
    pub ole_objects: Option<String>,
    /// Controls, preserved as raw XML (CT_Controls, [0..1]).
    pub controls: Option<crate::controls::Controls>,
    /// Extension list for vendor-specific data.
    pub ext_lst: Option<crate::ExtensionList>,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chartsheet_default() {
        let cs = Chartsheet::default();
        assert!(cs.sheet_pr.is_none());
        assert!(cs.sheet_views.is_empty());
        assert!(cs.sheet_protection.is_none());
        assert!(cs.custom_sheet_views.is_empty());
        assert!(cs.page_margins.is_none());
        assert!(cs.page_setup.is_none());
        assert!(cs.header_footer.is_none());
        assert!(cs.drawing_hf.is_none());
        assert!(cs.drawing.is_none());
        assert!(cs.picture.is_none());
        assert!(cs.web_publish_items.is_none());
        assert!(cs.ext_lst.is_none());
    }

    #[test]
    fn chartsheet_pr_defaults() {
        let pr = ChartsheetPr::default();
        assert!(pr.published);
        assert!(pr.code_name.is_none());
        assert!(pr.tab_color.is_none());
    }

    #[test]
    fn chartsheet_protection_defaults() {
        let p = ChartsheetProtection::default();
        assert!(p.password.is_none());
        assert!(p.algorithm_name.is_none());
        assert!(p.hash_value.is_none());
        assert!(p.salt_value.is_none());
        assert!(p.spin_count.is_none());
        assert!(!p.content);
        assert!(!p.objects);
    }

    #[test]
    fn chartsheet_view_defaults() {
        let v = ChartsheetView::default();
        assert!(!v.tab_selected);
        assert_eq!(v.zoom_scale, Some(100));
        assert_eq!(v.workbook_view_id, 0);
        assert!(!v.zoom_to_fit);
        assert!(v.ext_lst.is_none());
    }

    #[test]
    fn chartsheet_page_setup_defaults() {
        let ps = ChartsheetPageSetup::default();
        assert_eq!(ps.paper_size, Some(1));
        assert!(ps.paper_height.is_none());
        assert!(ps.paper_width.is_none());
        assert_eq!(ps.first_page_number, Some(1));
        assert!(ps.orientation.is_none());
        assert_eq!(
            ps.effective_orientation(),
            crate::print::Orientation::Default
        );
        assert!(ps.use_printer_defaults);
        assert!(!ps.black_and_white);
        assert!(!ps.draft);
        assert!(!ps.use_first_page_number);
        assert_eq!(ps.horizontal_dpi, Some(600));
        assert_eq!(ps.vertical_dpi, Some(600));
        assert_eq!(ps.copies, Some(1));
        assert!(ps.r_id.is_none());
    }

    #[test]
    fn custom_chartsheet_view_defaults() {
        let v = CustomChartsheetView::default();
        assert!(v.guid.is_empty());
        assert_eq!(v.scale, Some(100));
        assert_eq!(v.state, crate::workbook::SheetState::Visible);
        assert!(!v.zoom_to_fit);
        assert!(v.page_margins.is_none());
        assert!(v.page_setup.is_none());
        assert!(v.header_footer.is_none());
    }

    #[test]
    fn dialogsheet_default() {
        let ds = Dialogsheet::default();
        assert!(ds.sheet_pr.is_none());
        assert!(ds.sheet_views.is_none());
        assert!(ds.sheet_format_pr.is_none());
        assert!(ds.sheet_protection.is_none());
        assert!(ds.custom_sheet_views.is_none());
        assert!(ds.print_options.is_none());
        assert!(ds.page_margins.is_none());
        assert!(ds.page_setup.is_none());
        assert!(ds.header_footer.is_none());
        assert!(ds.drawing_hf.is_none());
        assert!(ds.drawing.is_none());
        assert!(ds.ole_objects.is_none());
        assert!(ds.controls.is_none());
        assert!(ds.ext_lst.is_none());
    }
}

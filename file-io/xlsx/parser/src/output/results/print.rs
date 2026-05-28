use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarginsOutput {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
    pub header: f64,
    pub footer: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeaderFooterOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub odd_header: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub odd_footer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub even_header: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub even_footer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_header: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_footer: Option<String>,
    pub different_odd_even: bool,
    pub different_first: bool,
    /// Scale headers/footers with document scaling (None = not specified in original XML)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale_with_doc: Option<bool>,
    /// Align headers/footers with page margins (None = not specified in original XML)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub align_with_margins: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintSettingsOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paper_size: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paper_width: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paper_height: Option<String>,
    pub orientation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale: Option<u16>,
    /// Fit to width in pages (None = attribute absent, Some(0) = auto/unlimited)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fit_to_width: Option<u16>,
    /// Fit to height in pages (None = attribute absent, Some(0) = auto/unlimited)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fit_to_height: Option<u16>,
    pub grid_lines: bool,
    #[serde(default = "default_grid_lines_set")]
    pub grid_lines_set: bool,
    pub headings: bool,
    pub horizontal_centered: bool,
    pub vertical_centered: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub margins: Option<MarginsOutput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_footer: Option<HeaderFooterOutput>,
    /// Whether a `<pageSetup>` element was present in the original XML.
    /// When false, the writer should not emit `<pageSetup>`.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub has_page_setup: bool,
    /// Whether a `<printOptions>` element was present in the original XML.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub has_print_options: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horizontal_dpi: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical_dpi: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r_id: Option<String>,
    /// Whether to use printer defaults (None = attribute absent, Some = explicit).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub use_printer_defaults: Option<bool>,
    /// Page order for printing ("downThenOver" or "overThenDown").
    /// Preserved for round-trip fidelity even when it equals the default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_order: Option<String>,
    /// Whether to use the firstPageNumber value instead of automatic numbering.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub use_first_page_number: bool,
    /// First page number (None = attribute absent, Some(0) = auto).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_page_number: Option<u32>,
    /// Print in black and white.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub black_and_white: bool,
    /// Print in draft quality.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub draft: bool,
    /// How to print cell comments ("none", "atEnd", "asDisplayed").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cell_comments: Option<String>,
    /// How to print cell errors ("displayed", "blank", "dash", "NA").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub print_errors: Option<String>,
    /// Number of copies to print.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub copies: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_setup_properties: Option<PageSetupPropertiesOutput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSetupPropertiesOutput {
    pub fit_to_page: bool,
    pub auto_page_breaks: bool,
}

fn default_grid_lines_set() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageBreakOutput {
    pub id: u32,
    pub min: u32,
    pub max: u32,
    pub man: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub pt: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageBreaksOutput {
    pub row_breaks: Vec<PageBreakOutput>,
    pub col_breaks: Vec<PageBreakOutput>,
}

impl From<&crate::domain::print::PageMargins> for MarginsOutput {
    fn from(m: &crate::domain::print::PageMargins) -> Self {
        Self {
            top: m.top,
            right: m.right,
            bottom: m.bottom,
            left: m.left,
            header: m.header,
            footer: m.footer,
        }
    }
}

impl From<&crate::domain::print::HeaderFooter> for HeaderFooterOutput {
    fn from(hf: &crate::domain::print::HeaderFooter) -> Self {
        Self {
            odd_header: hf.odd_header.clone(),
            odd_footer: hf.odd_footer.clone(),
            even_header: hf.even_header.clone(),
            even_footer: hf.even_footer.clone(),
            first_header: hf.first_header.clone(),
            first_footer: hf.first_footer.clone(),
            different_odd_even: hf.different_odd_even,
            different_first: hf.different_first,
            scale_with_doc: hf.scale_with_doc,
            align_with_margins: hf.align_with_margins,
        }
    }
}

impl From<&crate::domain::print::PageBreak> for PageBreakOutput {
    fn from(b: &crate::domain::print::PageBreak) -> Self {
        Self {
            id: b.id,
            min: b.min,
            max: b.max,
            man: b.manual,
            pt: b.pt,
        }
    }
}

/// Build structured print settings + page breaks from the parsed PrintSettings.
///
/// Returns `(print_settings, page_breaks)`. Both are `None` if no settings are present.
pub fn build_print_settings_output(
    ps: &crate::domain::print::PrintSettings,
) -> (Option<PrintSettingsOutput>, Option<PageBreaksOutput>) {
    if !ps.has_settings() {
        return (None, None);
    }

    let page_setup = ps.page_setup.as_ref();
    let print_options = ps.print_options.as_ref();

    let settings = PrintSettingsOutput {
        paper_size: page_setup.and_then(|p| p.paper_size.map(|ps| ps.as_u32())),
        paper_width: page_setup
            .and_then(|p| p.paper_width.as_ref().map(|v| v.to_ooxml().to_string())),
        paper_height: page_setup
            .and_then(|p| p.paper_height.as_ref().map(|v| v.to_ooxml().to_string())),
        orientation: page_setup
            .map(|p| p.orientation.to_ooxml().to_string())
            .unwrap_or_else(|| "default".to_string()),
        scale: page_setup.and_then(|p| p.scale),
        fit_to_width: page_setup.and_then(|p| p.fit_to_width),
        fit_to_height: page_setup.and_then(|p| p.fit_to_height),
        grid_lines: print_options.map(|o| o.grid_lines).unwrap_or(false),
        grid_lines_set: print_options.map(|o| o.grid_lines_set).unwrap_or(true),
        headings: print_options.map(|o| o.headings).unwrap_or(false),
        horizontal_centered: print_options
            .map(|o| o.horizontal_centered)
            .unwrap_or(false),
        vertical_centered: print_options.map(|o| o.vertical_centered).unwrap_or(false),
        margins: ps.page_margins.as_ref().map(MarginsOutput::from),
        header_footer: ps.header_footer.as_ref().map(HeaderFooterOutput::from),
        has_page_setup: page_setup.is_some(),
        has_print_options: print_options.is_some(),
        horizontal_dpi: page_setup.and_then(|p| p.horizontal_dpi),
        vertical_dpi: page_setup.and_then(|p| p.vertical_dpi),
        r_id: page_setup.and_then(|p| p.r_id.clone()),
        use_printer_defaults: page_setup.and_then(|p| p.use_printer_defaults),
        page_order: page_setup.and_then(|p| p.page_order.map(|po| po.to_ooxml().to_string())),
        use_first_page_number: page_setup.map(|p| p.use_first_page_number).unwrap_or(false),
        first_page_number: page_setup.and_then(|p| p.first_page_number),
        black_and_white: page_setup.map(|p| p.black_and_white).unwrap_or(false),
        draft: page_setup.map(|p| p.draft).unwrap_or(false),
        cell_comments: page_setup.and_then(|p| {
            let s = p.cell_comments.to_ooxml();
            if s == "none" {
                None
            } else {
                Some(s.to_string())
            }
        }),
        print_errors: page_setup.and_then(|p| {
            let s = p.errors.to_ooxml();
            if s == "displayed" {
                None
            } else {
                Some(s.to_string())
            }
        }),
        copies: page_setup.and_then(|p| p.copies),
        page_setup_properties: ps.page_setup_properties.as_ref().map(|props| {
            PageSetupPropertiesOutput {
                fit_to_page: props.fit_to_page,
                auto_page_breaks: props.auto_page_breaks,
            }
        }),
    };

    let row_breaks: Vec<PageBreakOutput> = ps
        .row_breaks
        .as_ref()
        .map(|rb| rb.breaks.iter().map(PageBreakOutput::from).collect())
        .unwrap_or_default();

    let col_breaks: Vec<PageBreakOutput> = ps
        .col_breaks
        .as_ref()
        .map(|cb| cb.breaks.iter().map(PageBreakOutput::from).collect())
        .unwrap_or_default();

    let page_breaks = if row_breaks.is_empty() && col_breaks.is_empty() {
        None
    } else {
        Some(PageBreaksOutput {
            row_breaks,
            col_breaks,
        })
    };

    (Some(settings), page_breaks)
}

// =============================================================================
// PivotTableOutput and ChartImportOutput — REMOVED
// =============================================================================
// These intermediate types have been removed. The parser now produces
// `domain_types::PivotSpec` and `domain_types::ChartSpec` directly.
// See `domain/pivot/read.rs` and `domain/charts/read.rs`.

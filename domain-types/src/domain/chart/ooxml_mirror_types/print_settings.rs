use serde::{Deserialize, Serialize};

use ooxml_types::charts as ocharts;

/// Page orientation (ST_PageSetupOrientation).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PageOrientation {
    #[default]
    Default,
    Portrait,
    Landscape,
}

impl From<ocharts::PageOrientation> for PageOrientation {
    fn from(v: ocharts::PageOrientation) -> Self {
        match v {
            ocharts::PageOrientation::Default => Self::Default,
            ocharts::PageOrientation::Portrait => Self::Portrait,
            ocharts::PageOrientation::Landscape => Self::Landscape,
        }
    }
}

impl From<PageOrientation> for ocharts::PageOrientation {
    fn from(v: PageOrientation) -> Self {
        match v {
            PageOrientation::Default => Self::Default,
            PageOrientation::Portrait => Self::Portrait,
            PageOrientation::Landscape => Self::Landscape,
        }
    }
}

/// Page margins for print settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartPageMargins {
    pub left: f64,
    pub right: f64,
    pub top: f64,
    pub bottom: f64,
    pub header: f64,
    pub footer: f64,
}

impl Default for ChartPageMargins {
    fn default() -> Self {
        Self {
            left: 0.7,
            right: 0.7,
            top: 0.75,
            bottom: 0.75,
            header: 0.3,
            footer: 0.3,
        }
    }
}

impl From<&ocharts::PageMargins> for ChartPageMargins {
    fn from(p: &ocharts::PageMargins) -> Self {
        Self {
            left: p.left,
            right: p.right,
            top: p.top,
            bottom: p.bottom,
            header: p.header,
            footer: p.footer,
        }
    }
}

impl From<ChartPageMargins> for ocharts::PageMargins {
    fn from(p: ChartPageMargins) -> Self {
        Self {
            left: p.left,
            right: p.right,
            top: p.top,
            bottom: p.bottom,
            header: p.header,
            footer: p.footer,
        }
    }
}

/// Page setup for chart print settings (CT_PageSetup).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct ChartPageSetup {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paper_size: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paper_height: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paper_width: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_page_number: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orientation: Option<PageOrientation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub black_and_white: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub draft: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_first_page_number: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horizontal_dpi: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical_dpi: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub copies: Option<u32>,
}

impl From<&ocharts::PageSetup> for ChartPageSetup {
    fn from(p: &ocharts::PageSetup) -> Self {
        Self {
            paper_size: p.paper_size,
            paper_height: p.paper_height.clone(),
            paper_width: p.paper_width.clone(),
            first_page_number: p.first_page_number,
            orientation: p.orientation.map(Into::into),
            black_and_white: p.black_and_white,
            draft: p.draft,
            use_first_page_number: p.use_first_page_number,
            horizontal_dpi: p.horizontal_dpi,
            vertical_dpi: p.vertical_dpi,
            copies: p.copies,
        }
    }
}

impl From<ChartPageSetup> for ocharts::PageSetup {
    fn from(p: ChartPageSetup) -> Self {
        Self {
            paper_size: p.paper_size,
            paper_height: p.paper_height,
            paper_width: p.paper_width,
            first_page_number: p.first_page_number,
            orientation: p.orientation.map(Into::into),
            black_and_white: p.black_and_white,
            draft: p.draft,
            use_first_page_number: p.use_first_page_number,
            horizontal_dpi: p.horizontal_dpi,
            vertical_dpi: p.vertical_dpi,
            copies: p.copies,
        }
    }
}

/// Header/footer for chart print settings (CT_HeaderFooter).
///
/// Mirror of `ooxml_types::print::HeaderFooter`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct ChartHeaderFooter {
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
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub different_odd_even: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub different_first: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale_with_doc: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub align_with_margins: Option<bool>,
}

impl From<&ooxml_types::print::HeaderFooter> for ChartHeaderFooter {
    fn from(h: &ooxml_types::print::HeaderFooter) -> Self {
        Self {
            odd_header: h.odd_header.clone(),
            odd_footer: h.odd_footer.clone(),
            even_header: h.even_header.clone(),
            even_footer: h.even_footer.clone(),
            first_header: h.first_header.clone(),
            first_footer: h.first_footer.clone(),
            different_odd_even: h.different_odd_even,
            different_first: h.different_first,
            scale_with_doc: h.scale_with_doc,
            align_with_margins: h.align_with_margins,
        }
    }
}

impl From<ChartHeaderFooter> for ooxml_types::print::HeaderFooter {
    fn from(h: ChartHeaderFooter) -> Self {
        Self {
            odd_header: h.odd_header,
            odd_footer: h.odd_footer,
            even_header: h.even_header,
            even_footer: h.even_footer,
            first_header: h.first_header,
            first_footer: h.first_footer,
            different_odd_even: h.different_odd_even,
            different_first: h.different_first,
            scale_with_doc: h.scale_with_doc,
            align_with_margins: h.align_with_margins,
        }
    }
}

/// Chart print settings (CT_PrintSettings).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct ChartPrintSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_footer: Option<ChartHeaderFooter>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_margins: Option<ChartPageMargins>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_setup: Option<ChartPageSetup>,
    /// Legacy drawing for header/footer (CT_RelId) — relationship ID pointing
    /// to a VML drawing part used for header/footer images.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legacy_drawing_hf: Option<String>,
}

impl From<&ocharts::PrintSettings> for ChartPrintSettings {
    fn from(p: &ocharts::PrintSettings) -> Self {
        Self {
            header_footer: p.header_footer.as_ref().map(Into::into),
            page_margins: p.page_margins.as_ref().map(Into::into),
            page_setup: p.page_setup.as_ref().map(Into::into),
            legacy_drawing_hf: p.legacy_drawing_hf.clone(),
        }
    }
}

impl From<ChartPrintSettings> for ocharts::PrintSettings {
    fn from(p: ChartPrintSettings) -> Self {
        Self {
            header_footer: p.header_footer.map(Into::into),
            page_margins: p.page_margins.map(Into::into),
            page_setup: p.page_setup.map(Into::into),
            legacy_drawing_hf: p.legacy_drawing_hf,
        }
    }
}

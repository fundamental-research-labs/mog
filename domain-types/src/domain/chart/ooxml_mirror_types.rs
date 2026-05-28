//! Chart-specific OOXML mirror domain types.
//!
//! Typed domain wrappers for `ooxml_types::charts::*` fields that need a stable
//! storage/API shape while the broader chart model is elevated.
//!
//! Each type:
//! - has a `camelCase` JSON serialization,
//! - ships with `Default` that emits no keys (where meaningful),
//! - provides bidirectional `From<&ooxml>` and `From<domain> for ooxml`
//!   converters covering the structural content of the mirror.
//!
//! Types with deeply nested OOXML sub-parts that overlap the broader
//! drawings/text-body model (ChartPivotFormat -> sp_pr/tx_pr/marker/d_lbl;
//! ChartTypeConfig -> chart-type-specific deep configs) keep the outer chart
//! contract typed and use the established OOXML extension-entry structures for
//! opaque vendor extension payloads.

use serde::{Deserialize, Serialize};

use ooxml_types::charts as ocharts;
use ooxml_types::themes as othemes;

// ===========================================================================
// ChartProtection (CT_Protection, row 2.5)
// ===========================================================================

/// Chart protection settings — mirror of `ooxml_types::charts::ChartProtection`.
///
/// All fields optional per ECMA-376 §21.2.2.152; `Default` emits no keys.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct ChartProtection {
    /// Protect chart object from being moved/resized (`@chartObject`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chart_object: Option<bool>,
    /// Protect data from being changed (`@data`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<bool>,
    /// Protect formatting from being changed (`@formatting`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formatting: Option<bool>,
    /// Protect selection (`@selection`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection: Option<bool>,
    /// Protect user interface (`@userInterface`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_interface: Option<bool>,
}

impl From<&ocharts::ChartProtection> for ChartProtection {
    fn from(p: &ocharts::ChartProtection) -> Self {
        Self {
            chart_object: p.chart_object,
            data: p.data,
            formatting: p.formatting,
            selection: p.selection,
            user_interface: p.user_interface,
        }
    }
}

impl From<ChartProtection> for ocharts::ChartProtection {
    fn from(p: ChartProtection) -> Self {
        Self {
            chart_object: p.chart_object,
            data: p.data,
            formatting: p.formatting,
            selection: p.selection,
            user_interface: p.user_interface,
        }
    }
}

// ===========================================================================
// ChartPrintSettings (CT_PrintSettings, row 2.6)
// ===========================================================================

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
        // Match ooxml-types default so round-trip is lossless.
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

// ===========================================================================
// ChartPivotSource (CT_PivotSource)
// ===========================================================================

/// Pivot source metadata (CT_PivotSource) — links a chart to its source pivot.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct ChartPivotSource {
    /// Name of the source PivotTable (`<c:name>`).
    pub name: String,
    /// Format ID (`<c:fmtId>` / `@val`).
    pub fmt_id: u32,
    /// Opaque extension entries from `<c:extLst>`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extensions: Vec<ocharts::ExtensionEntry>,
}

impl From<&ocharts::PivotSource> for ChartPivotSource {
    fn from(p: &ocharts::PivotSource) -> Self {
        Self {
            name: p.name.clone(),
            fmt_id: p.fmt_id,
            extensions: p.extensions.clone(),
        }
    }
}

impl From<ChartPivotSource> for ocharts::PivotSource {
    fn from(p: ChartPivotSource) -> Self {
        Self {
            name: p.name,
            fmt_id: p.fmt_id,
            extensions: p.extensions,
        }
    }
}

// ===========================================================================
// ChartPivotFormat (CT_PivotFmt, row 2.9)
// ===========================================================================

/// Per-element formatting override for pivot charts (CT_PivotFmt).
///
/// **Minimum wrapper** (see module docs): `idx` is modelled directly; the
/// formatting sub-parts (`sp_pr`, `tx_pr`, `marker`, `d_lbl`) are carried
/// opaquely in an inner OOXML-aligned payload until drawing primitives and
/// text-body elevation land. Serialization is transparent so corpus fidelity is
/// preserved.
///
/// Note: some older inventory docs mention `pivot_area` for this row; that
/// element does not exist on `CT_PivotFmt` in ECMA-376 (it lives on pivot
/// tables, not pivot charts). The actual OOXML fields `idx`, `sp_pr`, `tx_pr`,
/// `marker`, `d_lbl`, `extLst` are what this mirror covers.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct ChartPivotFormat {
    /// Index of the element this format applies to.
    pub idx: u32,
    /// Opaque nested payload holding `sp_pr`, `tx_pr`, `marker`, `d_lbl`, and
    /// `extLst` serialized as JSON. Deeper typing is tracked as follow-up
    /// alongside the broader drawing-primitive elevation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inner: Option<String>,
}

impl From<&ocharts::PivotFmt> for ChartPivotFormat {
    fn from(p: &ocharts::PivotFmt) -> Self {
        // Serialize every field except idx into the inner blob for lossless
        // round-trip. The inner blob is produced from a mirror struct so we
        // don't tie our on-disk Yrs shape to the ooxml struct's exact serde
        // layout (it may change upstream without our knowledge).
        #[derive(Serialize)]
        struct Inner<'a> {
            #[serde(skip_serializing_if = "Option::is_none")]
            sp_pr: Option<&'a ooxml_types::drawings::ShapeProperties>,
            #[serde(skip_serializing_if = "Option::is_none")]
            tx_pr: Option<&'a ooxml_types::drawings::TextBody>,
            #[serde(skip_serializing_if = "Option::is_none")]
            marker: Option<&'a ocharts::Marker>,
            #[serde(skip_serializing_if = "Option::is_none")]
            d_lbl: Option<&'a ocharts::DataLabel>,
            #[serde(skip_serializing_if = "Vec::is_empty")]
            extensions: &'a Vec<ocharts::ExtensionEntry>,
        }
        let inner_val = Inner {
            sp_pr: p.sp_pr.as_ref(),
            tx_pr: p.tx_pr.as_ref(),
            marker: p.marker.as_ref(),
            d_lbl: p.d_lbl.as_ref(),
            extensions: &p.extensions,
        };
        let inner = if p.sp_pr.is_none()
            && p.tx_pr.is_none()
            && p.marker.is_none()
            && p.d_lbl.is_none()
            && p.extensions.is_empty()
        {
            None
        } else {
            serde_json::to_string(&inner_val).ok()
        };
        Self { idx: p.idx, inner }
    }
}

impl From<ChartPivotFormat> for ocharts::PivotFmt {
    fn from(p: ChartPivotFormat) -> Self {
        #[derive(Deserialize, Default)]
        struct Inner {
            #[serde(default)]
            sp_pr: Option<ooxml_types::drawings::ShapeProperties>,
            #[serde(default)]
            tx_pr: Option<ooxml_types::drawings::TextBody>,
            #[serde(default)]
            marker: Option<ocharts::Marker>,
            #[serde(default)]
            d_lbl: Option<ocharts::DataLabel>,
            #[serde(default)]
            extensions: Vec<ocharts::ExtensionEntry>,
        }
        let inner: Inner = p
            .inner
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default();
        Self {
            idx: p.idx,
            sp_pr: inner.sp_pr,
            tx_pr: inner.tx_pr,
            marker: inner.marker,
            d_lbl: inner.d_lbl,
            extensions: inner.extensions,
        }
    }
}

// ===========================================================================
// ChartColorMappingOverride (CT_ColorMappingOverride, row 2.10)
// ===========================================================================

/// Color scheme slot identifier (ST_ColorSchemeIndex).
///
/// Domain mirror of `ooxml_types::themes::ColorSchemeIndex`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ColorSchemeSlot {
    Dk1,
    Lt1,
    Dk2,
    Lt2,
    Accent1,
    Accent2,
    Accent3,
    Accent4,
    Accent5,
    Accent6,
    Hlink,
    FolHlink,
}

impl From<othemes::ColorSchemeIndex> for ColorSchemeSlot {
    fn from(v: othemes::ColorSchemeIndex) -> Self {
        match v {
            othemes::ColorSchemeIndex::Dk1 => Self::Dk1,
            othemes::ColorSchemeIndex::Lt1 => Self::Lt1,
            othemes::ColorSchemeIndex::Dk2 => Self::Dk2,
            othemes::ColorSchemeIndex::Lt2 => Self::Lt2,
            othemes::ColorSchemeIndex::Accent1 => Self::Accent1,
            othemes::ColorSchemeIndex::Accent2 => Self::Accent2,
            othemes::ColorSchemeIndex::Accent3 => Self::Accent3,
            othemes::ColorSchemeIndex::Accent4 => Self::Accent4,
            othemes::ColorSchemeIndex::Accent5 => Self::Accent5,
            othemes::ColorSchemeIndex::Accent6 => Self::Accent6,
            othemes::ColorSchemeIndex::Hlink => Self::Hlink,
            othemes::ColorSchemeIndex::FolHlink => Self::FolHlink,
        }
    }
}

impl From<ColorSchemeSlot> for othemes::ColorSchemeIndex {
    fn from(v: ColorSchemeSlot) -> Self {
        match v {
            ColorSchemeSlot::Dk1 => Self::Dk1,
            ColorSchemeSlot::Lt1 => Self::Lt1,
            ColorSchemeSlot::Dk2 => Self::Dk2,
            ColorSchemeSlot::Lt2 => Self::Lt2,
            ColorSchemeSlot::Accent1 => Self::Accent1,
            ColorSchemeSlot::Accent2 => Self::Accent2,
            ColorSchemeSlot::Accent3 => Self::Accent3,
            ColorSchemeSlot::Accent4 => Self::Accent4,
            ColorSchemeSlot::Accent5 => Self::Accent5,
            ColorSchemeSlot::Accent6 => Self::Accent6,
            ColorSchemeSlot::Hlink => Self::Hlink,
            ColorSchemeSlot::FolHlink => Self::FolHlink,
        }
    }
}

/// Full 12-slot color mapping (CT_ColorMapping without extLst).
///
/// Matches the 12 logical color slots of the theme.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartColorMapping {
    pub bg1: ColorSchemeSlot,
    pub tx1: ColorSchemeSlot,
    pub bg2: ColorSchemeSlot,
    pub tx2: ColorSchemeSlot,
    pub accent1: ColorSchemeSlot,
    pub accent2: ColorSchemeSlot,
    pub accent3: ColorSchemeSlot,
    pub accent4: ColorSchemeSlot,
    pub accent5: ColorSchemeSlot,
    pub accent6: ColorSchemeSlot,
    pub hlink: ColorSchemeSlot,
    pub fol_hlink: ColorSchemeSlot,
}

impl From<&othemes::ColorMapping> for ChartColorMapping {
    fn from(m: &othemes::ColorMapping) -> Self {
        // Note: `m.ext_lst` is intentionally dropped at this layer; the
        // color-mapping variant here is the inline mapping only.
        Self {
            bg1: m.bg1.into(),
            tx1: m.tx1.into(),
            bg2: m.bg2.into(),
            tx2: m.tx2.into(),
            accent1: m.accent1.into(),
            accent2: m.accent2.into(),
            accent3: m.accent3.into(),
            accent4: m.accent4.into(),
            accent5: m.accent5.into(),
            accent6: m.accent6.into(),
            hlink: m.hlink.into(),
            fol_hlink: m.fol_hlink.into(),
        }
    }
}

impl From<ChartColorMapping> for othemes::ColorMapping {
    fn from(m: ChartColorMapping) -> Self {
        Self {
            bg1: m.bg1.into(),
            tx1: m.tx1.into(),
            bg2: m.bg2.into(),
            tx2: m.tx2.into(),
            accent1: m.accent1.into(),
            accent2: m.accent2.into(),
            accent3: m.accent3.into(),
            accent4: m.accent4.into(),
            accent5: m.accent5.into(),
            accent6: m.accent6.into(),
            hlink: m.hlink.into(),
            fol_hlink: m.fol_hlink.into(),
            ext_lst: None,
        }
    }
}

/// Color mapping override (CT_ColorMappingOverride).
///
/// Either the chart inherits the master color mapping (presence of the empty
/// `<a:masterClrMapping/>` element) or specifies a full override.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
#[derive(Default)]
pub enum ChartColorMappingOverride {
    /// Inherit from the master theme (no override).
    #[default]
    Master,
    /// Full per-slot override.
    Override(ChartColorMapping),
}

impl From<&othemes::ColorMappingOverride> for ChartColorMappingOverride {
    fn from(v: &othemes::ColorMappingOverride) -> Self {
        match v {
            othemes::ColorMappingOverride::MasterClrMapping => Self::Master,
            othemes::ColorMappingOverride::OverrideClrMapping(m) => Self::Override(m.into()),
        }
    }
}

impl From<ChartColorMappingOverride> for othemes::ColorMappingOverride {
    fn from(v: ChartColorMappingOverride) -> Self {
        match v {
            ChartColorMappingOverride::Master => Self::MasterClrMapping,
            ChartColorMappingOverride::Override(m) => Self::OverrideClrMapping(m.into()),
        }
    }
}

// ===========================================================================
// WaterfallOptions (row 2.4)
// ===========================================================================
//
// `ChartData.waterfall` was previously `Option<serde_json::Value>`; waterfall
// options live on ChartEx (`cx:layoutPr`). Per ECMA-376 the structured content
// is subtotals indices + connector-line visibility flag; more advanced
// formatting rides on series-level ChartExDataPoint overrides and is covered
// by the ongoing chart-series elevation.

/// Waterfall-chart specific options.
///
/// Mirrors the `cx:layoutPr` bits relevant to waterfall charts: subtotal
/// indices and connector-line visibility.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct WaterfallOptions {
    /// Zero-based indices of data points rendered as subtotals.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub subtotal_indices: Vec<u32>,
    /// Whether connector lines between bars are drawn.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_connector_lines: Option<bool>,
}

// ===========================================================================
// ChartTypeConfig (row 2.14)
// ===========================================================================
//
// `ChartTypeConfig` is a 17-variant enum in `ooxml_types` whose inner configs
// (BarChartConfig, LineChartConfig, …) carry chart-type-specific settings plus
// deeply-nested DataLabelOptions / ChartSeries / ChartLines / ExtensionEntry
// sub-trees. Those nested parts overlap ongoing drawing-primitive and
// data-label elevation work that belongs to the ChartData <-> CT_ChartSpace
// elevation.
//
// This minimum wrapper carries the variant discriminant plus the common
// scalar template fields
// (`gap_width`, `overlap`, `grouping`, `bar_dir`, `first_slice_ang`,
// `hole_size`, `bubble_scale`, `split_type`, `split_pos`, `vary_colors`,
// `bar_shape`) that the writer actually reads from the template in
// `reconstruct.rs`. Deeper content is preserved opaquely via an `inner`
// sidecar so corpus round-trip stays lossless.

/// Chart-type variant discriminant (read-side mirror of OOXML element names).
///
/// Domain counterpart of `ooxml_types::charts::ChartType` — deliberately
/// kept distinct from `domain::chart::ChartType` (which is a lossier,
/// simpler enum for the UI wire).
///
/// This enum is a strict superset of `ooxml_types::charts::ChartType`: every
/// OOXML variant maps 1:1.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OoxmlChartTypeKind {
    #[default]
    Unknown,
    Bar,
    Bar3D,
    Line,
    Line3D,
    Pie,
    Pie3D,
    Doughnut,
    Area,
    Area3D,
    Scatter,
    Bubble,
    Radar,
    Surface,
    Surface3D,
    Stock,
    OfPie,
    Combo,
}

impl From<ocharts::ChartType> for OoxmlChartTypeKind {
    fn from(v: ocharts::ChartType) -> Self {
        match v {
            ocharts::ChartType::Unknown => Self::Unknown,
            ocharts::ChartType::Bar => Self::Bar,
            ocharts::ChartType::Bar3D => Self::Bar3D,
            ocharts::ChartType::Line => Self::Line,
            ocharts::ChartType::Line3D => Self::Line3D,
            ocharts::ChartType::Pie => Self::Pie,
            ocharts::ChartType::Pie3D => Self::Pie3D,
            ocharts::ChartType::Doughnut => Self::Doughnut,
            ocharts::ChartType::Area => Self::Area,
            ocharts::ChartType::Area3D => Self::Area3D,
            ocharts::ChartType::Scatter => Self::Scatter,
            ocharts::ChartType::Bubble => Self::Bubble,
            ocharts::ChartType::Radar => Self::Radar,
            ocharts::ChartType::Surface => Self::Surface,
            ocharts::ChartType::Surface3D => Self::Surface3D,
            ocharts::ChartType::Stock => Self::Stock,
            ocharts::ChartType::OfPie => Self::OfPie,
            ocharts::ChartType::Combo => Self::Combo,
        }
    }
}

impl From<OoxmlChartTypeKind> for ocharts::ChartType {
    fn from(v: OoxmlChartTypeKind) -> Self {
        match v {
            OoxmlChartTypeKind::Unknown => Self::Unknown,
            OoxmlChartTypeKind::Bar => Self::Bar,
            OoxmlChartTypeKind::Bar3D => Self::Bar3D,
            OoxmlChartTypeKind::Line => Self::Line,
            OoxmlChartTypeKind::Line3D => Self::Line3D,
            OoxmlChartTypeKind::Pie => Self::Pie,
            OoxmlChartTypeKind::Pie3D => Self::Pie3D,
            OoxmlChartTypeKind::Doughnut => Self::Doughnut,
            OoxmlChartTypeKind::Area => Self::Area,
            OoxmlChartTypeKind::Area3D => Self::Area3D,
            OoxmlChartTypeKind::Scatter => Self::Scatter,
            OoxmlChartTypeKind::Bubble => Self::Bubble,
            OoxmlChartTypeKind::Radar => Self::Radar,
            OoxmlChartTypeKind::Surface => Self::Surface,
            OoxmlChartTypeKind::Surface3D => Self::Surface3D,
            OoxmlChartTypeKind::Stock => Self::Stock,
            OoxmlChartTypeKind::OfPie => Self::OfPie,
            OoxmlChartTypeKind::Combo => Self::Combo,
        }
    }
}

/// Chart-type configuration template (CT_*Chart choice of CT_PlotArea).
///
/// See module docs for the minimum-wrapper rationale. `kind` is the variant
/// discriminant. `inner` holds the full OOXML per-variant config (e.g.
/// CT_BarChart fields) serialized as JSON for lossless round-trip while
/// deeper modelling is deferred.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct ChartTypeConfig {
    /// Chart-type variant discriminant.
    pub kind: OoxmlChartTypeKind,
    /// Deep per-variant configuration (CT_BarChart / CT_LineChart / …),
    /// serialized opaquely as JSON. Structured typing is a follow-up slice
    /// tracked alongside the broader ChartData ←→ CT_ChartSpace elevation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inner: Option<String>,
}

impl From<&ocharts::ChartTypeConfig> for ChartTypeConfig {
    fn from(c: &ocharts::ChartTypeConfig) -> Self {
        // Combo has no per-variant payload.
        let inner = match c {
            ocharts::ChartTypeConfig::Combo => None,
            other => serde_json::to_string(other).ok(),
        };
        Self {
            kind: c.chart_type().into(),
            inner,
        }
    }
}

impl From<ChartTypeConfig> for ocharts::ChartTypeConfig {
    fn from(c: ChartTypeConfig) -> Self {
        if matches!(c.kind, OoxmlChartTypeKind::Combo) {
            return Self::Combo;
        }
        if let Some(inner) = c.inner.as_deref()
            && let Ok(parsed) = serde_json::from_str::<ocharts::ChartTypeConfig>(inner)
        {
            return parsed;
        }
        // Fallback: build a default config for the kind. This should be
        // unreachable in practice — serialized inner is always produced on
        // the read path for non-Combo variants.
        default_config_for_kind(c.kind)
    }
}

fn default_config_for_kind(kind: OoxmlChartTypeKind) -> ocharts::ChartTypeConfig {
    use ocharts::*;
    match kind {
        OoxmlChartTypeKind::Bar => ChartTypeConfig::Bar(BarChartConfig::default()),
        OoxmlChartTypeKind::Bar3D => ChartTypeConfig::Bar3D(Bar3DChartConfig::default()),
        OoxmlChartTypeKind::Line => ChartTypeConfig::Line(LineChartConfig::default()),
        OoxmlChartTypeKind::Line3D => ChartTypeConfig::Line3D(Line3DChartConfig::default()),
        OoxmlChartTypeKind::Pie => ChartTypeConfig::Pie(PieChartConfig::default()),
        OoxmlChartTypeKind::Pie3D => ChartTypeConfig::Pie3D(Pie3DChartConfig::default()),
        OoxmlChartTypeKind::Doughnut => ChartTypeConfig::Doughnut(DoughnutChartConfig::default()),
        OoxmlChartTypeKind::Area => ChartTypeConfig::Area(AreaChartConfig::default()),
        OoxmlChartTypeKind::Area3D => ChartTypeConfig::Area3D(Area3DChartConfig::default()),
        OoxmlChartTypeKind::Scatter => ChartTypeConfig::Scatter(ScatterChartConfig::default()),
        OoxmlChartTypeKind::Bubble => ChartTypeConfig::Bubble(BubbleChartConfig::default()),
        OoxmlChartTypeKind::Radar => ChartTypeConfig::Radar(RadarChartConfig::default()),
        OoxmlChartTypeKind::Surface => ChartTypeConfig::Surface(SurfaceChartConfig::default()),
        OoxmlChartTypeKind::Surface3D => ChartTypeConfig::Surface3D(SurfaceChartConfig::default()),
        OoxmlChartTypeKind::Stock => ChartTypeConfig::Stock(StockChartConfig::default()),
        OoxmlChartTypeKind::OfPie => ChartTypeConfig::OfPie(OfPieChartConfig::default()),
        OoxmlChartTypeKind::Combo | OoxmlChartTypeKind::Unknown => ChartTypeConfig::Combo,
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -- ChartProtection --

    #[test]
    fn protection_round_trip_full() {
        let original = ocharts::ChartProtection {
            chart_object: Some(true),
            data: Some(false),
            formatting: Some(true),
            selection: Some(false),
            user_interface: Some(true),
        };
        let dom: ChartProtection = (&original).into();
        let round: ocharts::ChartProtection = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn protection_default_emits_no_keys() {
        let p = ChartProtection::default();
        assert_eq!(serde_json::to_string(&p).unwrap(), "{}");
    }

    // -- ChartPrintSettings --

    #[test]
    fn print_settings_round_trip_full() {
        let original = ocharts::PrintSettings {
            header_footer: Some(ooxml_types::print::HeaderFooter {
                odd_header: Some("H".into()),
                odd_footer: Some("F".into()),
                even_header: None,
                even_footer: None,
                first_header: None,
                first_footer: None,
                different_odd_even: true,
                different_first: false,
                scale_with_doc: Some(true),
                align_with_margins: Some(false),
            }),
            page_margins: Some(ocharts::PageMargins {
                left: 1.0,
                right: 1.0,
                top: 0.5,
                bottom: 0.5,
                header: 0.25,
                footer: 0.25,
            }),
            page_setup: Some(ocharts::PageSetup {
                paper_size: Some(9),
                paper_height: Some("297mm".into()),
                paper_width: Some("210mm".into()),
                first_page_number: Some(1),
                orientation: Some(ocharts::PageOrientation::Landscape),
                black_and_white: Some(true),
                draft: None,
                use_first_page_number: Some(true),
                horizontal_dpi: Some(300),
                vertical_dpi: Some(300),
                copies: Some(2),
            }),
            legacy_drawing_hf: Some("rId5".into()),
        };
        let dom: ChartPrintSettings = (&original).into();
        let round: ocharts::PrintSettings = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn print_settings_default_emits_no_keys() {
        let p = ChartPrintSettings::default();
        assert_eq!(serde_json::to_string(&p).unwrap(), "{}");
    }

    // -- ChartPivotSource --

    #[test]
    fn pivot_source_round_trip_empty_ext() {
        let original = ocharts::PivotSource {
            name: "PivotTable1".into(),
            fmt_id: 0,
            extensions: Vec::new(),
        };
        let dom: ChartPivotSource = (&original).into();
        let round: ocharts::PivotSource = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn pivot_source_round_trip_extensions() {
        let original = ocharts::PivotSource {
            name: "PivotTable1".into(),
            fmt_id: 7,
            extensions: vec![ocharts::ExtensionEntry {
                uri: "{pivot-source-ext}".into(),
                xml: "<c15:pivotSourceExt/>".into(),
            }],
        };
        let dom: ChartPivotSource = (&original).into();
        let round: ocharts::PivotSource = dom.into();
        assert_eq!(original, round);
    }

    // -- ChartPivotFormat --

    #[test]
    fn pivot_format_round_trip_empty() {
        let original = ocharts::PivotFmt {
            idx: 2,
            sp_pr: None,
            tx_pr: None,
            marker: None,
            d_lbl: None,
            extensions: Vec::new(),
        };
        let dom: ChartPivotFormat = (&original).into();
        let round: ocharts::PivotFmt = dom.into();
        assert_eq!(original, round);
    }

    // -- ChartColorMappingOverride --

    #[test]
    fn color_mapping_override_master() {
        let original = othemes::ColorMappingOverride::MasterClrMapping;
        let dom: ChartColorMappingOverride = (&original).into();
        let round: othemes::ColorMappingOverride = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn color_mapping_override_full() {
        let mapping = othemes::ColorMapping {
            bg1: othemes::ColorSchemeIndex::Lt2,
            tx1: othemes::ColorSchemeIndex::Dk1,
            bg2: othemes::ColorSchemeIndex::Lt1,
            tx2: othemes::ColorSchemeIndex::Dk2,
            accent1: othemes::ColorSchemeIndex::Accent1,
            accent2: othemes::ColorSchemeIndex::Accent2,
            accent3: othemes::ColorSchemeIndex::Accent3,
            accent4: othemes::ColorSchemeIndex::Accent4,
            accent5: othemes::ColorSchemeIndex::Accent5,
            accent6: othemes::ColorSchemeIndex::Accent6,
            hlink: othemes::ColorSchemeIndex::Hlink,
            fol_hlink: othemes::ColorSchemeIndex::FolHlink,
            ext_lst: None,
        };
        let original = othemes::ColorMappingOverride::OverrideClrMapping(mapping.clone());
        let dom: ChartColorMappingOverride = (&original).into();
        let round: othemes::ColorMappingOverride = dom.into();
        assert_eq!(original, round);
    }

    // -- WaterfallOptions --

    #[test]
    fn waterfall_options_default_emits_no_keys() {
        let w = WaterfallOptions::default();
        assert_eq!(serde_json::to_string(&w).unwrap(), "{}");
    }

    #[test]
    fn waterfall_options_round_trips_via_serde() {
        let w = WaterfallOptions {
            subtotal_indices: vec![0, 3, 7],
            show_connector_lines: Some(true),
        };
        let json = serde_json::to_string(&w).unwrap();
        let back: WaterfallOptions = serde_json::from_str(&json).unwrap();
        assert_eq!(w, back);
    }

    // -- ChartTypeConfig --

    #[test]
    fn chart_type_config_round_trip_bar() {
        let original = ocharts::ChartTypeConfig::Bar(ocharts::BarChartConfig {
            bar_dir: ocharts::BarDirection::Column,
            grouping: Some(ocharts::Grouping::Clustered),
            vary_colors: Some(false),
            gap_width: Some(150),
            overlap: Some(-20),
            ser: Vec::new(),
            d_lbls: None,
            ser_lines: Vec::new(),
            extensions: Vec::new(),
        });
        let dom: ChartTypeConfig = (&original).into();
        assert_eq!(dom.kind, OoxmlChartTypeKind::Bar);
        let round: ocharts::ChartTypeConfig = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn chart_type_config_combo() {
        let original = ocharts::ChartTypeConfig::Combo;
        let dom: ChartTypeConfig = (&original).into();
        assert_eq!(dom.kind, OoxmlChartTypeKind::Combo);
        assert!(dom.inner.is_none());
        let round: ocharts::ChartTypeConfig = dom.into();
        assert_eq!(original, round);
    }

    // -- OoxmlChartTypeKind enum --

    #[test]
    fn chart_type_kind_all_variants_round_trip() {
        for v in [
            ocharts::ChartType::Unknown,
            ocharts::ChartType::Bar,
            ocharts::ChartType::Bar3D,
            ocharts::ChartType::Line,
            ocharts::ChartType::Line3D,
            ocharts::ChartType::Pie,
            ocharts::ChartType::Pie3D,
            ocharts::ChartType::Doughnut,
            ocharts::ChartType::Area,
            ocharts::ChartType::Area3D,
            ocharts::ChartType::Scatter,
            ocharts::ChartType::Bubble,
            ocharts::ChartType::Radar,
            ocharts::ChartType::Surface,
            ocharts::ChartType::Surface3D,
            ocharts::ChartType::Stock,
            ocharts::ChartType::OfPie,
            ocharts::ChartType::Combo,
        ] {
            let dom: OoxmlChartTypeKind = v.into();
            let round: ocharts::ChartType = dom.into();
            assert_eq!(v, round);
        }
    }
}

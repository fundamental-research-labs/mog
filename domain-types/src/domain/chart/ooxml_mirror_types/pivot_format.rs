use serde::{Deserialize, Serialize};

use ooxml_types::charts as ocharts;

/// Per-element formatting override for pivot charts (CT_PivotFmt).
///
/// `idx` is modelled directly; the formatting sub-parts (`sp_pr`, `tx_pr`,
/// `marker`, `d_lbl`) are carried opaquely in an inner OOXML-aligned payload
/// until drawing primitives and text-body elevation land.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct ChartPivotFormat {
    /// Index of the element this format applies to.
    pub idx: u32,
    /// Opaque nested payload holding `sp_pr`, `tx_pr`, `marker`, `d_lbl`, and
    /// `extLst` serialized as JSON.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inner: Option<String>,
}

#[derive(Serialize)]
struct InnerRef<'a> {
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

impl From<&ocharts::PivotFmt> for ChartPivotFormat {
    fn from(p: &ocharts::PivotFmt) -> Self {
        let inner_val = InnerRef {
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

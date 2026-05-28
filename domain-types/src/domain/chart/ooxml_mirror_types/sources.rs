use serde::{Deserialize, Serialize};

use ooxml_types::charts as ocharts;

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

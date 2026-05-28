use serde::{Deserialize, Serialize};

use ooxml_types::charts as ocharts;

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

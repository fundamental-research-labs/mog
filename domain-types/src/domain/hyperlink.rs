use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Hyperlink {
    /// A1 notation
    pub cell_ref: String,
    /// URL or internal reference
    pub target: Option<String>,
    /// Sheet/cell location
    pub location: Option<String>,
    pub display: Option<String>,
    pub tooltip: Option<String>,
    /// Extension UID for revision tracking (xr:uid), for round-trip fidelity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
}

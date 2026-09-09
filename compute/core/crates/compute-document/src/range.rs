//! Native range metadata transported in mutation results.

use cell_types::{AxisIdentityRef, ColId, PayloadEncoding, RangeAnchor, RangeId, RangeKind, RowId};
use serde::{Deserialize, Serialize};

/// Range identity and geometry emitted alongside native range mutations.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeMetadata {
    pub range_id: RangeId,
    pub kind: RangeKind,
    pub anchor: RangeAnchor,
    pub encoding: PayloadEncoding,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row_axis: Option<AxisIdentityRef<RowId>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub col_axis: Option<AxisIdentityRef<ColId>>,
    pub row_ids: Vec<RowId>,
    pub col_ids: Vec<ColId>,
}

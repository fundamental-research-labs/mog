use crate::identity::GridIndex;
use cell_types::CellId;
use compute_document::hex::id_to_hex;
use domain_types::domain::merge::{IdentityMergedRegion, ResolvedMergedRegion};

/// Merge authority consists only of stable corner identities and authored order.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct StoredMerge {
    pub top_left_id: CellId,
    pub bottom_right_id: CellId,
    pub ord: Option<u32>,
}
impl StoredMerge {
    pub fn to_identity(&self) -> IdentityMergedRegion {
        IdentityMergedRegion {
            top_left_id: id_to_hex(self.top_left_id.as_u128()).to_string(),
            bottom_right_id: id_to_hex(self.bottom_right_id.as_u128()).to_string(),
        }
    }
    pub fn resolve(&self, grid: &GridIndex) -> Option<ResolvedMergedRegion> {
        let (sr, sc) = grid.cell_position(&self.top_left_id)?;
        let (er, ec) = grid.cell_position(&self.bottom_right_id)?;
        if sr > er || sc > ec || (sr == er && sc == ec) {
            return None;
        }
        Some(ResolvedMergedRegion::new(
            self.to_identity(),
            sr,
            sc,
            er,
            ec,
        ))
    }
}

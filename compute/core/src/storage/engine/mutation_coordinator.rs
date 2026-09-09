//! Pending native mutation results consumed by viewport patch production.

#[derive(Default)]
pub(crate) struct MutationCoordinator {
    /// Recalculation output from the most recent mutation.
    pub(super) pending_recalc: Option<snapshot_types::RecalcResult>,
    /// Format patches from the most recent formatting mutation.
    pub(super) pending_format_patches: Option<Vec<u8>>,
}

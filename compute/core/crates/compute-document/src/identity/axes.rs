use cell_types::{AxisIdentityStore, ColId, RowId};

use super::GridIndex;

impl GridIndex {
    /// Get RowId for a row index.
    #[inline]
    #[must_use]
    pub fn row_id(&self, row: u32) -> Option<RowId> {
        self.row_axis.identity_at(self.sheet_id, row)
    }

    /// Get ColId for a column index.
    #[inline]
    #[must_use]
    pub fn col_id(&self, col: u32) -> Option<ColId> {
        self.col_axis.identity_at(self.sheet_id, col)
    }

    /// Get row index for a RowId.
    #[inline]
    #[must_use]
    pub fn row_index(&self, row_id: &RowId) -> Option<u32> {
        self.row_axis.position_of(self.sheet_id, *row_id)
    }

    /// Get column index for a ColId.
    #[inline]
    #[must_use]
    pub fn col_index(&self, col_id: &ColId) -> Option<u32> {
        self.col_axis.position_of(self.sheet_id, *col_id)
    }

    /// Get the hex string for a RowId at a row index.
    #[inline]
    #[must_use]
    pub fn row_id_hex(&self, row: u32) -> Option<crate::hex::SmallHex> {
        self.row_id(row)
            .map(|rid| crate::hex::id_to_hex(rid.as_u128()))
    }

    /// Get the hex string for a ColId at a column index.
    #[inline]
    #[must_use]
    pub fn col_id_hex(&self, col: u32) -> Option<crate::hex::SmallHex> {
        self.col_id(col)
            .map(|cid| crate::hex::id_to_hex(cid.as_u128()))
    }

    /// Look up a row index from a hex string.
    ///
    /// Compact stores decode the generated identity and resolve via compact
    /// run metadata. Legacy explicit stores preserve dense `rowOrder`
    /// behavior.
    #[inline]
    #[must_use]
    pub fn row_index_from_hex(&self, hex: &str) -> Option<u32> {
        let raw = crate::hex::hex_to_id(hex)?;
        self.row_index(&RowId::from_raw(raw))
    }

    /// Look up a column index from a hex string. See [`Self::row_index_from_hex`].
    #[inline]
    #[must_use]
    pub fn col_index_from_hex(&self, hex: &str) -> Option<u32> {
        let raw = crate::hex::hex_to_id(hex)?;
        self.col_index(&ColId::from_raw(raw))
    }

    /// Return the dense `row_index → RowId` slice for legacy explicit axes.
    ///
    /// unified reference model consumer: the mirror uses this to seed its own
    /// `RowId → (SheetId, row_index)` reverse index so `WorkbookLookup`
    /// can answer full-row display queries without threading the grid index
    /// through every call site.
    #[inline]
    #[must_use]
    pub fn row_ids_dense(&self) -> &[RowId] {
        match &self.row_axis {
            AxisIdentityStore::Explicit(ids) => ids,
            AxisIdentityStore::Runs(_) => &[],
        }
    }

    /// Collect all row identities in current positional order.
    ///
    /// This is the compatibility bridge for consumers that still own dense
    /// mirror indexes. Unlike [`Self::row_ids_dense`], it is correct for
    /// compact axes because it resolves identities through the axis store.
    #[must_use]
    pub fn row_ids_ordered(&self) -> Vec<RowId> {
        self.row_axis
            .identities_in(self.sheet_id, 0, self.row_axis.len())
            .collect()
    }

    /// Return the dense `col_index → ColId` slice for legacy explicit axes.
    #[inline]
    #[must_use]
    pub fn col_ids_dense(&self) -> &[ColId] {
        match &self.col_axis {
            AxisIdentityStore::Explicit(ids) => ids,
            AxisIdentityStore::Runs(_) => &[],
        }
    }

    /// Collect all column identities in current positional order.
    ///
    /// This is the compatibility bridge for consumers that still own dense
    /// mirror indexes. Unlike [`Self::col_ids_dense`], it is correct for
    /// compact axes because it resolves identities through the axis store.
    #[must_use]
    pub fn col_ids_ordered(&self) -> Vec<ColId> {
        self.col_axis
            .identities_in(self.sheet_id, 0, self.col_axis.len())
            .collect()
    }
}

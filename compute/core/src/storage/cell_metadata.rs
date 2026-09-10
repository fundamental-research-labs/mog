//! Sparse OOXML cell metadata keyed by stable cell identity.
//!
//! Values and identity formulas remain owned by the native cell store. These
//! entries exist only when a cell has package metadata or authored CSE state.

use cell_types::CellId;
use rustc_hash::FxHashMap;

use super::WorkbookStorage;

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct CellMetadata {
    pub array_ref: Option<String>,
    pub formula_result_mode: Option<crate::cells::cell_metadata::FormulaResultMode>,
    pub formula: Option<FormulaMetadata>,
    pub rich_string: Option<domain_types::RichSharedString>,
}

/// OOXML formula attributes. Formula text is rendered from the current native
/// formula when exporting; retaining it here would create a second source.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub(crate) struct FormulaMetadata {
    pub t: ooxml_types::worksheet::CellFormulaType,
    pub si: Option<u32>,
    pub r#ref: Option<String>,
    pub aca: bool,
    pub dt2d: bool,
    pub del1: bool,
    pub del2: bool,
    pub r1: Option<String>,
    pub r2: Option<String>,
    pub ca: bool,
    pub bx: bool,
    pub dtr: bool,
}

impl From<&ooxml_types::worksheet::CellFormula> for FormulaMetadata {
    fn from(formula: &ooxml_types::worksheet::CellFormula) -> Self {
        Self {
            t: formula.t.clone(),
            si: formula.si.clone(),
            r#ref: formula.r#ref.clone(),
            aca: formula.aca.clone(),
            dt2d: formula.dt2d.clone(),
            del1: formula.del1.clone(),
            del2: formula.del2.clone(),
            r1: formula.r1.clone(),
            r2: formula.r2.clone(),
            ca: formula.ca.clone(),
            bx: formula.bx.clone(),
            dtr: formula.dtr.clone(),
        }
    }
}

impl FormulaMetadata {
    pub(crate) fn to_ooxml(&self, current_formula: &str) -> ooxml_types::worksheet::CellFormula {
        ooxml_types::worksheet::CellFormula {
            text: current_formula
                .strip_prefix('=')
                .unwrap_or(current_formula)
                .to_string(),
            t: self.t.clone(),
            si: self.si.clone(),
            r#ref: self.r#ref.clone(),
            aca: self.aca.clone(),
            dt2d: self.dt2d.clone(),
            del1: self.del1.clone(),
            del2: self.del2.clone(),
            r1: self.r1.clone(),
            r2: self.r2.clone(),
            ca: self.ca.clone(),
            bx: self.bx.clone(),
            dtr: self.dtr.clone(),
        }
    }
}

pub(crate) type CellMetadataMap = FxHashMap<CellId, CellMetadata>;

impl CellMetadata {
    pub(crate) fn from_import(cell: &domain_types::CellData) -> Self {
        Self {
            array_ref: cell.array_ref.clone(),
            formula_result_mode: cell.formula.as_ref().map(|_| {
                use crate::cells::cell_metadata::FormulaResultMode;
                if cell.projection_role
                    == domain_types::ImportedCellProjectionRole::DynamicArraySource
                {
                    FormulaResultMode::Dynamic
                } else if cell.array_ref.is_some()
                    || cell
                        .cell_formula
                        .as_ref()
                        .is_some_and(|f| f.t == ooxml_types::worksheet::CellFormulaType::Array)
                {
                    FormulaResultMode::Cse
                } else {
                    FormulaResultMode::LegacyScalar
                }
            }),
            formula: cell.cell_formula.as_ref().map(FormulaMetadata::from),
            rich_string: cell.rich_string.clone(),
        }
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.array_ref.is_none()
            && self.formula_result_mode.is_none()
            && self.formula.is_none()
            && self.rich_string.is_none()
    }
}

impl WorkbookStorage {
    pub(crate) fn cell_metadata(&self, cell_id: &CellId) -> Option<&CellMetadata> {
        self.cell_metadata.get(cell_id)
    }

    pub(crate) fn set_cell_metadata(&mut self, cell_id: CellId, metadata: CellMetadata) {
        let previous = self.cell_metadata.get(&cell_id);
        if previous.and_then(|value| value.formula_result_mode) != metadata.formula_result_mode
            || previous.and_then(|value| value.array_ref.as_deref())
                != metadata.array_ref.as_deref()
            || previous.and_then(|value| value.rich_string.as_ref())
                != metadata.rich_string.as_ref()
        {
            self.invalidate_cell_metadata_projection();
        }
        crate::storage::engine::history::metadata::capture_cell_metadata(self, cell_id);
        if metadata.is_empty() {
            self.cell_metadata.remove(&cell_id);
        } else {
            self.cell_metadata.insert(cell_id, metadata);
        }
    }

    /// Ordinary authored replacement/clear invalidates imported formula/cache
    /// annotations and rich runs. Metadata is reattached explicitly for CSE entry.
    pub(crate) fn clear_cell_metadata(&mut self, cell_id: CellId) {
        if let Some(metadata) = self.cell_metadata.get(&cell_id) {
            if metadata.formula_result_mode.is_some()
                || metadata.array_ref.is_some()
                || metadata.rich_string.is_some()
            {
                self.invalidate_cell_metadata_projection();
            }
            crate::storage::engine::history::metadata::capture_cell_metadata(self, cell_id);
            self.cell_metadata.remove(&cell_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cells::cell_metadata::FormulaResultMode;
    use domain_types::{CellData, ImportedCellProjectionRole};

    #[test]
    fn metadata_projection_revision_tracks_only_reference_semantics() {
        let mut storage = WorkbookStorage::new();
        let id = CellId::from_raw(1);
        let initial = storage.metadata_revision();
        storage.set_cell_metadata(id, CellMetadata::default());
        storage.clear_cell_metadata(id);
        assert_eq!(storage.metadata_revision(), initial);

        let metadata = CellMetadata {
            formula_result_mode: Some(FormulaResultMode::LegacyScalar),
            ..Default::default()
        };
        storage.set_cell_metadata(id, metadata.clone());
        let imported = storage.metadata_revision();
        assert_ne!(imported, initial);
        storage.set_cell_metadata(id, metadata);
        assert_eq!(storage.metadata_revision(), imported);
        storage.clear_cell_metadata(id);
        assert_ne!(storage.metadata_revision(), imported);
        let cleared = storage.metadata_revision();
        storage.clear_cell_metadata(id);
        assert_eq!(storage.metadata_revision(), cleared);
    }

    #[test]
    fn import_retains_formula_mode_without_cached_value_or_array_range() {
        let mut cell = CellData {
            formula: Some("A1:A2".into()),
            ..Default::default()
        };
        let legacy = CellMetadata::from_import(&cell);
        assert_eq!(
            legacy.formula_result_mode,
            Some(FormulaResultMode::LegacyScalar)
        );
        assert!(!legacy.is_empty());

        cell.projection_role = ImportedCellProjectionRole::DynamicArraySource;
        assert_eq!(
            CellMetadata::from_import(&cell).formula_result_mode,
            Some(FormulaResultMode::Dynamic)
        );
        cell.projection_role = Default::default();
        cell.array_ref = Some("A1".into());
        assert_eq!(
            CellMetadata::from_import(&cell).formula_result_mode,
            Some(FormulaResultMode::Cse)
        );
        cell.array_ref = None;
        cell.cell_formula = Some(ooxml_types::worksheet::CellFormula {
            t: ooxml_types::worksheet::CellFormulaType::Array,
            ..Default::default()
        });
        assert_eq!(
            CellMetadata::from_import(&cell).formula_result_mode,
            Some(FormulaResultMode::Cse)
        );
        cell.formula = None;
        assert_eq!(CellMetadata::from_import(&cell).formula_result_mode, None);
    }
}

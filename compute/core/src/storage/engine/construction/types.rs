use super::*;

pub(in crate::storage::engine) type XlsxHydrateResult = (
    WorkbookStorage,
    WorkbookSnapshot,
    domain_types::ImportReport,
    Vec<(SheetId, crate::storage::properties::ImportedFormats)>,
);

/// Pending worksheet load. Values and metadata already loaded live only in the
/// native stores; completion needs the archive and the loaded sheet's index.
pub struct DeferredHydrationData {
    pub(in crate::storage::engine) loaded_sheet_index: usize,
    pub(in crate::storage::engine) raw_xlsx_bytes: Vec<u8>,
}

/// Fully staged deferred XLSX completion. This owns every component needed to
/// replace the live engine after any fallible import-open recalculation has
/// succeeded.
pub(in crate::storage::engine) struct DeferredHydrationCompletion {
    pub(in crate::storage::engine) stores: EngineStores,
    pub(in crate::storage::engine) cell_store: CellStore,
    pub(in crate::storage::engine) settings: EngineSettings,
    pub(in crate::storage::engine) calculation: domain_types::CalculationProperties,
    pub(in crate::storage::engine) import_report: domain_types::ImportReport,
}

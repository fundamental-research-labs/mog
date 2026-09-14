use super::*;

pub(in crate::storage::engine) type XlsxHydrateResult = (
    WorkbookStorage,
    WorkbookSnapshot,
    domain_types::ImportReport,
    Vec<(SheetId, crate::storage::properties::ImportedFormats)>,
);

pub(in crate::storage::engine) type XlsxStreamHydrateResult = (
    WorkbookStorage,
    WorkbookSnapshot,
    domain_types::ImportReport,
    Vec<(SheetId, crate::storage::properties::ImportedFormats)>,
    CellStore,
    Vec<(CellId, SheetId, String)>,
);

/// Marker kept so `ComputeEngine::deferred_hydration` stays `None` after stream load.
pub struct DeferredHydrationData;

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

use super::*;

pub(in crate::storage::engine) type XlsxHydrateResult = (
    YrsStorage,
    WorkbookSnapshot,
    Vec<(SheetId, CellId, u32, u32)>,
);

/// Data stored for deferred Yrs CRDT hydration.
/// After the fast-path import, this holds everything needed to complete
/// the Yrs write and rebuild indexes with full fidelity.
pub struct DeferredHydrationData {
    pub(in crate::storage::engine) parse_output: domain_types::ParseOutput,
    pub(in crate::storage::engine) allocations:
        Vec<crate::storage::infra::hydration::SheetIdAllocation>,
    pub(in crate::storage::engine) workbook_snap: WorkbookSnapshot,
    /// Raw XLSX bytes for full re-parse during deferred hydration.
    /// The fast-path parse uses values_only + skip options; the full parse
    /// during hydration needs the complete data.
    pub(in crate::storage::engine) raw_xlsx_bytes: Option<Vec<u8>>,
}

/// Fully staged deferred XLSX completion. This owns every component needed to
/// replace the live engine after any fallible import-open recalculation has
/// succeeded.
pub(in crate::storage::engine) struct DeferredHydrationCompletion {
    pub(in crate::storage::engine) stores: EngineStores,
    pub(in crate::storage::engine) mirror: CellMirror,
    pub(in crate::storage::engine) settings: EngineSettings,
    pub(in crate::storage::engine) phantom_cells: Vec<(SheetId, CellId, u32, u32)>,
    pub(in crate::storage::engine) calculation: domain_types::CalculationProperties,
}

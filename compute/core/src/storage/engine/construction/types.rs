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
    xlsx_parser::StreamLoadStats,
);

/// Calculation policy for an XLSX import into an existing engine.
pub(in crate::storage::engine) enum XlsxRecalculation {
    Never,
    Always,
    OnLoad,
}

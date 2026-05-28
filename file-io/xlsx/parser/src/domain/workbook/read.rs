//! Workbook metadata parser compatibility facade.
//!
//! This module preserves the legacy `domain::workbook::read::*` import surface
//! while parser implementations live in focused child modules.

mod calc;
mod inventory;
mod properties;
mod rels;
mod sheets;
mod views;
mod xml;

pub use super::types::{CalcPrSettings, SheetInfo};
pub use calc::parse_calc_settings;
pub use inventory::{SheetPackageContext, build_workbook_sheet_inventory, sheet_package_contexts};
pub use properties::{
    parse_file_sharing, parse_file_version, parse_web_publishing, parse_workbook_conformance,
    parse_workbook_properties,
};
pub use rels::{parse_all_rels, parse_workbook_rels};
pub use sheets::parse_workbook;
pub use views::parse_workbook_views;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_read_imports_resolve() {
        let _sheets: Vec<SheetInfo> = parse_workbook(b"");
        let _workbook_rels: Vec<(String, String)> = parse_workbook_rels(b"");
        let _all_rels: Vec<ooxml_types::shared::OpcRelationship> = parse_all_rels(b"");
        let _calc: CalcPrSettings = parse_calc_settings(b"");
        let _views: Vec<crate::domain::workbook::types::WorkbookView> = parse_workbook_views(b"");
        let _workbook_properties: Option<domain_types::domain::workbook::WorkbookProperties> =
            parse_workbook_properties(b"");
        let _file_version: Option<domain_types::domain::workbook::FileVersion> =
            parse_file_version(b"");
        let _file_sharing: Option<domain_types::domain::workbook::FileSharing> =
            parse_file_sharing(b"");
        let _web_publishing: Option<domain_types::domain::workbook::WorkbookWebPublishing> =
            parse_web_publishing(b"");
        let _conformance: Option<String> = parse_workbook_conformance(b"");
    }
}

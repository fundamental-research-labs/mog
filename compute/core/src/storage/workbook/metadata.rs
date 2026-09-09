//! Native workbook metadata. Public settings are projections of this state.

use std::collections::BTreeMap;

use domain_types::domain::{
    slicer::NamedSlicerStyle,
    workbook::{WorkbookProperties, WorkbookProtection, WorkbookView},
};

use crate::snapshot::WorkbookSettings;

#[derive(Debug, Clone, Default)]
pub(crate) struct WorkbookMetadata {
    pub external_links: super::external_links::ExternalLinks,
    pub scenarios: Vec<crate::snapshot::Scenario>,
    pub custom_cell_styles:
        rustc_hash::FxHashMap<String, domain_types::domain::cell_style::CellStyleDef>,

    pub sheet_order: Vec<cell_types::SheetId>,
    pub slicers: BTreeMap<String, domain_types::domain::slicer::StoredSlicer>,
    pub timelines: BTreeMap<String, domain_types::domain::slicer::StoredTimeline>,
    pub pivot_specs: BTreeMap<String, domain_types::domain::pivot::ParsedPivotTable>,
    pub imported_pivot_associations:
        BTreeMap<String, super::imported_pivots::ImportedPivotAssociation>,
    pub pivot_cache_records: domain_types::domain::pivot::PivotCacheRecords,
    pub pivot_cache_sources: BTreeMap<u32, domain_types::domain::pivot::PivotCacheSourceDef>,
    pub table_annotations: BTreeMap<String, crate::engine_types::AnnotationRecord>,
    pub custom_table_styles:
        BTreeMap<String, domain_types::domain::custom_table_style::CustomTableStyleConfig>,
    pub style_palette: Vec<domain_types::CellFormat>,
    pub named_ranges: BTreeMap<String, super::named_ranges::StoredDefinedName>,
    /// Runtime settings. The password/options and date-system fields are
    /// projected from `protection` and `properties` by `settings::get_settings`.
    pub settings: WorkbookSettings,
    pub protection: Option<WorkbookProtection>,
    pub properties: Option<WorkbookProperties>,
    pub views: Vec<WorkbookView>,
    pub root_namespaces: domain_types::XmlNamespaceDeclarations,
    pub custom_views_xml: Option<Vec<u8>>,
    pub default_slicer_style: Option<String>,
    pub default_pivot_table_style: Option<String>,
    pub imported_default_table_style: Option<String>,
    pub imported_default_pivot_style: Option<String>,
    pub named_slicer_styles: BTreeMap<String, NamedSlicerStyle>,
    pub theme: Option<domain_types::domain::theme::ThemeData>,
    pub document_properties: Option<domain_types::DocumentProperties>,
    pub extended_properties: Option<domain_types::ExtendedDocumentProperties>,
    pub xlsx_metadata: Option<domain_types::WorkbookMetadata>,
    pub file_version: Option<domain_types::domain::workbook::FileVersion>,
    pub file_sharing: Option<domain_types::domain::workbook::FileSharing>,
    pub web_publishing: Option<domain_types::domain::workbook::WorkbookWebPublishing>,
    pub shared_string_hints: Vec<domain_types::SharedStringHint>,
    pub package_fidelity: Option<domain_types::PackageFidelityMetadata>,
    pub volatile_dependency_part: Option<domain_types::VolatileDependencyPackagePart>,
    pub connections: domain_types::domain::connections::WorkbookConnectionSet,
    pub stylesheet: Option<domain_types::WorkbookStylesheet>,
    /// Original order is authored package state; newly created persons append.
    pub persons: Vec<domain_types::PersonInfo>,
    pub has_persons_part: bool,
}

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::domain::floating_object::FloatingObject;
use crate::domain::pivot::ParsedPivotTable;
use crate::domain::*;
use crate::format::DocumentFormat;
use crate::metadata::WorkbookMetadata;
use crate::properties::DocumentProperties;
use ooxml_types::slicers::{
    SlicerAnchor as OoxmlSlicerAnchor, SlicerCacheDef as OoxmlSlicerCacheDef,
    SlicerDef as OoxmlSlicerDef,
};
use ooxml_types::workbook::SheetState;
use value_types::CellValue;

/// Position-keyed parse output — the shared container for parser → writer data flow.
/// No UUIDs, no identity formulas — those are allocated by the hydration layer.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseOutput {
    pub sheets: Vec<SheetData>,
    /// Workbook-order package inventory resolved from workbook sheet entries
    /// and workbook relationships before worksheet parsing. This is durable
    /// sheet/package identity; editable worksheet payloads remain in
    /// `sheets`, linked by `editable_sheet_index`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub workbook_sheet_inventory: Vec<WorkbookSheetPackageInfo>,
    /// Workbook-owned root XML namespace declarations captured from
    /// `xl/workbook.xml`.
    #[serde(default, skip_serializing_if = "XmlNamespaceDeclarations::is_empty")]
    pub workbook_root_namespaces: XmlNamespaceDeclarations,
    /// Imported workbook root conformance hint. Writers must drop `strict` when
    /// current workbook markup includes known Transitional-only fields.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_conformance: Option<String>,
    pub style_palette: Vec<DocumentFormat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_stylesheet: Option<WorkbookStylesheet>,
    /// Production-safe OPC package fidelity facts captured from imported XLSX.
    ///
    /// These facts are a durable sidecar for inert package content only. Writers
    /// must still validate ownership, relationship closure, content types, and
    /// stale/unsafe disposition before reusing imported bytes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_fidelity: Option<PackageFidelityMetadata>,
    /// Legacy import hints for shared-string entries.
    ///
    /// Export correctness is based on current cell-owned string state only.
    /// These hints are not an SST identity model and must not influence emitted
    /// shared-string slots or cell `<v>` indices.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shared_string_hints: Vec<SharedStringHint>,
    pub named_ranges: Vec<NamedRange>,
    pub pivot_tables: Vec<ParsedPivotTable>,
    /// Pivot cache record data for eval-only use (cache_id → rows of cell values).
    /// Not consumed by the snapshot/hydration path. Populated from the OOXML
    /// pivot cache records so formula-eval can feed compute-pivot with the same
    /// source data Excel used to produce the cached pivot output.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub pivot_cache_records: std::collections::HashMap<u32, Vec<Vec<CellValue>>>,
    pub data_table_regions: Vec<DataTableRegion>,
    pub slicer_caches: Vec<OoxmlSlicerCacheDef>,
    /// Workbook-level table style definitions from `xl/styles.xml`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub custom_table_styles: Vec<ooxml_types::styles::TableStyleDef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_table_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_pivot_style: Option<String>,
    pub theme: Option<ThemeData>,
    pub properties: Option<DocumentProperties>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extended_properties: Option<crate::properties::ExtendedDocumentProperties>,
    pub protection: Option<WorkbookProtection>,
    pub calculation: CalculationProperties,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<WorkbookMetadata>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub workbook_views: Vec<WorkbookView>,
    /// Raw workbook-level `<customWorkbookViews>` XML captured from
    /// `xl/workbook.xml` for unchanged package-fidelity export.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_workbook_views_xml: Option<Vec<u8>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_properties: Option<WorkbookProperties>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_version: Option<FileVersion>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_sharing: Option<FileSharing>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web_publishing: Option<WorkbookWebPublishing>,
    /// Workbook external-link definitions that should be emitted.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub external_links: Vec<ExternalLink>,
    /// Workbook external data connections from `xl/connections.xml`.
    #[serde(default, skip_serializing_if = "WorkbookConnectionSet::is_empty")]
    pub connections: WorkbookConnectionSet,
    /// Person identity list for threaded comments.
    /// Referenced by `Comment.person_id` across all sheets.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub persons: Vec<PersonInfo>,
    /// Workbook-owned volatile dependency sidecar from `xl/volatileDependencies.xml`.
    ///
    /// This is calculation/external-data import fidelity, not an editable
    /// calculation model. Writers may preserve it only while the part is valid
    /// and workbook calculation/external-data owners are unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volatile_dependency_part: Option<VolatileDependencyPackagePart>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VolatileDependencyPackagePart {
    /// Normalized package path without a leading slash.
    pub path: String,
    /// Raw `volatileDependencies.xml` bytes.
    pub bytes: Vec<u8>,
    /// Content type override for the part.
    pub content_type: String,
    /// Workbook relationship id hint, when imported through workbook.xml.rels.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relationship_id: Option<String>,
    /// Workbook relationship type, Strict or Transitional.
    pub relationship_type: String,
    /// Original workbook relationship target, if available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relationship_target: Option<String>,
    /// Relationships owned by the volatile dependency part.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relationships: Vec<PackageRelationshipHint>,
}

/// Durable package metadata captured during import.
///
/// All fields are hints for current graph construction. Export must validate
/// owner, relationship type, target identity, content-type requirements, and
/// stale/unsafe disposition before reusing any imported value.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageFidelityMetadata {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_profile: Option<PackageProfileHint>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shared_string_table: Option<SharedStringTableFidelity>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content_type_defaults: Vec<PackageContentTypeDefaultHint>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content_type_overrides: Vec<PackageContentTypeOverrideHint>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub root_relationships: Vec<PackageRelationshipHint>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub workbook_relationships: Vec<PackageRelationshipHint>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sheet_workbook_r_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub opaque_parts: Vec<OpaquePackagePartHint>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub raw_doc_props: Vec<RawDocPropsHint>,
    /// Pivot-owned imported cache package facts for writer-only no-edit
    /// preservation. These are not generic opaque parts: export must validate
    /// cache identity and source binding before reusing imported bytes.
    #[serde(skip)]
    pub pivot_cache_packages: Vec<PivotCachePackageFidelity>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<PackageFidelityDiagnostic>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedStringTableFidelity {
    /// Safe root-level `<extLst>` XML from `xl/sharedStrings.xml`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ext_lst_xml: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageProfileHint {
    pub profile: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageFidelityDiagnostic {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub part: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relationship_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageContentTypeDefaultHint {
    pub extension: String,
    pub content_type: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageContentTypeOverrideHint {
    /// Normalized package part path without a leading slash.
    pub part_name: String,
    /// Original part-name spelling from `[Content_Types].xml`.
    pub original_part_name: String,
    pub content_type: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageRelationshipHint {
    pub id: String,
    pub relationship_type: String,
    pub target: String,
    pub target_mode: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpaquePackagePartHint {
    /// Normalized ZIP package path without a leading slash.
    pub path: String,
    pub bytes: Vec<u8>,
    pub content_type: Option<String>,
    /// Parsed relationships from this part's imported sidecar, when captured.
    pub relationships: Vec<PackageRelationshipHint>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawDocPropsHint {
    /// Normalized docProps package part path without a leading slash.
    pub path: String,
    /// Imported raw XML bytes for unchanged metadata passthrough.
    pub bytes: Vec<u8>,
    /// XML the current domain writer produced immediately after import.
    ///
    /// Export may reuse `bytes` only when the current writer output still
    /// matches this value, which conservatively detects metadata edits without
    /// relying on a mutable dirty flag.
    pub generated_at_import: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotCachePackageFidelity {
    pub cache_id: u32,
    pub definition_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub records_path: Option<String>,
    pub definition_xml: Vec<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub records_xml: Option<Vec<u8>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub definition_rels_xml: Option<Vec<u8>>,
    pub workbook_relationship_id: String,
    pub workbook_relationship_type: String,
    pub workbook_relationship_target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub records_relationship_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub records_relationship_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub records_relationship_target: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_sheet: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_range: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XmlNamespaceDeclaration {
    /// Namespace prefix; `None` represents the default `xmlns="..."`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
    pub uri: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XmlNamespaceDeclarations {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub declarations: Vec<XmlNamespaceDeclaration>,
    #[serde(default, skip_serializing_if = "MceAttributes::is_empty")]
    pub mce: MceAttributes,
}

impl XmlNamespaceDeclarations {
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.declarations.is_empty() && self.mce.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MceAttributes {
    /// Original whitespace-delimited `mc:Ignorable` value from the owning root.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ignorable: Option<String>,
    /// Original whitespace-delimited `mc:ProcessContent` value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub process_content: Option<String>,
    /// Original whitespace-delimited `mc:MustUnderstand` value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub must_understand: Option<String>,
    /// Structural MCE import diagnostics attached to this owner.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<String>,
}

impl MceAttributes {
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.ignorable.is_none()
            && self.process_content.is_none()
            && self.must_understand.is_none()
            && self.diagnostics.is_empty()
    }
}

/// Typed package identity hints for worksheet-owned comment artifacts.
///
/// These values are not payload preservation. Writers may use them to allocate
/// current modeled parts and relationships when still valid, while generating
/// XML from the current comment/person model.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetCommentPackageInfo {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comments_path_hint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comments_relationship_id_hint: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub comments_root_namespace_attrs: Vec<(String, String)>,
    /// Safe root-level `<extLst>...</extLst>` from `xl/comments*.xml`.
    ///
    /// This is owner-scoped comment package metadata. Writers may replay it
    /// only after validating that it is a single relationship-free `extLst`
    /// fragment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comments_ext_lst_xml: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vml_path_hint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vml_relationship_id_hint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub threaded_comments_path_hint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub threaded_comments_relationship_id_hint: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub threaded_comments_root_namespace_attrs: Vec<(String, String)>,
}

impl SheetCommentPackageInfo {
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.comments_path_hint.is_none()
            && self.comments_relationship_id_hint.is_none()
            && self.comments_root_namespace_attrs.is_empty()
            && self.comments_ext_lst_xml.is_none()
            && self.vml_path_hint.is_none()
            && self.vml_relationship_id_hint.is_none()
            && self.threaded_comments_path_hint.is_none()
            && self.threaded_comments_relationship_id_hint.is_none()
            && self.threaded_comments_root_namespace_attrs.is_empty()
    }
}

impl PackageFidelityMetadata {
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.content_type_defaults.is_empty()
            && self.content_type_overrides.is_empty()
            && self.root_relationships.is_empty()
            && self.workbook_relationships.is_empty()
            && self.sheet_workbook_r_ids.is_empty()
            && self.opaque_parts.is_empty()
            && self.raw_doc_props.is_empty()
            && self.pivot_cache_packages.is_empty()
            && self.diagnostics.is_empty()
            && self.package_profile.is_none()
            && self.shared_string_table.is_none()
    }

    #[must_use]
    pub fn content_type_default_for_extension(&self, extension: &str) -> Option<&str> {
        self.content_type_defaults
            .iter()
            .find(|hint| hint.extension.eq_ignore_ascii_case(extension))
            .map(|hint| hint.content_type.as_str())
    }
}

impl From<ooxml_types::shared::OpcRelationship> for PackageRelationshipHint {
    fn from(value: ooxml_types::shared::OpcRelationship) -> Self {
        Self {
            id: value.id,
            relationship_type: value.rel_type,
            target: value.target,
            target_mode: value.target_mode,
        }
    }
}

impl ParseOutput {
    /// Build the Round 9 workbook data-feature aggregate from the compatibility
    /// fields that still back parser, Yrs, and writer paths.
    #[must_use]
    pub fn workbook_data_features(&self) -> WorkbookDataFeatures {
        WorkbookDataFeatures::from_compat_fields(
            &self.sheets,
            &self.connections,
            &self.external_links,
            &self.pivot_tables,
            &self.pivot_cache_records,
            &self.slicer_caches,
            &self.metadata,
            &self.data_table_regions,
        )
    }

    /// Replace compatibility fields from a workbook data-feature aggregate.
    ///
    /// This is the migration bridge for callers that start from the aggregate
    /// while existing production writers still consume legacy fields directly.
    pub fn apply_workbook_data_features(&mut self, data_features: WorkbookDataFeatures) {
        self.connections = data_features.connections;
        self.external_links = data_features.external_links;
        self.pivot_tables = data_features.pivot_tables;
        self.pivot_cache_records = data_features
            .pivot_caches
            .into_iter()
            .filter_map(|cache| {
                (!cache.records.is_empty()).then_some((cache.cache_id, cache.records))
            })
            .collect();
        self.slicer_caches = data_features.slicer_caches;
        self.metadata = data_features.metadata;
        self.data_table_regions = data_features.what_if.data_table_regions;

        for sheet in &mut self.sheets {
            sheet.tables.clear();
            sheet.slicers.clear();
            sheet.slicer_anchors.clear();
        }

        for table in data_features.tables {
            if let Some(sheet) = find_data_feature_sheet_mut(&mut self.sheets, &table.owner) {
                sheet.tables.push(table.table);
            }
        }

        for slicer in data_features.slicers {
            if let Some(sheet) = find_data_feature_sheet_mut(&mut self.sheets, &slicer.owner) {
                if let Some(anchor) = slicer.anchor {
                    sheet.slicer_anchors.push(anchor);
                }
                sheet.slicers.push(slicer.slicer);
            }
        }
    }
}

fn find_data_feature_sheet_mut<'a>(
    sheets: &'a mut [SheetData],
    owner: &SheetFeatureOwner,
) -> Option<&'a mut SheetData> {
    let index_matches = sheets
        .get(owner.sheet_index as usize)
        .is_some_and(|sheet| sheet.name == owner.sheet_name);
    if index_matches {
        return sheets.get_mut(owner.sheet_index as usize);
    }

    let sheet_id = owner.sheet_id?;
    let index = sheets
        .iter()
        .position(|sheet| sheet.sheet_id == Some(sheet_id))?;
    sheets.get_mut(index)
}

#[must_use]
pub fn normalize_package_path(path: &str) -> String {
    path.trim_start_matches('/').replace('\\', "/")
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookStylesheet {
    /// Legacy in-memory scaffold for tests/migration callers that still build a
    /// whole OOXML stylesheet. Production parser/Yrs/export paths lower into
    /// the explicit registries below instead of serializing this blob.
    #[serde(default, skip)]
    pub stylesheet: ooxml_types::styles::Stylesheet,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub number_formats: Vec<ooxml_types::styles::NumberFormatDef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fonts: Vec<ooxml_types::styles::FontDef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fills: Vec<ooxml_types::styles::FillDef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub borders: Vec<ooxml_types::styles::BorderDef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cell_style_xfs: Vec<ooxml_types::styles::CellXfDef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cell_xfs: Vec<ooxml_types::styles::CellXfDef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub named_cell_styles: Vec<ooxml_types::styles::CellStyleDef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub differential_formats: Vec<ooxml_types::styles::DxfDef>,
    /// Stable workbook-level differential format registry. References stored
    /// as `dxf_id` in CF, filters, sorts, and tables point at these stable IDs,
    /// not at the transient OOXML `<dxfs>` array positions written on export.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dxf_registry: Vec<DxfDef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub table_styles: Vec<ooxml_types::styles::TableStyleDef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indexed_colors: Option<ooxml_types::styles::ColorsDef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_table_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_pivot_style: Option<String>,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub known_fonts: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub root_namespace_attrs: Vec<(String, String)>,
    #[serde(default, skip_serializing_if = "MceAttributes::is_empty")]
    pub root_mce_attributes: MceAttributes,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<Vec<u8>>,
}

impl WorkbookStylesheet {
    #[must_use]
    pub fn from_stylesheet(
        stylesheet: ooxml_types::styles::Stylesheet,
        root_namespace_attrs: Vec<(String, String)>,
        ext_lst_xml: Option<Vec<u8>>,
    ) -> Self {
        let dxf_registry = stylesheet
            .dxfs
            .iter()
            .cloned()
            .enumerate()
            .map(|(id, dxf)| DxfDef::from_ooxml(id as u32, dxf))
            .collect();
        Self {
            number_formats: stylesheet.num_fmts,
            fonts: stylesheet.fonts,
            known_fonts: stylesheet.known_fonts,
            fills: stylesheet.fills,
            borders: stylesheet.borders,
            cell_style_xfs: stylesheet.cell_style_xfs,
            cell_xfs: stylesheet.cell_xfs,
            named_cell_styles: stylesheet.cell_styles,
            differential_formats: Vec::new(),
            dxf_registry,
            indexed_colors: stylesheet.colors,
            table_styles: stylesheet.table_styles,
            default_table_style: stylesheet.default_table_style,
            default_pivot_style: stylesheet.default_pivot_style,
            root_namespace_attrs,
            root_mce_attributes: MceAttributes::default(),
            ext_lst_xml,
            stylesheet: ooxml_types::styles::Stylesheet::default(),
        }
    }

    #[must_use]
    pub fn with_root_mce_attributes(mut self, root_mce_attributes: MceAttributes) -> Self {
        self.root_mce_attributes = root_mce_attributes;
        self
    }

    #[must_use]
    pub fn to_stylesheet(&self) -> ooxml_types::styles::Stylesheet {
        if self.is_registry_empty() && self.stylesheet != ooxml_types::styles::Stylesheet::default()
        {
            return self.stylesheet.clone();
        }

        let dxfs = if self.differential_formats.is_empty() {
            self.dxf_registry.iter().map(DxfDef::to_ooxml).collect()
        } else {
            self.differential_formats.clone()
        };

        ooxml_types::styles::Stylesheet {
            num_fmts: self.number_formats.clone(),
            fonts: self.fonts.clone(),
            known_fonts: self.known_fonts,
            fills: self.fills.clone(),
            borders: self.borders.clone(),
            cell_style_xfs: self.cell_style_xfs.clone(),
            cell_xfs: self.cell_xfs.clone(),
            cell_styles: self.named_cell_styles.clone(),
            dxfs,
            colors: self.indexed_colors.clone(),
            table_styles: self.table_styles.clone(),
            default_table_style: self.default_table_style.clone(),
            default_pivot_style: self.default_pivot_style.clone(),
            ext_lst: None,
        }
    }

    #[must_use]
    pub fn normalized(&self) -> Self {
        if self.is_registry_empty() && self.stylesheet != ooxml_types::styles::Stylesheet::default()
        {
            return Self::from_stylesheet(
                self.stylesheet.clone(),
                self.root_namespace_attrs.clone(),
                self.ext_lst_xml.clone(),
            )
            .with_root_mce_attributes(self.root_mce_attributes.clone());
        }
        let mut normalized = self.clone();
        normalized.stylesheet = ooxml_types::styles::Stylesheet::default();
        normalized
    }

    fn is_registry_empty(&self) -> bool {
        self.number_formats.is_empty()
            && self.fonts.is_empty()
            && self.fills.is_empty()
            && self.borders.is_empty()
            && self.cell_style_xfs.is_empty()
            && self.cell_xfs.is_empty()
            && self.named_cell_styles.is_empty()
            && self.differential_formats.is_empty()
            && self.dxf_registry.is_empty()
            && self.table_styles.is_empty()
            && self.indexed_colors.is_none()
            && self.default_table_style.is_none()
            && self.default_pivot_style.is_none()
            && !self.known_fonts
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedStringHint {
    /// Original SST index from `xl/sharedStrings.xml`.
    ///
    /// Import provenance only. Export derives `xl/sharedStrings.xml` from
    /// current cell values and must not use this as emitted table identity.
    pub index: u32,
    /// Plain text content captured with the imported hint.
    pub text: String,
    /// Rich text runs for this SST entry, when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rich_text: Option<Vec<RichTextRun>>,
    /// Raw typed phonetic XML children (`<rPh>` / `<phoneticPr>`) for this entry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phonetic_xml: Option<Vec<u8>>,
}

/// Cell-owned rich shared-string content.
///
/// The plain text projection remains the behavioral cell value. Rich runs and
/// phonetic data are exported only when `plain_text` still matches the current
/// text value, so ordinary text edits cannot replay stale SST formatting.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RichSharedString {
    pub plain_text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub runs: Vec<RichTextRun>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub phonetic_runs: Vec<PhoneticRun>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phonetic_properties: Option<PhoneticProperties>,
    /// Source-compatible phonetic children for import compatibility.
    ///
    /// This is cell-owned state, not workbook-level preserved SST state. The
    /// typed fields above are the domain contract; this raw fallback keeps
    /// unsupported phonetic attributes from being discarded while the writer's
    /// typed phonetic surface remains intentionally small.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phonetic_xml: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneticRun {
    pub text: String,
    pub start_index: u32,
    pub end_index: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneticProperties {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phonetic_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alignment: Option<String>,
}

/// A named range definition (position-keyed, no CellIds).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedRange {
    pub name: String,
    /// The formula this name refers to (A1 notation).
    pub refers_to: String,
    /// Sheet index for sheet-scoped names (None = workbook scope).
    pub local_sheet_id: Option<u32>,
    pub hidden: bool,
    pub comment: Option<String>,
    /// Custom menu text (customMenu) for macro-oriented defined names.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_menu: Option<String>,
    /// Description text (description) for the defined name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Help topic text (help) for the defined name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub help: Option<String>,
    /// Status bar text (statusBar) for the defined name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_bar: Option<String>,
    /// Whether this is an XLM macro name (xlm="1").
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub xlm: bool,
    /// Function group ID (functionGroupId) for macro/function names.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub function_group_id: Option<u32>,
    /// Shortcut key (shortcutKey) for macro/function names.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shortcut_key: Option<String>,
    /// Whether this name is a function (function="1").
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub function: bool,
    /// Whether this is a VBA procedure name (vbProcedure="1").
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub vb_procedure: bool,
    /// Whether this name should be published to the server (publishToServer="1").
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub publish_to_server: bool,
    /// Whether this name is a workbook parameter (workbookParameter="1").
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub workbook_parameter: bool,
    /// Whether xml:space="preserve" should be emitted on the value.
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub xml_space_preserve: bool,
}

/// A data table region (position-keyed).
///
/// `row_input_ref` / `col_input_ref` are typed `Option<CellRef>` to keep the
/// parser -> lowering -> snapshot edge stateless, with no typed-to-string-to-
/// typed hop.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataTableOoxmlFlags {
    /// Authored `<f t="dataTable" r1="...">` attribute spelling, preserved for
    /// file round-trip. The typed `col_input_ref` remains the behavioral source.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r1: Option<String>,
    /// Authored `<f t="dataTable" r2="...">` attribute spelling, preserved for
    /// file round-trip. The typed `row_input_ref` remains the behavioral source.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r2: Option<String>,
    /// `<f t="dataTable" aca="1">`: always calculate array/data-table formula.
    #[serde(default)]
    pub aca: bool,
    /// `<f t="dataTable" ca="1">`: calculate this formula.
    #[serde(default)]
    pub ca: bool,
    /// `<f t="dataTable" bx="1">`: OOXML data-table input mode flag.
    #[serde(default)]
    pub bx: bool,
    /// `<f t="dataTable" dt2D="1">`: two-variable data table flag.
    #[serde(default)]
    pub dt2d: bool,
    /// `<f t="dataTable" dtr="1">`: data table uses row/column references.
    #[serde(default)]
    pub dtr: bool,
    /// `<f t="dataTable" del1="1">`: delete first input row flag.
    #[serde(default)]
    pub del1: bool,
    /// `<f t="dataTable" del2="1">`: delete second input row flag.
    #[serde(default)]
    pub del2: bool,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataTableRegion {
    pub sheet_index: u32,
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
    /// Input cell that receives left-column header values (one per body row).
    /// Normalized from Excel's r2 attribute ("column input cell").
    pub row_input_ref: Option<formula_types::CellRef>,
    /// Input cell that receives top-row header values (one per body column).
    /// Normalized from Excel's r1 attribute ("row input cell").
    pub col_input_ref: Option<formula_types::CellRef>,
    /// OOXML `<f t="dataTable">` flags that Mog does not yet implement
    /// behaviorally but must preserve or normalize explicitly for round-trip.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ooxml_flags: Option<DataTableOoxmlFlags>,
}

/// All data for a single sheet, position-keyed.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetData {
    pub name: String,
    pub rows: u32,
    pub cols: u32,
    /// Worksheet-owned root XML namespace declarations captured from this
    /// sheet's `<worksheet>` root.
    #[serde(default, skip_serializing_if = "XmlNamespaceDeclarations::is_empty")]
    pub worksheet_root_namespaces: XmlNamespaceDeclarations,
    /// Raw worksheet-level `<extLst>...</extLst>` XML for unmodeled extension
    /// children. Modeled extension owners are regenerated from current state.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worksheet_ext_lst_xml: Option<String>,
    /// Authored worksheet `<dimension ref="...">` value.
    ///
    /// This is advisory used-range metadata carried through import/export. It
    /// is not a dense grid allocation request.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worksheet_dimension_ref: Option<String>,
    /// Original sheetId from workbook.xml (1-based). Preserved for round-trip fidelity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet_id: Option<u32>,
    /// Sheet visibility state from workbook.xml.
    #[serde(default)]
    pub visibility: SheetState,
    /// Stable sheet identity for co-authoring (xr:uid on `<worksheet>` root).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
    pub cells: Vec<CellData>,
    /// Authored blank `<c>` cells with an explicit `s` attribute.
    ///
    /// These are runtime-visible cell-level style overlays, but they do not
    /// carry values/formulas and must not force dense `cells` entries.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub authored_style_runs: Vec<AuthoredStyleRun>,
    pub dimensions: SheetDimensions,
    pub merges: Vec<MergeRegion>,
    pub frozen_pane: Option<FrozenPane>,
    pub view: SheetView,
    /// Additional `<sheetView>` elements beyond the primary one (index 1+).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_sheet_views: Vec<SheetView>,
    /// Direct-child `<extLst>` XML under `<sheetViews>`, separate from each
    /// `<sheetView>` and root worksheet extension scope.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet_views_ext_lst_xml: Option<String>,
    pub row_styles: Vec<RowStyleEntry>,
    pub col_styles: Vec<ColStyleEntry>,
    // Domain objects
    pub charts: Vec<ChartSpec>,
    pub conditional_formats: Vec<ConditionalFormat>,
    pub comments: Vec<Comment>,
    /// Legacy `<comments><authors>` list for note comments, including unused
    /// authors and original ordering.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub legacy_comment_authors: Vec<String>,
    /// Package identity and root-namespace hints for modeled comment artifacts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment_package: Option<SheetCommentPackageInfo>,
    pub hyperlinks: Vec<Hyperlink>,
    pub data_validations: Vec<ValidationSpec>,
    /// Source count attribute on `<dataValidations>`, when imported.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_validations_declared_count: Option<u32>,
    /// Container-level disablePrompts attribute on `<dataValidations>`.
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub data_validations_disable_prompts: bool,
    /// Container-level xWindow attribute on `<dataValidations>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_validations_x_window: Option<u32>,
    /// Container-level yWindow attribute on `<dataValidations>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_validations_y_window: Option<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub x14_data_validations: Vec<ValidationSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x14_data_validations_declared_count: Option<u32>,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub x14_data_validations_disable_prompts: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x14_data_validations_x_window: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x14_data_validations_y_window: Option<u32>,
    pub sparklines: Vec<Sparkline>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sparkline_groups: Vec<SparklineGroup>,
    pub tables: Vec<TableSpec>,
    pub slicers: Vec<OoxmlSlicerDef>,
    pub slicer_anchors: Vec<OoxmlSlicerAnchor>,
    pub floating_objects: Vec<FloatingObject>,
    // Print & Protection
    pub print_settings: Option<PrintSettings>,
    pub page_breaks: Option<PageBreaks>,
    /// Header/footer images parsed from VML drawings.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hf_images: Vec<crate::domain::print::HeaderFooterImageInfo>,
    pub protection: Option<SheetProtection>,
    // Structure
    pub auto_filter: Option<AutoFilter>,
    /// Worksheet-level `<sortState>` element (not nested inside `<autoFilter>`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort_state: Option<SortState>,
    /// Known worksheet semantic containers whose full OOXML model is not yet
    /// decomposed into smaller runtime objects.
    #[serde(default, skip_serializing_if = "WorksheetSemanticContainers::is_empty")]
    pub worksheet_semantic_containers: WorksheetSemanticContainers,
    /// Typed worksheet calculation properties from `<sheetCalcPr>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet_calc_pr: Option<ooxml_types::worksheet::SheetCalcPr>,
    pub outline_groups: Vec<OutlineGroup>,
    /// Worksheet-level `<sheetPr>` attributes and child properties.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet_properties: Option<ooxml_types::worksheet::SheetProperties>,
    /// Outline (grouping) properties from `<sheetPr><outlinePr>`.
    /// Controls summary row/column placement and outline symbol visibility.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline_properties: Option<ooxml_types::worksheet::OutlineProperties>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorksheetSemanticXml {
    pub raw_xml: String,
}

impl WorksheetSemanticXml {
    pub fn new(raw_xml: String) -> Self {
        Self { raw_xml }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorksheetSemanticContainers {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_sheet_views: Option<WorksheetSemanticXml>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ignored_errors: Option<WorksheetSemanticXml>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet_calc_pr: Option<WorksheetSemanticXml>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protected_ranges: Option<WorksheetSemanticXml>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scenarios: Option<WorksheetSemanticXml>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_consolidate: Option<WorksheetSemanticXml>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phonetic_pr: Option<WorksheetSemanticXml>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub smart_tags: Option<WorksheetSemanticXml>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell_watches: Option<WorksheetSemanticXml>,
}

impl WorksheetSemanticContainers {
    pub fn is_empty(&self) -> bool {
        self.custom_sheet_views.is_none()
            && self.ignored_errors.is_none()
            && self.sheet_calc_pr.is_none()
            && self.protected_ranges.is_none()
            && self.scenarios.is_none()
            && self.data_consolidate.is_none()
            && self.phonetic_pr.is_none()
            && self.smart_tags.is_none()
            && self.cell_watches.is_none()
    }
}

/// Parser-owned classification for imported cells whose OOXML metadata affects
/// projection or spill behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportedCellProjectionRole {
    #[default]
    Normal,
    DynamicArraySource,
    DynamicArraySpillTarget,
    UnknownCellMetadata,
}

impl ImportedCellProjectionRole {
    pub fn is_normal(&self) -> bool {
        *self == Self::Normal
    }
}

/// A single cell's data, position-keyed (no UUID).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellData {
    pub row: u32,
    pub col: u32,
    pub value: CellValue,
    /// Rich/phonetic shared-string content owned by this cell.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rich_string: Option<RichSharedString>,
    /// Formula in A1 notation (expanded text for all formula types).
    pub formula: Option<String>,
    /// Array formula master cell range.
    pub array_ref: Option<String>,
    /// Index into `ParseOutput.style_palette`.
    pub style_id: Option<u32>,
    /// Original OOXML formula metadata for round-trip preservation.
    /// When present, carries shared/array/dataTable formula attributes
    /// so the writer can emit the correct `<f>` element structure.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell_formula: Option<ooxml_types::worksheet::CellFormula>,
    /// OOXML cell metadata index from the `<c cm="N">` attribute.
    ///
    /// This is the authored metadata-record reference. Projection/spill behavior
    /// is represented separately by `projection_role` after parser-owned
    /// metadata classification.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell_metadata_index: Option<u32>,
    /// For formula cells with a string result, the OOXML `t` attribute value
    /// (e.g., `6` = "str", `4` = "e", `3` = "b"). Used for round-trip fidelity
    /// to emit the correct `t="str"` on cells whose formula evaluates to a string.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula_result_type: Option<u8>,
    /// Whether the formula cell had an explicit empty `<v/>` element in the original XML.
    /// When true, the writer emits `<v/>` even though the cached value is null/empty.
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub has_empty_cached_value: bool,
    /// Value metadata index from the `vm` attribute on the `<c>` element.
    /// Used for rich value types (linked data types, images-in-cells).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vm: Option<u32>,
    /// Worksheet-level phonetic display flag from `ph` on the `<c>` element.
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub phonetic: bool,
    /// Original ISO/date lexical value from OOXML `t="d"` cells.
    ///
    /// This is distinct from numeric serial dates with date number formats.
    /// Writers emit `t="d"` only while this lexical value still matches the
    /// current cell value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date_lexical_value: Option<String>,
    /// Original shared string table index for imported `t="s"` cells.
    ///
    /// Import provenance only. Writers must derive SST indices from current
    /// cell values/rich-string state instead of consulting this field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_sst_index: Option<u32>,
    /// Original raw value string from the `<v>` element for round-trip fidelity.
    /// Preserves the exact numeric representation (e.g., scientific notation)
    /// that Excel wrote, so the writer can emit it back unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_value: Option<String>,
    /// Parser-owned projection/spill role. Consumers must not infer deletion or
    /// storage omission from `cm` alone.
    #[serde(default, skip_serializing_if = "ImportedCellProjectionRole::is_normal")]
    pub projection_role: ImportedCellProjectionRole,
}

/// Compact coverage for authored style-only worksheet cells.
///
/// Bounds are zero-based and inclusive. `style_id` follows the same boundary
/// contract as [`CellData::style_id`]: an index into `ParseOutput.style_palette`.
/// A value of `0` is meaningful.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthoredStyleRun {
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
    pub style_id: u32,
}

/// Row and column dimension information for a sheet.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetDimensions {
    pub default_row_height: Option<f64>,
    pub default_col_width: Option<f64>,
    /// Default row descent (x14ac:dyDescent on sheetFormatPr) — text baseline offset in points.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_row_descent: Option<f64>,
    /// Base column width (baseColWidth on sheetFormatPr) — roundtrip only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_col_width: Option<u32>,
    /// Whether the default row height is custom (customHeight="1" on sheetFormatPr).
    #[serde(default)]
    pub custom_height: bool,
    /// Whether zero-height rows are the default (zeroHeight="1" on sheetFormatPr).
    #[serde(default)]
    pub zero_height: bool,
    /// Whether default rows have a thick top border (`thickTop` on sheetFormatPr).
    #[serde(default)]
    pub thick_top: bool,
    /// Whether default rows have a thick bottom border (`thickBottom` on sheetFormatPr).
    #[serde(default)]
    pub thick_bottom: bool,
    /// Outline level for rows (outlineLevelRow on sheetFormatPr) — roundtrip only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline_level_row: Option<u8>,
    /// Outline level for columns (outlineLevelCol on sheetFormatPr) — roundtrip only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline_level_col: Option<u8>,
    pub row_heights: Vec<RowDimension>,
    pub col_widths: Vec<ColDimension>,
    /// Column ranges that extend beyond the data region (typically `max=16384`).
    /// Preserved as-is for round-trip fidelity — these are not expanded into
    /// individual ColDimension entries because no ColIds are allocated for them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub trailing_col_ranges: Vec<TrailingColRange>,
}

/// Dimension data for a single row.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowDimension {
    pub row: u32,
    pub height: f64,
    pub custom_height: bool,
    pub hidden: bool,
    /// Whether the row had an explicit hidden attribute. This distinguishes an
    /// authored `hidden="0"` from an omitted default.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub explicit_hidden: bool,
    /// Whether the row has customFormat="1" without an explicit style (s attribute).
    /// This preserves the flag for round-trip fidelity.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub custom_format: bool,
    /// Per-row outline level. `Some(0)` means the source authored
    /// `outlineLevel="0"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline_level: Option<u8>,
    /// Whether the row had an authored `outlineLevel="0"` attribute.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub explicit_outline_level_zero: bool,
    /// Authored collapsed attribute. `Some(false)` preserves `collapsed="0"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collapsed: Option<bool>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub thick_top: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub thick_bot: bool,
    /// Per-row text baseline descent (x14ac:dyDescent attribute).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub descent: Option<f64>,
    /// Row-level phonetic display flag (`ph` attribute).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub phonetic: bool,
    /// Typed lexical hints owned by this row.
    #[serde(default, skip_serializing_if = "RowXmlHints::is_empty")]
    pub xml_hints: RowXmlHints,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowXmlHints {
    /// Authored `spans` attribute.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spans: Option<String>,
    /// Authored row element with no cells and no semantic attributes.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub bare_empty: bool,
}

impl RowXmlHints {
    pub fn is_empty(&self) -> bool {
        self.spans.is_none() && !self.bare_empty
    }
}

/// Dimension data for a single column.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColDimension {
    pub col: u32,
    pub width: f64,
    pub custom_width: bool,
    pub hidden: bool,
    pub best_fit: bool,
    /// Whether the outline group is collapsed at this column.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub collapsed: bool,
    /// Column-level phonetic display flag (`phonetic` on `<col>`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub phonetic: bool,
}

/// A column range that extends beyond the data region, preserved for round-trip fidelity.
///
/// In OOXML, `<col max="16384">` means "apply this style/width to all columns
/// from `min` through XFD (the last column)". These ranges cannot be stored as
/// individual ColDimension entries because no ColIds are allocated beyond the
/// data region. Instead they are stored as opaque metadata through Yrs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrailingColRange {
    /// Start column (1-indexed, as in OOXML `<col min>`).
    pub min: u32,
    /// End column (1-indexed, as in OOXML `<col max>`). 16384 = XFD = last column.
    pub max: u32,
    pub width: f64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub custom_width: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub best_fit: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub collapsed: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub phonetic: bool,
    /// Column style index into `ParseOutput.style_palette`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_id: Option<u32>,
}

/// Frozen pane configuration.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenPane {
    pub rows: u32,
    pub cols: u32,
    pub top_left_cell: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SheetPaneState {
    Frozen,
    FrozenSplit,
    Split,
}

impl SheetPaneState {
    pub fn from_ooxml(state: ooxml_types::worksheet::PaneState) -> Self {
        match state {
            ooxml_types::worksheet::PaneState::Frozen => Self::Frozen,
            ooxml_types::worksheet::PaneState::FrozenSplit => Self::FrozenSplit,
            ooxml_types::worksheet::PaneState::Split => Self::Split,
        }
    }

    pub fn to_ooxml(self) -> ooxml_types::worksheet::PaneState {
        match self {
            Self::Frozen => ooxml_types::worksheet::PaneState::Frozen,
            Self::FrozenSplit => ooxml_types::worksheet::PaneState::FrozenSplit,
            Self::Split => ooxml_types::worksheet::PaneState::Split,
        }
    }

    pub fn is_frozen(self) -> bool {
        matches!(self, Self::Frozen | Self::FrozenSplit)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SheetPaneId {
    BottomLeft,
    BottomRight,
    TopLeft,
    TopRight,
}

impl SheetPaneId {
    pub fn from_ooxml(pane: ooxml_types::worksheet::Pane) -> Self {
        match pane {
            ooxml_types::worksheet::Pane::BottomLeft => Self::BottomLeft,
            ooxml_types::worksheet::Pane::BottomRight => Self::BottomRight,
            ooxml_types::worksheet::Pane::TopLeft => Self::TopLeft,
            ooxml_types::worksheet::Pane::TopRight => Self::TopRight,
        }
    }

    pub fn to_ooxml(self) -> ooxml_types::worksheet::Pane {
        match self {
            Self::BottomLeft => ooxml_types::worksheet::Pane::BottomLeft,
            Self::BottomRight => ooxml_types::worksheet::Pane::BottomRight,
            Self::TopLeft => ooxml_types::worksheet::Pane::TopLeft,
            Self::TopRight => ooxml_types::worksheet::Pane::TopRight,
        }
    }
}

/// Typed OOXML pane metadata for the primary sheet view.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetPaneConfig {
    pub state: SheetPaneState,
    pub x_split: f64,
    pub y_split: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_left_cell: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_pane: Option<SheetPaneId>,
}

impl SheetPaneConfig {
    pub fn from_ooxml(pane: &ooxml_types::worksheet::SheetPane) -> Self {
        Self {
            state: SheetPaneState::from_ooxml(pane.effective_state()),
            x_split: pane.x_split,
            y_split: pane.y_split,
            top_left_cell: pane.top_left_cell.clone(),
            active_pane: pane.active_pane.map(SheetPaneId::from_ooxml),
        }
    }

    pub fn to_ooxml(&self) -> ooxml_types::worksheet::SheetPane {
        ooxml_types::worksheet::SheetPane {
            x_split: self.x_split,
            y_split: self.y_split,
            top_left_cell: self.top_left_cell.clone(),
            active_pane: self.active_pane.map(SheetPaneId::to_ooxml),
            state: Some(self.state.to_ooxml()),
        }
    }
}

/// Sheet view settings (zoom, visibility toggles, scroll position).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetView {
    pub show_gridlines: bool,
    pub show_row_col_headers: bool,
    pub show_zeros: bool,
    pub show_outline_symbols: bool,
    pub show_formulas: bool,
    pub right_to_left: bool,
    /// Whether to show ruler in page layout view (default: true).
    #[serde(default = "crate::default_true")]
    pub show_ruler: bool,
    /// Whether to show white space in page layout view (default: true).
    #[serde(default = "crate::default_true")]
    pub show_white_space: bool,
    /// Whether the default grid color is used (default: true).
    #[serde(default = "crate::default_true")]
    pub default_grid_color: bool,
    /// Whether the window is protected from resizing.
    #[serde(default)]
    pub window_protection: bool,
    /// Indexed color value for grid lines (legacy). None means default (64).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_id: Option<u32>,
    pub zoom_scale: Option<u32>,
    pub zoom_scale_normal: Option<u32>,
    /// View type: "normal" (default, omitted), "pageBreakPreview", or "pageLayout".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<String>,
    /// Zoom scale for page layout view (zoomScalePageLayoutView).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub zoom_scale_page_layout_view: Option<u32>,
    /// Zoom scale for page break preview (zoomScaleSheetLayoutView).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub zoom_scale_sheet_layout_view: Option<u32>,
    #[serde(default, skip_serializing_if = "crate::is_zero_u32")]
    pub workbook_view_id: u32,
    pub scroll_row: u32,
    pub scroll_col: u32,
    /// Whether the original file had an explicit `topLeftCell` attribute on `<sheetView>`.
    /// When true, `topLeftCell` is emitted even if scroll_row/scroll_col are both 0
    /// (i.e., the attribute value is the default "A1").
    #[serde(default)]
    pub has_explicit_top_left_cell: bool,
    pub tab_selected: bool,
    /// Active cell reference from `<selection activeCell="...">` (e.g. "E16").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_cell: Option<String>,
    /// Selection range from `<selection sqref="...">` (e.g. "E16" or "A1:B5").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sqref: Option<String>,
    /// Typed pane configuration from this `<sheetView>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pane: Option<SheetPaneConfig>,
    /// All selection elements for round-trip fidelity.
    /// When present, these are used instead of active_cell/sqref to preserve
    /// multi-pane selections (frozen pane sheets have up to 4 selection elements).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub selections: Vec<ooxml_types::worksheet::Selection>,
    /// Pivot table selections in this view. Pivot identity validation is owned
    /// by the pivot/data-feature layer; worksheet core preserves the view pointer.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pivot_selection: Vec<ooxml_types::worksheet::PivotSelection>,
    /// Direct-child `<extLst>` XML owned by this sheet view.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<String>,
}

impl Default for SheetView {
    fn default() -> Self {
        Self {
            show_gridlines: true,
            show_row_col_headers: true,
            show_zeros: true,
            show_outline_symbols: true,
            show_formulas: false,
            right_to_left: false,
            show_ruler: true,
            show_white_space: true,
            default_grid_color: true,
            window_protection: false,
            color_id: None,
            zoom_scale: None,
            zoom_scale_normal: None,
            view: None,
            zoom_scale_page_layout_view: None,
            zoom_scale_sheet_layout_view: None,
            workbook_view_id: 0,
            scroll_row: 0,
            scroll_col: 0,
            has_explicit_top_left_cell: false,
            tab_selected: false,
            active_cell: None,
            sqref: None,
            pane: None,
            selections: Vec::new(),
            pivot_selection: Vec::new(),
            ext_lst_xml: None,
        }
    }
}

impl SheetView {
    pub fn from_ooxml(sv: &ooxml_types::worksheet::SheetView) -> Self {
        let (scroll_row, scroll_col) = sv
            .top_left_cell
            .as_deref()
            .and_then(parse_a1_cell_ref)
            .unwrap_or((0, 0));
        let primary_selection = sv.selections.last();
        Self {
            show_gridlines: sv.show_grid_lines,
            show_row_col_headers: sv.show_row_col_headers,
            show_zeros: sv.show_zeros,
            show_outline_symbols: sv.show_outline_symbols,
            show_formulas: sv.show_formulas,
            right_to_left: sv.right_to_left,
            show_ruler: sv.show_ruler,
            show_white_space: sv.show_white_space,
            default_grid_color: sv.default_grid_color,
            window_protection: sv.window_protection,
            color_id: if sv.color_id == 64 {
                None
            } else {
                Some(sv.color_id)
            },
            zoom_scale: if sv.zoom_scale == 100 {
                None
            } else {
                Some(sv.zoom_scale)
            },
            zoom_scale_normal: if sv.zoom_scale_normal == 0 {
                None
            } else {
                Some(sv.zoom_scale_normal)
            },
            view: if sv.view.is_default() {
                None
            } else {
                Some(sv.view.to_ooxml().to_string())
            },
            zoom_scale_page_layout_view: sv.zoom_scale_page_layout_view,
            zoom_scale_sheet_layout_view: sv.zoom_scale_sheet_layout_view,
            workbook_view_id: sv.workbook_view_id,
            scroll_row,
            scroll_col,
            has_explicit_top_left_cell: sv.top_left_cell.is_some(),
            tab_selected: sv.tab_selected,
            active_cell: primary_selection.and_then(|s| s.active_cell.clone()),
            sqref: primary_selection.and_then(|s| s.sqref.clone()),
            pane: sv.pane.as_ref().map(SheetPaneConfig::from_ooxml),
            selections: sv.selections.clone(),
            pivot_selection: sv.pivot_selection.clone(),
            ext_lst_xml: sv.ext_lst_xml.clone(),
        }
    }
}

fn parse_a1_cell_ref(cell_ref: &str) -> Option<(u32, u32)> {
    let mut col: u32 = 0;
    let mut row_start = 0;
    let bytes = cell_ref.as_bytes();
    let mut i = 0;
    if bytes.get(i) == Some(&b'$') {
        i += 1;
    }
    while let Some(&b) = bytes.get(i) {
        if b.is_ascii_alphabetic() {
            col = col * 26 + (b.to_ascii_uppercase() - b'A' + 1) as u32;
            row_start = i + 1;
            i += 1;
        } else {
            break;
        }
    }
    if bytes.get(row_start) == Some(&b'$') {
        row_start += 1;
    }
    if col == 0 || row_start >= cell_ref.len() {
        return None;
    }
    let row: u32 = cell_ref[row_start..].parse().ok()?;
    if row == 0 {
        return None;
    }
    Some((row - 1, col - 1))
}

// MergeRegion is defined in domain::merge and re-exported via `use crate::domain::*` above.

/// Style override for an entire row.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowStyleEntry {
    pub row: u32,
    pub style_id: u32,
}

/// Style override for an entire column.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColStyleEntry {
    pub col: u32,
    pub style_id: u32,
}

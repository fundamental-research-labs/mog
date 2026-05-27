use ooxml_types::styles::Stylesheet;
use ooxml_types::themes::{ColorScheme, FontScheme, FormatScheme};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Opaque XLSX preservation data for import/export round-tripping.
///
/// Hard invariant: this context is only for OOXML/package data that the Mog
/// engine cannot interpret or mutate. If Mog has a domain type for a concept,
/// import must lower it into that domain type and export must regenerate the
/// OOXML/package graph from domain state.
///
/// This context must never be the source of truth for engine-mutated workbook
/// semantics, modeled XML parts, content types, or relationships. Preserved
/// blobs are valid only for opaque subgraphs whose owner parts are also outside
/// Mog's mutation surface.
///
/// Relationship IDs, part names, and ordering from imported XLSX files may be
/// kept as non-authoritative hints only. They must not decide whether modeled
/// parts exist in the exported package.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundTripContext {
    pub sheets: Vec<SheetRoundTripContext>,

    /// Full parsed stylesheet for lossless style reconstruction.
    /// Contains all OOXML style components (fonts, fills, borders, cellXfs,
    /// cellStyleXfs, cellStyles, dxfs, colors, tableStyles, numFmts) with
    /// original theme/indexed color references preserved.
    /// When present, the writer uses this directly instead of the lossy
    /// DocumentFormat palette.
    /// The `x14ac:knownFonts="1"` flag lives on `Stylesheet.known_fonts`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parsed_stylesheet: Option<Stylesheet>,

    /// Raw XML of `<extLst>...</extLst>` from `xl/styles.xml` for round-trip fidelity.
    /// Extension lists contain vendor-specific data that Stylesheet doesn't model.
    #[serde(default, with = "option_bytes")]
    pub styles_ext_lst_xml: Option<Vec<u8>>,

    /// Namespace declarations from the `<styleSheet>` root element.
    /// Each entry is (prefix, uri). Used to reconstruct `mc:Ignorable`, `xmlns:x14ac`,
    /// and other namespace attrs for round-trip fidelity.
    #[serde(default)]
    pub styles_namespace_attrs: Vec<(String, String)>,

    // OPC packaging.
    //
    // AUDIT WARNING: package-level rels/content-types are currently broad
    // preservation hooks. Under the RoundTripContext invariant above they may
    // only describe opaque, unmodeled subgraphs. They must not be treated as
    // authoritative for workbook, worksheet, styles, sharedStrings, theme,
    // metadata, comments, tables, drawings, pivots, or any other modeled part.
    #[serde(default)]
    pub content_type_defaults: Vec<(String, String)>,
    #[serde(default)]
    pub content_type_overrides: Vec<(String, String)>,
    #[serde(default)]
    pub root_relationships: Vec<OpcRelationship>,
    #[serde(default)]
    pub workbook_relationships: Vec<OpcRelationship>,

    /// Original relationship IDs per sheet from workbook.xml, in document order.
    ///
    /// Non-authoritative hint only. Sheet relationships for modeled worksheets
    /// must be generated from the exported workbook graph.
    #[serde(default)]
    pub sheet_workbook_r_ids: Vec<String>,

    // Workbook-level preserved blobs
    /// Original `count` attribute from the `<sst>` element in the parsed XLSX.
    ///
    /// AUDIT WARNING: shared strings are part of the modeled cell graph. This
    /// may not override the count implied by generated sharedStrings.xml.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_sst_count: Option<usize>,

    /// Parsed shared strings list (index-aligned with the raw SST XML).
    ///
    /// AUDIT WARNING: shared strings are cell data, so this may only be used as
    /// an index hint for cells that still prove they reference the same text.
    /// It must not make the imported SST authoritative.
    #[serde(default)]
    pub shared_strings_list: Vec<String>,

    /// Rich text runs for SST entries with formatting.
    /// Index-aligned with `shared_strings_list`. `None` = plain text, `Some` = rich text runs.
    /// Used to preserve rich text formatting during round-trip.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shared_strings_rich_runs: Vec<Option<Vec<crate::domain::comment::RichTextRun>>>,

    /// Raw phonetic XML (`<rPh>...</rPh>` + `<phoneticPr .../>`) per SST entry.
    /// Index-aligned with `shared_strings_list`. `None` = no phonetic data.
    /// Used to preserve Japanese/CJK phonetic annotations during round-trip.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shared_strings_phonetic_xml: Vec<Option<Vec<u8>>>,

    /// AUDIT WARNING: sharedStrings.xml is generated from modeled cells and
    /// must not be replayed verbatim once cells can change.
    #[serde(default, with = "option_bytes")]
    pub raw_shared_strings_xml: Option<Vec<u8>>,
    #[serde(default, with = "option_bytes")]
    pub raw_doc_props_core_xml: Option<Vec<u8>>,
    #[serde(default, with = "option_bytes")]
    pub raw_doc_props_app_xml: Option<Vec<u8>>,
    #[serde(default, with = "option_bytes")]
    pub raw_doc_props_custom_xml: Option<Vec<u8>>,
    #[serde(default, with = "option_bytes")]
    pub raw_metadata_xml: Option<Vec<u8>>,
    #[serde(default, with = "option_bytes")]
    pub raw_persons_xml: Option<Vec<u8>>,
    /// Parsed external link definitions for proper domain-based round-tripping.
    /// Each entry represents one externalLinkN.xml file with its resolved relationships.
    #[serde(default)]
    pub external_links: Vec<crate::domain::external_link::ExternalLink>,
    #[serde(default)]
    pub custom_xml_parts: Vec<BlobPart>,
    #[serde(default)]
    pub web_extension_parts: Vec<BlobPart>,
    /// Explicit clean opaque package subgraphs that may be emitted verbatim.
    ///
    /// Legacy raw fields such as `custom_xml_parts`, `web_extension_parts`, and
    /// `binary_blobs` are compatibility inputs only. Exporters should preserve
    /// opaque package data through these typed records once import can prove a
    /// closed clean subgraph.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub opaque_package_subgraphs: Vec<OpaquePackageSubgraph>,
    /// General-purpose binary blob passthrough for ZIP entries not modeled
    /// in the domain (printerSettings, vbaProject, richData, featurePropertyBag,
    /// customProperty, media, timelines, timelineCaches,
    /// queryTables, connections, volatileDependencies, thumbnails, etc.).
    /// Written back to the output ZIP verbatim.
    #[serde(default)]
    pub binary_blobs: Vec<BlobPart>,
    /// Typed pivot package preservation data.
    ///
    /// Clean imported pivot packages are OPC package identity, not semantic pivot
    /// configs: they include workbook/sheet relationships, part paths, content
    /// types, raw OOXML bytes, and ownership state. The XLSX writer uses this
    /// sidecar to replay clean imported pivot packages verbatim while generating
    /// packages only for API-created or explicitly dirty pivots.
    #[serde(default, skip_serializing_if = "PivotPackageRoundTrip::is_empty")]
    pub pivot_package: PivotPackageRoundTrip,
    #[serde(default)]
    pub workbook_views: Vec<crate::domain::workbook::WorkbookView>,
    /// Original `calcId` from `<calcPr>`. Preserved for round-trip fidelity
    /// until iterative_calc settings are properly hydrated into Yrs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calc_id: Option<u32>,
    /// Full iterative calculation settings from the original file.
    /// Preserved for round-trip fidelity — includes max_iterations, max_change,
    /// and the `has_explicit_*` flags that control whether attributes are emitted
    /// even when they match defaults.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub iterative_calc_settings: Option<crate::domain::workbook::CalculationProperties>,
    #[serde(default)]
    pub extensions: Option<ExtensionPreservation>,

    /// Namespace declarations from the `<workbook>` root element.
    /// Each entry is (prefix, uri). Used to reconstruct `mc:Ignorable` and
    /// other extension namespace attrs for round-trip fidelity.
    #[serde(default)]
    pub workbook_namespace_attrs: Vec<(String, String)>,
    /// Preserved unknown XML elements from `workbook.xml` as raw XML strings.
    /// Each entry is (position_key, raw_xml) where position_key encodes
    /// the insertion point (e.g., "first:workbook", "after:workbook:fileVersion").
    #[serde(default)]
    pub workbook_preserved_elements: Vec<(String, String)>,

    /// Named ranges from the original XLSX that were not imported into the
    /// compute engine (hidden names like `_xlnm._FilterDatabase`, orphaned
    /// `#REF!` entries, etc.). Preserved here for round-trip fidelity and
    /// merged back during export to maintain the original defined name list.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skipped_named_ranges: Vec<crate::parse_output::NamedRange>,

    /// Complete original named ranges list in document order. Used during
    /// export to reconstruct the correct ordering when merging engine-updated
    /// names with preserved skipped names.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub original_named_ranges_order: Vec<crate::parse_output::NamedRange>,

    // Theme preservation for lossless round-tripping.
    // When present, the writer uses these instead of the lossy ThemeData reconstruction.
    /// Original theme name (e.g., "Office Theme 2007 - 2010"). Localized names
    /// must survive round-trip without being clobbered by defaults.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_name: Option<String>,
    /// Full DrawingML color scheme (preserves sysClr/srgbClr variants, transforms).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_color_scheme: Option<ColorScheme>,
    /// Full font scheme with script-specific font mappings (Jpan, Hang, Hans, etc.).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_font_scheme: Option<FontScheme>,
    /// Full format scheme (fill, line, and effect style lists).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_format_scheme: Option<FormatScheme>,
    /// Raw inner XML of `<a:objectDefaults>` (inner content only, no wrapper tags).
    #[serde(default, with = "option_bytes")]
    pub theme_object_defaults_xml: Option<Vec<u8>>,
    /// Raw inner XML of `<a:extraClrSchemeLst>` (inner content only).
    #[serde(default, with = "option_bytes")]
    pub theme_extra_clr_scheme_lst_xml: Option<Vec<u8>>,
    /// Raw XML of `<a:extLst>` (full element including tags).
    #[serde(default, with = "option_bytes")]
    pub theme_ext_lst_xml: Option<Vec<u8>>,
    /// Raw bytes of `docMetadata/LabelInfo.xml` for verbatim round-trip passthrough.
    #[serde(default, with = "option_bytes")]
    pub doc_metadata_label_info: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetRoundTripContext {
    /// AUDIT WARNING: sheet relationships may only preserve opaque sheet-owned
    /// subgraphs. Relationships for modeled sheet features must be generated
    /// from domain state.
    #[serde(default)]
    pub sheet_opc_rels: Vec<OpcRelationship>,
    #[serde(default)]
    pub raw_vml_drawings: Vec<VmlDrawingPart>,
    pub legacy_drawing_r_id: Option<String>,
    pub legacy_drawing_hf_r_id: Option<String>,
    #[serde(default)]
    pub table_xml_passthroughs: Vec<BlobPart>,
    #[serde(default)]
    pub comments_root_namespace_attrs: Vec<(String, String)>,
    /// Original comment author list from the parsed comments XML.
    /// Preserved for round-trip fidelity — the reconstruction from domain types
    /// only includes authors referenced by actual comments, dropping unused authors.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub comment_authors: Vec<String>,
    #[serde(default)]
    pub row_descents: HashMap<u32, f64>,
    #[serde(default)]
    pub row_spans: HashMap<u32, String>,
    #[serde(default)]
    pub bare_empty_rows: Vec<u32>,
    /// Rows with thickBot="1" attribute for round-trip fidelity.
    #[serde(default)]
    pub row_thick_bot: Vec<u32>,
    /// Rows with thickTop="1" attribute for round-trip fidelity.
    #[serde(default)]
    pub row_thick_top: Vec<u32>,
    /// Rows with an explicit `collapsed` attribute for round-trip fidelity.
    /// Maps row index → collapsed value. Preserves both `collapsed="0"` and `collapsed="1"`.
    #[serde(default)]
    pub row_collapsed: HashMap<u32, bool>,
    /// Rows with explicit `hidden="0"` for round-trip fidelity.
    /// Normally `hidden="0"` (the default) is omitted; these rows had it explicitly.
    #[serde(default)]
    pub row_hidden_explicit_false: Vec<u32>,
    /// Rows with explicit `outlineLevel="0"` for round-trip fidelity.
    /// Normally `outlineLevel="0"` (the default) is omitted; these rows had it explicitly.
    #[serde(default)]
    pub row_outline_level_zero: Vec<u32>,
    pub original_dimension: Option<String>,
    /// Whether zero-height rows are the default (zeroHeight="1" on sheetFormatPr).
    #[serde(default)]
    pub zero_height: bool,
    /// Whether the original worksheet had an empty `<extLst/>` element.
    /// Used for round-trip fidelity when there are no sparklines or other extensions.
    #[serde(default)]
    pub has_empty_ext_lst: bool,
    /// Raw `<extLst>...</extLst>` XML from the worksheet for round-trip passthrough.
    /// Captures extension elements (x14:dataValidations, x14:conditionalFormattings, etc.).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<String>,
    /// Preserved namespace declarations from the `<worksheet>` root element.
    /// Each entry is (prefix, uri). Used to reconstruct `mc:Ignorable` and
    /// other non-standard namespace attrs for round-trip fidelity.
    #[serde(default)]
    pub preserved_namespace_attrs: Vec<(String, String)>,
    /// Per-chart auxiliary data for round-trip fidelity (style XML, colors XML, .rels).
    #[serde(default)]
    pub chart_auxiliary_data: Vec<ChartAuxiliaryData>,
    /// Per-ChartEx auxiliary data (style XML, colors XML, .rels) — separate from standard charts.
    #[serde(default)]
    pub chart_ex_auxiliary_data: Vec<ChartAuxiliaryData>,
    /// Preserved OOXML cell formula metadata (shared, array, dataTable) for round-trip.
    /// Each entry is ((row, col), CellFormula). Stored here because Yrs doesn't track
    /// shared formula grouping — it expands all formulas to individual A1 text.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cell_formulas: Vec<((u32, u32), ooxml_types::worksheet::CellFormula)>,
    /// Raw `<customProperties>...</customProperties>` element from the worksheet.
    /// These are worksheet-level custom property references (with r:id links to binary parts).
    pub custom_properties_xml: Option<String>,
    /// Cells where the `<v>` element had `xml:space="preserve"`.
    /// Stored as (row, col) pairs for round-trip fidelity.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub xml_space_value_cells: Vec<(u32, u32)>,
    /// Explicit blank `<c r="..."/>` cells from the source worksheet.
    ///
    /// The production Yrs store intentionally does not allocate persistent cells
    /// for style-less blanks, but OOXML authors can include explicit blank cell
    /// elements for row span/fidelity reasons. Preserve their positions here so
    /// L2 export can replay them without making sparse Yrs storage dense.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub explicit_blank_cells: Vec<(u32, u32)>,
    /// Imported cells intentionally not materialized into editable storage.
    ///
    /// Dynamic-array spill targets are parser-proven projection outputs, not
    /// user-editable source cells. L2 import may omit them from Yrs storage, but
    /// export must still replay the original cached `<c>` element until a later
    /// edit or recalculation produces a real cell at the same position.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skipped_storage_cells: Vec<crate::parse_output::CellData>,
    /// Raw `<headerFooter>...</headerFooter>` XML from the worksheet.
    ///
    /// Header/footer text uses OOXML lexical escapes such as `_x000D_` where a
    /// literal decoded carriage return is semantically close but not byte/roundtrip
    /// equivalent. Replaying the source element avoids normalizing that syntax.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header_footer_xml: Option<String>,
    /// Raw worksheet-level controls `mc:AlternateContent` XML.
    ///
    /// Existing files vary in whether they include an `mc:Fallback` branch and
    /// where namespace declarations live. Preserve the original wrapper when the
    /// workbook is otherwise unchanged instead of synthesizing a different one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worksheet_controls_xml: Option<String>,
    /// Multi-pane selection elements for round-trip fidelity.
    /// Frozen-pane sheets can have up to 4 selection elements (one per pane).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub view_selections: Vec<ooxml_types::worksheet::Selection>,
    /// Cells where the `<f>` element had `xml:space="preserve"`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub xml_space_formula_cells: Vec<(u32, u32)>,
    /// Cells with `ca="1"` (force recalc / volatile formula flag).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub force_recalc_cells: Vec<(u32, u32)>,
    /// Preserved unknown XML elements from the worksheet as raw XML strings.
    /// Each entry is (position_key, raw_xml) — same format as `workbook_preserved_elements`.
    /// Captures elements like `<sheetPr>` with `<tabColor>` that the parser doesn't model.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sheet_preserved_elements: Vec<(String, String)>,
    /// Raw XML of drawing anchors with content-level `mc:AlternateContent` (e.g., ChartEx).
    /// Each entry is (original_anchor_index, raw_xml) where the index is the position within
    /// the original drawing's anchor list. Used to preserve anchor ordering during round-trip.
    /// The raw_xml is the entire `<xdr:twoCellAnchor>...</xdr:twoCellAnchor>` element.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub drawing_anchor_passthroughs: Vec<(usize, String)>,
    /// Clean-imported DrawingML package part and optional relationship sidecar.
    ///
    /// Relationship topology alone is not enough: preserving the sheet
    /// relationship requires preserving or regenerating the target drawing part
    /// as well.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imported_drawing: Option<ImportedDrawingPart>,
    /// Original drawing root namespace declarations from `<xdr:wsDr>`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub drawing_root_namespace_attrs: Vec<(String, String)>,
    /// Original drawing ZIP path when the worksheet relationship identifies it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_drawing_path: Option<String>,
    /// Original OPC relationships from the drawing .rels file.
    /// Used with `add_with_id` to preserve original relationship IDs for chart/chartEx references.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub drawing_opc_rels: Vec<OpcRelationship>,
    /// Whether a drawing .rels file existed in the original archive (even if empty).
    /// Some XLSX files contain empty `<Relationships/>` rels files that must be preserved.
    #[serde(default)]
    pub has_drawing_rels_file: bool,
    /// Whether the original `<mergeCells>` element had a `count` attribute.
    /// The attribute is optional per OOXML spec; this preserves the original choice.
    #[serde(default)]
    pub merge_cells_has_count: bool,
}

/// Auxiliary files for a single chart needed for round-trip fidelity.
/// Stores the chart's .rels file, style XML, colors XML, and original path.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartAuxiliaryData {
    /// Auxiliary files (style XML, colors XML, etc.) — path + bytes.
    #[serde(default)]
    pub auxiliary_files: Vec<BlobPart>,
    /// Raw bytes of the chart's .rels file.
    #[serde(default, with = "option_bytes")]
    pub chart_rels: Option<Vec<u8>>,
    /// Original ZIP path (e.g., "xl/charts/chart2.xml") for preserving numbering.
    pub original_path: Option<String>,
}

/// A named binary blob part (path + bytes).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BlobPart {
    pub path: String,
    #[serde(with = "bytes_serde")]
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OpaquePackageOwner {
    #[default]
    Root,
    Workbook,
    Worksheet {
        index: usize,
        path: String,
    },
    Part {
        path: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OpaquePackageOwnership {
    #[default]
    CleanImported,
    DirtyImported,
    Generated,
    Deleted,
    OrphanCleanPackageData,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OpaqueRelationshipTarget {
    InternalPart { path: String },
    InternalPath { target: String },
    External { target: String },
}

impl Default for OpaqueRelationshipTarget {
    fn default() -> Self {
        Self::InternalPath {
            target: String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpaquePackageRelationship {
    pub owner: OpaquePackageOwner,
    pub relationship_type: String,
    pub target: OpaqueRelationshipTarget,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relationship_id_hint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpaquePackagePart {
    pub part: BlobPart,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_extension: Option<(String, String)>,
    #[serde(default)]
    pub ownership: OpaquePackageOwnership,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpaquePackageSubgraph {
    pub owner: OpaquePackageOwner,
    pub owner_relationship: OpaquePackageRelationship,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parts: Vec<OpaquePackagePart>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relationships: Vec<OpaquePackageRelationship>,
    #[serde(default)]
    pub ownership: OpaquePackageOwnership,
}

/// A clean-imported worksheet DrawingML part with its optional `.rels` sidecar.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImportedDrawingPart {
    pub path: String,
    #[serde(with = "bytes_serde")]
    pub data: Vec<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rels: Option<BlobPart>,
}

/// Typed package sidecar for pivot table/cache round-trip preservation.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotPackageRoundTrip {
    /// Original workbook `<pivotCaches>` entries in document order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub workbook_cache_entries: Vec<PivotWorkbookCacheEntry>,
    /// Cache definition packages keyed by cache id/path.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cache_definitions: Vec<PivotCacheDefinitionPackage>,
    /// Sheet-owned pivot table packages.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pivot_tables: Vec<PivotTablePackage>,
    /// Exact content type overrides for pivot package parts.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content_type_overrides: Vec<PivotPackageContentType>,
    /// Pivot package blobs not claimed by a cache/table graph edge.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub orphan_parts: Vec<PivotOrphanPackagePart>,
}

impl PivotPackageRoundTrip {
    pub fn is_empty(&self) -> bool {
        self.workbook_cache_entries.is_empty()
            && self.cache_definitions.is_empty()
            && self.pivot_tables.is_empty()
            && self.content_type_overrides.is_empty()
            && self.orphan_parts.is_empty()
    }
}

/// Ownership state for a pivot package component.
///
/// State transitions:
/// - API-created pivots are `Generated`.
/// - Imported pivots start as `CleanImported` and stay there through open/save.
/// - Edits to an imported pivot table layout/style/filter make the table package
///   at least `DirtyImported`; cache refresh makes the cache dirty/generated.
/// - Deletion marks the exact imported table package `Deleted`; cache deletion is
///   valid only when no remaining table references the cache.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PivotPackageOwnership {
    #[default]
    CleanImported,
    DirtyImported,
    Generated,
    Deleted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PivotCacheSourceKind {
    #[default]
    Unknown,
    Worksheet,
    External,
    Consolidation,
    Scenario,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotWorkbookCacheEntry {
    pub cache_id: u32,
    pub relationship_id: String,
    pub relationship_target: String,
    pub definition_path: String,
    pub order: usize,
    #[serde(default)]
    pub ownership: PivotPackageOwnership,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotCacheDefinitionPackage {
    pub cache_id: u32,
    pub definition_path: String,
    pub definition_rels_path: Option<String>,
    #[serde(default)]
    pub source_kind: PivotCacheSourceKind,
    #[serde(with = "bytes_serde")]
    pub raw_definition_xml: Vec<u8>,
    #[serde(default)]
    pub raw_relationships: Vec<OpcRelationship>,
    pub records_relationship_id: Option<String>,
    pub records_relationship_target: Option<String>,
    pub records_path: Option<String>,
    #[serde(default, with = "option_bytes")]
    pub raw_records_xml: Option<Vec<u8>>,
    #[serde(default)]
    pub ownership: PivotPackageOwnership,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotTablePackage {
    pub sheet_index: usize,
    pub sheet_name: String,
    pub sheet_relationship_id: String,
    pub sheet_relationship_target: String,
    pub table_path: String,
    pub table_rels_path: Option<String>,
    pub pivot_name: Option<String>,
    #[serde(with = "bytes_serde")]
    pub raw_table_xml: Vec<u8>,
    #[serde(default)]
    pub raw_relationships: Vec<OpcRelationship>,
    pub referenced_cache_id: u32,
    pub order: usize,
    #[serde(default)]
    pub ownership: PivotPackageOwnership,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotPackageContentType {
    pub part_name: String,
    pub content_type: String,
    #[serde(default)]
    pub ownership: PivotPackageOwnership,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotOrphanPackagePart {
    pub part: BlobPart,
    pub content_type: Option<String>,
    #[serde(default)]
    pub ownership: PivotPackageOwnership,
}

/// VML drawing part with optional relationships file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VmlDrawingPart {
    pub path: String,
    #[serde(with = "bytes_serde")]
    pub data: Vec<u8>,
    pub rels: Option<VmlRels>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VmlRels {
    pub path: String,
    #[serde(with = "bytes_serde")]
    pub data: Vec<u8>,
}

/// OPC relationship entry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpcRelationship {
    pub id: String,
    pub rel_type: String,
    pub target: String,
    pub target_mode: Option<String>,
}

// WorkbookView has moved to domain::workbook (strongly-typed, with From<BookView>).

/// Extension list preservation for forward compatibility.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionPreservation {
    pub namespaces: Vec<(String, String)>,
    pub elements: Vec<String>,
}

// Helper modules for Vec<u8> serialization as base64
mod bytes_serde {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S: Serializer>(bytes: &Vec<u8>, s: S) -> Result<S::Ok, S::Error> {
        // Serialize as array of numbers for JSON compatibility
        bytes.serialize(s)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        Vec::<u8>::deserialize(d)
    }
}

mod option_bytes {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S: Serializer>(val: &Option<Vec<u8>>, s: S) -> Result<S::Ok, S::Error> {
        val.serialize(s)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Vec<u8>>, D::Error> {
        Option::<Vec<u8>>::deserialize(d)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_context_defaults_missing_pivot_package() {
        let ctx: RoundTripContext = serde_json::from_str(r#"{"sheets":[]}"#).unwrap();
        assert!(ctx.pivot_package.is_empty());
        assert!(ctx.binary_blobs.is_empty());
    }

    #[test]
    fn round_trip_context_serializes_typed_pivot_package() {
        let ctx = RoundTripContext {
            pivot_package: PivotPackageRoundTrip {
                workbook_cache_entries: vec![PivotWorkbookCacheEntry {
                    cache_id: 42,
                    relationship_id: "rId42".to_string(),
                    relationship_target: "pivotCache/pivotCacheDefinition42.xml".to_string(),
                    definition_path: "xl/pivotCache/pivotCacheDefinition42.xml".to_string(),
                    order: 0,
                    ownership: PivotPackageOwnership::CleanImported,
                }],
                ..Default::default()
            },
            ..Default::default()
        };

        let json = serde_json::to_string(&ctx).unwrap();
        let round_tripped: RoundTripContext = serde_json::from_str(&json).unwrap();
        assert_eq!(
            round_tripped.pivot_package.workbook_cache_entries[0].cache_id,
            42
        );
        assert_eq!(
            round_tripped.pivot_package.workbook_cache_entries[0].ownership,
            PivotPackageOwnership::CleanImported
        );
    }
}

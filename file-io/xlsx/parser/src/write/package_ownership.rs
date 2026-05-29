//! Package graph ownership contract.
//!
//! This matrix is the writer-side authority for deciding whether an OOXML
//! package cluster is modeled by Mog or can remain an unknown opaque extension.

use domain_types::{
    XlsxDiagnosticContinuation, XlsxDiagnosticReason, XlsxDiagnosticSeverity, XlsxExportAction,
    XlsxOwnerPolicyRequiredTest, XlsxPackageOwnerId,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum PackageFeatureOwner {
    CoreWorkbook,
    NonEditableSheets,
    WorksheetTables,
    ConnectionsAndQueryTables,
    OleObjects,
    RichData,
    PivotTables,
    SlicersAndTimelines,
    ChartAuxiliary,
    ExternalLinks,
    DocumentProperties,
    DrawingObjects,
    Comments,
    ThreadedComments,
    Controls,
    PrintSettings,
    Hyperlinks,
    Media,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PackageOwnershipContract {
    pub owner: PackageFeatureOwner,
    pub owner_domain: &'static str,
    pub parts: &'static [&'static str],
    pub relationships: &'static [&'static str],
    pub content_types: &'static [&'static str],
    pub relationship_id_hints: &'static [&'static str],
    pub dirty_invalidation_triggers: &'static [&'static str],
    pub opaque_policy: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CurrentStateOwnerPolicy {
    pub owner: PackageFeatureOwner,
    pub owner_id: XlsxPackageOwnerId,
    pub package_part_patterns: &'static [&'static str],
    pub relationship_patterns: &'static [&'static str],
    pub typed_live_state: &'static str,
    pub typed_import_fields: &'static [&'static str],
    pub provenance_only_fields: &'static [&'static str],
    pub closure_requirements: &'static [&'static str],
    pub mutation_invalidators: &'static [&'static str],
    pub currentness_validator: &'static str,
    pub export_action: XlsxExportAction,
    pub diagnostic_code: &'static str,
    pub diagnostic_severity: XlsxDiagnosticSeverity,
    pub diagnostic_reason: XlsxDiagnosticReason,
    pub continuation: XlsxDiagnosticContinuation,
    pub required_tests: &'static [XlsxOwnerPolicyRequiredTest],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuxiliaryPackagePartPolicy {
    InertOpaqueAuxiliary,
    TypedOwned,
    ActiveQuarantined,
    ActiveForbidden,
    ExternalCapable,
    UnsupportedNeedsModel,
    DiagnosticsOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OoxmlOwnershipClassification {
    TypedEditable,
    TypedViewOnly,
    InventoryOnly,
    SafeInert,
    UnsupportedActive,
    InternalHelper,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CanonicalTypeStatus {
    ProductionReady,
    NeedsCorrection,
    InventoryOnly,
    InternalHelper,
    NotPresent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApiExposureLevel {
    InternalOnly,
    DiagnosticOnly,
    ReadOnly,
    Editable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpaquePackagePolicy {
    None,
    OwnerScopedInert,
    DiagnosticDrop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OoxmlOwnershipRow {
    pub surface: &'static str,
    pub package_part_patterns: &'static [&'static str],
    pub ooxml_modules: &'static [&'static str],
    pub canonical_type_status: CanonicalTypeStatus,
    pub classification: OoxmlOwnershipClassification,
    pub production_reader: &'static str,
    pub private_parser_adapter: &'static str,
    pub full_parse_result_field: &'static str,
    pub parse_output_domain_owner: &'static str,
    pub yrs_app_persistence_owner: &'static str,
    pub api_exposure: ApiExposureLevel,
    pub production_writer: &'static str,
    pub package_feature_owner: Option<PackageFeatureOwner>,
    pub auxiliary_policy: Option<AuxiliaryPackagePartPolicy>,
    pub opaque_package_policy: OpaquePackagePolicy,
    pub unsupported_diagnostic_policy: &'static str,
    pub dirty_invalidation_triggers: &'static [&'static str],
    pub semantic_references: &'static [&'static str],
    pub user_visible_behavior: &'static str,
    pub fixture_coverage: &'static str,
}

pub const PACKAGE_OWNERSHIP_MATRIX: &[PackageOwnershipContract] = &[
    PackageOwnershipContract {
        owner: PackageFeatureOwner::CoreWorkbook,
        owner_domain: "workbook",
        parts: &[
            "xl/workbook.xml",
            "xl/worksheets/sheet*.xml",
            "xl/styles.xml",
            "root MCE namespace attributes",
            "mc:AlternateContent wrappers",
            "xl/theme/*.xml",
            "xl/sharedStrings.xml",
            "xl/metadata.xml",
            "xl/persons/person.xml",
        ],
        relationships: &[
            "officeDocument",
            "worksheet",
            "styles",
            "theme",
            "sharedStrings",
            "sheetMetadata",
            "person",
        ],
        content_types: &[
            "workbook",
            "worksheet",
            "styles",
            "theme",
            "sharedStrings",
            "sheetMetadata",
            "person",
        ],
        relationship_id_hints: &["sheet order", "workbook relationship allocation"],
        dirty_invalidation_triggers: &[
            "sheet add/delete/reorder",
            "style registry mutation",
            "theme mutation",
            "cell text mutation",
            "metadata mutation",
            "threaded comment person mutation",
        ],
        opaque_policy: "modeled core parts are regenerated from typed workbook/sheet state; root MCE attributes are benign infrastructure carried on the owning part, while sharedStrings root extLst may replay only when classified relationship-free and active-reference-free",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::NonEditableSheets,
        owner_domain: "non-editable workbook sheets",
        parts: &[
            "xl/chartsheets/sheet*.xml",
            "xl/dialogsheets/sheet*.xml",
            "non-editable sheet relationship closure",
        ],
        relationships: &[
            "workbook -> chartsheet",
            "workbook -> dialogsheet",
            "chartsheet/dialogsheet owned relationships",
        ],
        content_types: &["chartsheet", "dialogsheet", "owned closure content types"],
        relationship_id_hints: &[
            "workbook sheet r:id",
            "non-editable sheet owned relationship ids",
        ],
        dirty_invalidation_triggers: &[
            "sheet add/delete/reorder",
            "sheet name/state/id mutation",
            "related drawing/chart/media ownership collision",
        ],
        opaque_policy: "chartsheet/dialogsheet package clusters may replay only as unchanged inert workbook sheet inventory entries with validated relationship closure",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::WorksheetTables,
        owner_domain: "tables",
        parts: &["xl/tables/table*.xml", "xl/tables/tableSingleCells*.xml"],
        relationships: &["worksheet -> table", "worksheet -> tableSingleCells"],
        content_types: &["table", "tableSingleCells"],
        relationship_id_hints: &[
            "table relationship id when imported",
            "single-cell XML binding relationship id when imported",
        ],
        dirty_invalidation_triggers: &[
            "table create/update/delete",
            "table range mutation",
            "sheet structure mutation",
            "XML map/custom XML binding mutation",
        ],
        opaque_policy: "worksheet table and single-cell XML binding package parts require typed worksheet/table owner state",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::ConnectionsAndQueryTables,
        owner_domain: "connections/queryTables",
        parts: &[
            "xl/connections.xml",
            "xl/queryTables/queryTable*.xml",
            "xl/tables/table*.xml connectionId/queryTableFieldId",
        ],
        relationships: &["workbook -> connections", "table -> queryTable"],
        content_types: &["connections", "queryTable"],
        relationship_id_hints: &["connection id", "query table relationship id"],
        dirty_invalidation_triggers: &[
            "connection create/update/delete",
            "query table definition mutation",
            "table connection binding mutation",
        ],
        opaque_policy: "known connection/query-table clusters must be emitted only from typed owner state",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::OleObjects,
        owner_domain: "ole",
        parts: &[
            "xl/embeddings/oleObject*.bin",
            "xl/embeddings/package*.bin",
            "worksheet <oleObjects>",
        ],
        relationships: &["worksheet -> oleObject", "worksheet -> embedded package"],
        content_types: &["oleObject binary default", "embedded package content type"],
        relationship_id_hints: &["OLE r:id from worksheet objectPr/oleObject"],
        dirty_invalidation_triggers: &["OLE object add/delete/update", "embedded binary mutation"],
        opaque_policy: "OLE package parts require typed worksheet OleObject state and binary data",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::RichData,
        owner_domain: "richData",
        parts: &[
            "xl/richData/rdrichvalue*.xml",
            "xl/richData/rdRichValueTypes.xml",
            "xl/richData/richValueRel.xml",
            "xl/metadata.xml value metadata",
        ],
        relationships: &["workbook -> richData", "richData -> richValueRel"],
        content_types: &["richData", "richValueTypes", "richValueRel"],
        relationship_id_hints: &["metadata vm index", "rich value relationship id"],
        dirty_invalidation_triggers: &[
            "rich data value mutation",
            "metadata valueMetadata mutation",
            "cell vm metadata mutation",
        ],
        opaque_policy: "richData clusters require typed WorkbookMetadata/WorkbookRichData ownership and current metadata/vm reference validation before imported package parts are emitted",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::PivotTables,
        owner_domain: "pivot",
        parts: &[
            "xl/pivotTables/pivotTable*.xml",
            "xl/pivotCache/pivotCacheDefinition*.xml",
            "xl/pivotCache/pivotCacheRecords*.xml",
        ],
        relationships: &[
            "worksheet -> pivotTable",
            "workbook -> pivotCacheDefinition",
            "pivotTable -> pivotCacheDefinition",
            "pivotCacheDefinition -> pivotCacheRecords",
        ],
        content_types: &["pivotTable", "pivotCacheDefinition", "pivotCacheRecords"],
        relationship_id_hints: &[
            "worksheet pivot r:id",
            "pivot table cache relationship id when cache assignment still matches",
        ],
        dirty_invalidation_triggers: &[
            "pivot definition mutation",
            "pivot source range mutation",
            "pivot cache record mutation",
        ],
        opaque_policy: "pivot package parts require typed ParsedPivotTable/cache state; unsupported pivotTableDefinition owner-local attributes/children are preserved only through ParsedPivotTable OOXML preservation sidecars",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::SlicersAndTimelines,
        owner_domain: "slicers/timelines",
        parts: &[
            "xl/slicers/slicer*.xml",
            "xl/slicerCaches/slicerCache*.xml",
            "xl/timelines/timeline*.xml",
            "xl/timelineCaches/timelineCache*.xml",
            "worksheet slicer drawing anchors",
        ],
        relationships: &[
            "worksheet -> slicer",
            "workbook -> slicerCache",
            "drawing -> slicer",
            "worksheet/workbook -> timeline",
        ],
        content_types: &["slicer", "slicerCache", "timeline", "timelineCache"],
        relationship_id_hints: &["slicer relationship id", "cache relationship id"],
        dirty_invalidation_triggers: &[
            "slicer create/update/delete",
            "slicer cache mutation",
            "timeline create/update/delete",
            "bound table/pivot mutation",
        ],
        opaque_policy: "slicer/timeline clusters require typed slicer/cache owner state",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::ChartAuxiliary,
        owner_domain: "chart auxiliary",
        parts: &[
            "xl/charts/style*.xml",
            "xl/charts/colors*.xml",
            "xl/drawings/userShapeDrawing*.xml",
        ],
        relationships: &[
            "chart -> chartStyle",
            "chart -> chartColorStyle",
            "chart -> chartUserShapes",
        ],
        content_types: &["chartStyle", "chartColorStyle", "drawing"],
        relationship_id_hints: &["chart-owned auxiliary r:id"],
        dirty_invalidation_triggers: &[
            "chart style/color mutation",
            "chart user-shapes mutation",
            "chart definition replacement",
        ],
        opaque_policy: "chart auxiliary parts require typed chart auxiliary data",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::ExternalLinks,
        owner_domain: "external links",
        parts: &["xl/externalLinks/externalLink*.xml"],
        relationships: &[
            "workbook -> externalLink",
            "externalLink -> externalLinkPath/longPath/missing/startup/library",
        ],
        content_types: &["externalLink"],
        relationship_id_hints: &["workbook externalLink r:id", "externalLink owned path r:id"],
        dirty_invalidation_triggers: &[
            "external link add/update/delete",
            "defined name/formula external reference mutation",
        ],
        opaque_policy: "external link package parts require typed external link state",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::DocumentProperties,
        owner_domain: "docProps/customXml",
        parts: &[
            "docProps/core.xml",
            "docProps/app.xml",
            "docProps/custom.xml",
            "customXml/*",
            "xl/xmlMaps.xml",
        ],
        relationships: &[
            "root -> core-properties",
            "root -> extended-properties",
            "root -> custom-properties",
            "workbook -> xmlMaps",
            "customXml item -> customXmlProps",
        ],
        content_types: &[
            "core properties",
            "extended properties",
            "custom properties",
            "custom XML",
            "XML maps",
        ],
        relationship_id_hints: &[
            "root docProps r:id allocation",
            "workbook xmlMaps relationship id",
            "custom XML property relationship id",
        ],
        dirty_invalidation_triggers: &[
            "document properties mutation",
            "extended properties mutation",
            "custom properties mutation",
            "custom XML payload mutation",
            "XML map binding mutation",
            "table or single-cell XML binding mutation",
            "sensitivity label mutation",
        ],
        opaque_policy: "docProps parts require typed properties owner state; custom XML payloads and XML maps may replay only as unchanged owner-scoped inert package parts, while XML binding edits require typed map ownership",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::DrawingObjects,
        owner_domain: "drawings",
        parts: &[
            "xl/drawings/drawing*.xml",
            "xl/drawings/_rels/drawing*.xml.rels",
            "xl/charts/chart*.xml",
            "xl/charts/chartEx*.xml",
            "xl/media/*",
        ],
        relationships: &[
            "worksheet -> drawing",
            "drawing -> chart",
            "drawing -> chartEx",
            "drawing -> image",
            "chart -> embedded package",
        ],
        content_types: &["drawing", "chart", "chartEx", "image defaults"],
        relationship_id_hints: &["worksheet drawing r:id", "drawing object relationship ids"],
        dirty_invalidation_triggers: &[
            "drawing object add/update/delete",
            "chart definition mutation",
            "image payload mutation",
        ],
        opaque_policy: "drawing/chart/media parts require typed drawing owner state; ChartEx XML can replay only for unmodified imported charts with validated drawing identity and package-graph-owned relationships",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::Comments,
        owner_domain: "comments",
        parts: &["xl/comments*.xml", "xl/drawings/vmlDrawing*.vml"],
        relationships: &["worksheet -> comments", "worksheet -> vmlDrawing"],
        content_types: &["comments", "vmlDrawing"],
        relationship_id_hints: &["worksheet comments r:id", "worksheet VML r:id"],
        dirty_invalidation_triggers: &[
            "legacy comment add/update/delete",
            "comment shape geometry mutation",
        ],
        opaque_policy: "legacy comments and VML notes require typed comment owner state",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::ThreadedComments,
        owner_domain: "threaded comments",
        parts: &[
            "xl/threadedComments/threadedComment*.xml",
            "xl/persons/person.xml",
        ],
        relationships: &["worksheet -> threadedComment", "workbook -> person"],
        content_types: &["threadedComment", "person"],
        relationship_id_hints: &["worksheet threaded comment r:id", "person id"],
        dirty_invalidation_triggers: &[
            "threaded comment add/update/delete",
            "thread author/person mutation",
        ],
        opaque_policy: "threaded comments require typed threaded comment/person state",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::Controls,
        owner_domain: "controls",
        parts: &[
            "xl/ctrlProps/ctrlProp*.xml",
            "xl/activeX/activeX*.xml",
            "xl/activeX/activeX*.bin",
            "worksheet form controls",
        ],
        relationships: &[
            "worksheet -> ctrlProp",
            "worksheet -> control",
            "control -> activeX",
        ],
        content_types: &[
            "control properties",
            "activeX xml",
            "activeX binary default",
        ],
        relationship_id_hints: &["control shape r:id", "control property r:id"],
        dirty_invalidation_triggers: &[
            "form control add/update/delete",
            "control property mutation",
            "ActiveX placeholder mutation",
        ],
        opaque_policy: "form controls require typed control state; ActiveX is diagnosed/dropped",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::PrintSettings,
        owner_domain: "print settings",
        parts: &[
            "xl/printerSettings/printerSettings*.bin",
            "worksheet print/page setup",
        ],
        relationships: &["worksheet -> printerSettings"],
        content_types: &["printerSettings binary default"],
        relationship_id_hints: &["worksheet printer settings r:id"],
        dirty_invalidation_triggers: &[
            "page setup mutation",
            "page margins mutation",
            "print options mutation",
            "header/footer mutation",
            "print area or titles mutation",
            "sheet clone/delete",
        ],
        opaque_policy: "typed print/page setup is regenerated from live state; imported printerSettings binaries are owner-scoped payloads emitted only when the current page-setup fingerprint still matches the imported attachment, otherwise the relationship and binary must be dropped or diagnosed rather than replayed",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::Hyperlinks,
        owner_domain: "hyperlinks",
        parts: &["worksheet <hyperlinks>"],
        relationships: &["worksheet -> hyperlink"],
        content_types: &["none; worksheet relationship target only"],
        relationship_id_hints: &["worksheet hyperlink r:id"],
        dirty_invalidation_triggers: &["hyperlink add/update/delete", "cell address mutation"],
        opaque_policy: "hyperlinks require typed worksheet hyperlink state",
    },
    PackageOwnershipContract {
        owner: PackageFeatureOwner::Media,
        owner_domain: "media",
        parts: &[
            "xl/media/*",
            "xl/embeddings/*",
            "xl/drawings/_rels/drawing*.xml.rels",
        ],
        relationships: &["drawing -> image", "drawing/chart -> package"],
        content_types: &["image defaults", "embedded package defaults"],
        relationship_id_hints: &["drawing media r:id"],
        dirty_invalidation_triggers: &["media payload mutation", "owning drawing object mutation"],
        opaque_policy: "media payloads require a typed drawing/chart/comment/control owner",
    },
];

const ALL_OWNER_POLICY_TESTS: &[XlsxOwnerPolicyRequiredTest] = &[
    XlsxOwnerPolicyRequiredTest::ImportedUnchanged,
    XlsxOwnerPolicyRequiredTest::ImportedEditedStaleProvenance,
    XlsxOwnerPolicyRequiredTest::FreshGeneratedNoProvenance,
    XlsxOwnerPolicyRequiredTest::PackageGraphClosure,
    XlsxOwnerPolicyRequiredTest::Diagnostics,
];

pub const CURRENT_STATE_OWNER_POLICY_TABLE: &[CurrentStateOwnerPolicy] = &[
    CurrentStateOwnerPolicy {
        owner: PackageFeatureOwner::CoreWorkbook,
        owner_id: XlsxPackageOwnerId::WorkbookMetadata,
        package_part_patterns: &[
            "xl/workbook.xml",
            "xl/worksheets/sheet*.xml",
            "xl/styles.xml",
            "xl/theme/*.xml",
            "xl/sharedStrings.xml",
            "xl/metadata.xml",
            "xl/persons/person.xml",
        ],
        relationship_patterns: &[
            "officeDocument",
            "worksheet",
            "styles",
            "theme",
            "sharedStrings",
            "sheetMetadata",
            "person",
        ],
        typed_live_state: "ParseOutput workbook, sheets, styles, theme, calculation, metadata, persons, and current cell text/formula state",
        typed_import_fields: &[
            "workbook/sheet/style/theme/calculation/person fields parsed into ParseOutput",
        ],
        provenance_only_fields: &[
            "original relationship ids",
            "shared string indexes",
            "part paths",
            "relationship order",
            "content type spelling",
        ],
        closure_requirements: &[
            "root officeDocument",
            "workbook-owned modeled parts",
            "content type for each emitted part",
        ],
        mutation_invalidators: &[
            "workbook metadata",
            "sheet list",
            "cell text",
            "formula",
            "style",
            "theme",
            "calculation",
            "person",
        ],
        currentness_validator: "modeled core parts are regenerated from live state; provenance can only supply validated graph identity",
        export_action: XlsxExportAction::TypedRegenerate,
        diagnostic_code: "xlsx.workbook.rewrittenFromLiveState",
        diagnostic_severity: XlsxDiagnosticSeverity::Info,
        diagnostic_reason: XlsxDiagnosticReason::CanonicalFreshExportPolicy,
        continuation: XlsxDiagnosticContinuation::ExportContinued,
        required_tests: ALL_OWNER_POLICY_TESTS,
    },
    CurrentStateOwnerPolicy {
        owner: PackageFeatureOwner::NonEditableSheets,
        owner_id: XlsxPackageOwnerId::UnknownInertPackageData,
        package_part_patterns: &["xl/chartsheets/sheet*.xml", "xl/dialogsheets/sheet*.xml"],
        relationship_patterns: &[
            "workbook -> chartsheet",
            "workbook -> dialogsheet",
            "owned sheet relationships",
        ],
        typed_live_state: "workbook sheet inventory for non-editable sheet entries",
        typed_import_fields: &[
            "sheet name",
            "sheet id",
            "sheet state",
            "workbook relationship binding",
        ],
        provenance_only_fields: &[
            "raw sheet cluster bytes",
            "relationship ids",
            "target spelling",
            "content types",
        ],
        closure_requirements: &[
            "entire non-editable sheet relationship closure must be present and inert",
        ],
        mutation_invalidators: &[
            "sheet add/delete/reorder",
            "sheet name/state/id mutation",
            "owned closure mismatch",
        ],
        currentness_validator: "preserve only unchanged non-editable sheet clusters with closed relationships",
        export_action: XlsxExportAction::PreserveInertArtifact,
        diagnostic_code: "xlsx.unknownInert.preserved",
        diagnostic_severity: XlsxDiagnosticSeverity::Info,
        diagnostic_reason: XlsxDiagnosticReason::CanonicalFreshExportPolicy,
        continuation: XlsxDiagnosticContinuation::ExportContinued,
        required_tests: ALL_OWNER_POLICY_TESTS,
    },
    CurrentStateOwnerPolicy {
        owner: PackageFeatureOwner::WorksheetTables,
        owner_id: XlsxPackageOwnerId::Tables,
        package_part_patterns: &["xl/tables/table*.xml", "xl/tables/tableSingleCells*.xml"],
        relationship_patterns: &["worksheet -> table", "worksheet -> tableSingleCells"],
        typed_live_state: "worksheet table and XML binding state",
        typed_import_fields: &[
            "table definitions",
            "table ranges",
            "table style references",
        ],
        provenance_only_fields: &["table part path", "relationship id", "relationship order"],
        closure_requirements: &[
            "worksheet table references and table content types match emitted table parts",
        ],
        mutation_invalidators: &[
            "table create/update/delete",
            "table range",
            "sheet structure",
            "XML binding",
        ],
        currentness_validator: "table package identity may be reused only for matching current table owners",
        export_action: XlsxExportAction::TypedRegenerate,
        diagnostic_code: "xlsx.worksheet.rewrittenFromLiveState",
        diagnostic_severity: XlsxDiagnosticSeverity::Info,
        diagnostic_reason: XlsxDiagnosticReason::CanonicalFreshExportPolicy,
        continuation: XlsxDiagnosticContinuation::ExportContinued,
        required_tests: ALL_OWNER_POLICY_TESTS,
    },
    CurrentStateOwnerPolicy {
        owner: PackageFeatureOwner::ConnectionsAndQueryTables,
        owner_id: XlsxPackageOwnerId::ExternalLinks,
        package_part_patterns: &["xl/connections.xml", "xl/queryTables/queryTable*.xml"],
        relationship_patterns: &["workbook -> connections", "table -> queryTable"],
        typed_live_state: "workbook connection and query-table state",
        typed_import_fields: &["supported connection/query table fields"],
        provenance_only_fields: &["external target spelling", "relationship id", "part path"],
        closure_requirements: &[
            "connection/query-table parts and external-capable relationships are explicitly owned",
        ],
        mutation_invalidators: &["connection", "query table", "table connection binding"],
        currentness_validator: "external-capable behavior must be typed, diagnosed, or dropped",
        export_action: XlsxExportAction::DiagnosticDrop,
        diagnostic_code: "xlsx.externalLinks.unsupportedDropped",
        diagnostic_severity: XlsxDiagnosticSeverity::Warning,
        diagnostic_reason: XlsxDiagnosticReason::UnsupportedFeature,
        continuation: XlsxDiagnosticContinuation::ExportContinuedWithSemanticChangeWarning,
        required_tests: ALL_OWNER_POLICY_TESTS,
    },
    CurrentStateOwnerPolicy {
        owner: PackageFeatureOwner::OleObjects,
        owner_id: XlsxPackageOwnerId::ActiveContent,
        package_part_patterns: &["xl/embeddings/oleObject*.bin", "xl/embeddings/package*.bin"],
        relationship_patterns: &["worksheet -> oleObject", "worksheet -> embedded package"],
        typed_live_state: "worksheet OLE object state and embedded binary data when modeled",
        typed_import_fields: &["supported OLE object descriptors"],
        provenance_only_fields: &["binary bytes", "relationship id", "preview relationship"],
        closure_requirements: &[
            "OLE object, preview, and binary relationships remain package-closed",
        ],
        mutation_invalidators: &["OLE object", "embedded binary", "worksheet object anchor"],
        currentness_validator: "unsafe or unmodeled OLE behavior is not silently replayed",
        export_action: XlsxExportAction::DiagnosticDrop,
        diagnostic_code: "xlsx.activeContent.blocked",
        diagnostic_severity: XlsxDiagnosticSeverity::Blocked,
        diagnostic_reason: XlsxDiagnosticReason::UnsafeActiveContent,
        continuation: XlsxDiagnosticContinuation::ExportFailed,
        required_tests: ALL_OWNER_POLICY_TESTS,
    },
    CurrentStateOwnerPolicy {
        owner: PackageFeatureOwner::RichData,
        owner_id: XlsxPackageOwnerId::DrawingsMediaCharts,
        package_part_patterns: &["xl/richData/*.xml", "xl/metadata.xml value metadata"],
        relationship_patterns: &["workbook -> richData", "richData -> richValueRel"],
        typed_live_state: "WorkbookMetadata and rich data value references",
        typed_import_fields: &["metadata/richData facts parsed into workbook metadata"],
        provenance_only_fields: &["richData part paths", "relationship ids", "content types"],
        closure_requirements: &[
            "metadata vm references, richData parts, and media relationships are closed",
        ],
        mutation_invalidators: &[
            "rich data value",
            "metadata valueMetadata",
            "cell vm metadata",
        ],
        currentness_validator: "metadata references must still imply each emitted richData package part",
        export_action: XlsxExportAction::TypedWithValidatedProvenance,
        diagnostic_code: "xlsx.drawings.rewrittenFromLiveState",
        diagnostic_severity: XlsxDiagnosticSeverity::Warning,
        diagnostic_reason: XlsxDiagnosticReason::StaleProvenance,
        continuation: XlsxDiagnosticContinuation::ExportContinuedWithSemanticChangeWarning,
        required_tests: ALL_OWNER_POLICY_TESTS,
    },
    CurrentStateOwnerPolicy {
        owner: PackageFeatureOwner::PivotTables,
        owner_id: XlsxPackageOwnerId::Pivots,
        package_part_patterns: &[
            "xl/pivotTables/pivotTable*.xml",
            "xl/pivotCache/pivotCacheDefinition*.xml",
            "xl/pivotCache/pivotCacheRecords*.xml",
        ],
        relationship_patterns: &[
            "worksheet -> pivotTable",
            "workbook -> pivotCacheDefinition",
            "pivotCacheDefinition -> pivotCacheRecords",
        ],
        typed_live_state: "parsed pivot tables, pivot caches, and cache source bindings",
        typed_import_fields: &[
            "pivot table definitions",
            "cache definitions",
            "cache records when persisted",
        ],
        provenance_only_fields: &[
            "pivot package paths",
            "relationship ids",
            "relationship XML order",
        ],
        closure_requirements: &["pivot table/cache definition/cache records closure"],
        mutation_invalidators: &[
            "pivot table",
            "pivot cache",
            "cache source range",
            "source sheet",
        ],
        currentness_validator: "cache identity and source binding must match current pivot state",
        export_action: XlsxExportAction::TypedWithValidatedProvenance,
        diagnostic_code: "xlsx.pivots.staleProvenance",
        diagnostic_severity: XlsxDiagnosticSeverity::Warning,
        diagnostic_reason: XlsxDiagnosticReason::StaleProvenance,
        continuation: XlsxDiagnosticContinuation::ExportContinuedWithSemanticChangeWarning,
        required_tests: ALL_OWNER_POLICY_TESTS,
    },
    CurrentStateOwnerPolicy {
        owner: PackageFeatureOwner::SlicersAndTimelines,
        owner_id: XlsxPackageOwnerId::Pivots,
        package_part_patterns: &[
            "xl/slicers/*.xml",
            "xl/slicerCaches/*.xml",
            "xl/timelines/*.xml",
            "xl/timelineCaches/*.xml",
        ],
        relationship_patterns: &[
            "worksheet -> slicer",
            "workbook -> slicerCache",
            "timeline relationships",
        ],
        typed_live_state: "slicer/timeline workbook data features",
        typed_import_fields: &["supported slicer cache and slicer definitions"],
        provenance_only_fields: &["part paths", "relationship ids", "content types"],
        closure_requirements: &["slicer/timeline references and cache parts are closed"],
        mutation_invalidators: &["slicer", "timeline", "pivot cache binding"],
        currentness_validator: "slicer/timeline package facts must match current data-feature state",
        export_action: XlsxExportAction::TypedWithValidatedProvenance,
        diagnostic_code: "xlsx.pivots.staleProvenance",
        diagnostic_severity: XlsxDiagnosticSeverity::Warning,
        diagnostic_reason: XlsxDiagnosticReason::StaleProvenance,
        continuation: XlsxDiagnosticContinuation::ExportContinuedWithSemanticChangeWarning,
        required_tests: ALL_OWNER_POLICY_TESTS,
    },
    CurrentStateOwnerPolicy {
        owner: PackageFeatureOwner::ChartAuxiliary,
        owner_id: XlsxPackageOwnerId::DrawingsMediaCharts,
        package_part_patterns: &[
            "xl/charts/style*.xml",
            "xl/charts/color*.xml",
            "xl/drawings/userShapeDrawing*.xml",
        ],
        relationship_patterns: &[
            "chart -> style",
            "chart -> colorStyle",
            "chart -> userShape",
        ],
        typed_live_state: "chart and drawing auxiliary state",
        typed_import_fields: &["supported chart auxiliary payloads"],
        provenance_only_fields: &["auxiliary XML bytes", "relationship ids", "part paths"],
        closure_requirements: &["chart auxiliary relationship closure"],
        mutation_invalidators: &["chart", "drawing", "chart auxiliary"],
        currentness_validator: "auxiliary payload can survive only when the owning chart still implies it",
        export_action: XlsxExportAction::TypedWithValidatedProvenance,
        diagnostic_code: "xlsx.drawings.rewrittenFromLiveState",
        diagnostic_severity: XlsxDiagnosticSeverity::Warning,
        diagnostic_reason: XlsxDiagnosticReason::StaleProvenance,
        continuation: XlsxDiagnosticContinuation::ExportContinuedWithSemanticChangeWarning,
        required_tests: ALL_OWNER_POLICY_TESTS,
    },
    CurrentStateOwnerPolicy {
        owner: PackageFeatureOwner::ExternalLinks,
        owner_id: XlsxPackageOwnerId::ExternalLinks,
        package_part_patterns: &[
            "xl/externalLinks/externalLink*.xml",
            "external-link sidecars",
        ],
        relationship_patterns: &["workbook -> externalLink", "externalLink -> external path"],
        typed_live_state: "workbook external link definitions",
        typed_import_fields: &["supported external link definitions"],
        provenance_only_fields: &["external targets", "relationship ids", "target modes"],
        closure_requirements: &["external targets are typed or intentionally removed"],
        mutation_invalidators: &[
            "external link",
            "formula external reference",
            "connection refresh",
        ],
        currentness_validator: "external-capable package content must never be stale-replayed",
        export_action: XlsxExportAction::DiagnosticDrop,
        diagnostic_code: "xlsx.externalLinks.unsupportedDropped",
        diagnostic_severity: XlsxDiagnosticSeverity::Warning,
        diagnostic_reason: XlsxDiagnosticReason::UnsupportedFeature,
        continuation: XlsxDiagnosticContinuation::ExportContinuedWithSemanticChangeWarning,
        required_tests: ALL_OWNER_POLICY_TESTS,
    },
    CurrentStateOwnerPolicy {
        owner: PackageFeatureOwner::DocumentProperties,
        owner_id: XlsxPackageOwnerId::WorkbookMetadata,
        package_part_patterns: &[
            "docProps/core.xml",
            "docProps/app.xml",
            "docProps/custom.xml",
        ],
        relationship_patterns: &[
            "root -> core-properties",
            "root -> extended-properties",
            "root -> custom-properties",
        ],
        typed_live_state: "document properties and extended properties",
        typed_import_fields: &["document property values"],
        provenance_only_fields: &[
            "raw XML bytes for exact current writer match",
            "relationship ids",
            "part paths",
        ],
        closure_requirements: &[
            "root relationship and content type for each emitted property part",
        ],
        mutation_invalidators: &["document property", "sheet list for app properties"],
        currentness_validator: "raw property XML is reusable only when current generated XML matches import-time generated XML",
        export_action: XlsxExportAction::TypedWithValidatedProvenance,
        diagnostic_code: "xlsx.workbook.rewrittenFromLiveState",
        diagnostic_severity: XlsxDiagnosticSeverity::Info,
        diagnostic_reason: XlsxDiagnosticReason::CanonicalFreshExportPolicy,
        continuation: XlsxDiagnosticContinuation::ExportContinued,
        required_tests: ALL_OWNER_POLICY_TESTS,
    },
    CurrentStateOwnerPolicy {
        owner: PackageFeatureOwner::DrawingObjects,
        owner_id: XlsxPackageOwnerId::DrawingsMediaCharts,
        package_part_patterns: &["xl/drawings/drawing*.xml", "xl/charts/chart*.xml"],
        relationship_patterns: &[
            "worksheet -> drawing",
            "drawing -> chart/image",
            "chart auxiliary relationships",
        ],
        typed_live_state: "worksheet drawings, charts, media references, anchors, and current objects",
        typed_import_fields: &["supported drawings/charts/media facts"],
        provenance_only_fields: &[
            "paths",
            "rIds",
            "relationship order",
            "unsupported raw auxiliary payloads",
        ],
        closure_requirements: &[
            "worksheet drawing, drawing rels, chart/media parts, and content types are closed",
        ],
        mutation_invalidators: &["drawing", "chart", "media", "object anchor"],
        currentness_validator: "drawing package identity is reused only for matching current drawing object graph",
        export_action: XlsxExportAction::TypedWithValidatedProvenance,
        diagnostic_code: "xlsx.drawings.rewrittenFromLiveState",
        diagnostic_severity: XlsxDiagnosticSeverity::Warning,
        diagnostic_reason: XlsxDiagnosticReason::StaleProvenance,
        continuation: XlsxDiagnosticContinuation::ExportContinuedWithSemanticChangeWarning,
        required_tests: ALL_OWNER_POLICY_TESTS,
    },
    CurrentStateOwnerPolicy {
        owner: PackageFeatureOwner::Comments,
        owner_id: XlsxPackageOwnerId::CommentsVml,
        package_part_patterns: &["xl/comments*.xml", "xl/drawings/vmlDrawing*.vml"],
        relationship_patterns: &[
            "worksheet -> comments",
            "worksheet -> vmlDrawing",
            "vmlDrawing sidecars",
        ],
        typed_live_state: "worksheet comments, note anchors, and VML comment package identity",
        typed_import_fields: &[
            "comments",
            "comment authors",
            "VML note anchors where supported",
        ],
        provenance_only_fields: &["comments/VML paths", "relationship ids", "safe extLst XML"],
        closure_requirements: &[
            "worksheet comments/VML relationships and sidecar relationships are closed",
        ],
        mutation_invalidators: &["comment", "note anchor", "worksheet object"],
        currentness_validator: "comments and VML are regenerated from current comments; bounded extensions require relationship-free validation",
        export_action: XlsxExportAction::TypedRegenerate,
        diagnostic_code: "xlsx.comments.rewrittenFromLiveState",
        diagnostic_severity: XlsxDiagnosticSeverity::Info,
        diagnostic_reason: XlsxDiagnosticReason::CanonicalFreshExportPolicy,
        continuation: XlsxDiagnosticContinuation::ExportContinued,
        required_tests: ALL_OWNER_POLICY_TESTS,
    },
    CurrentStateOwnerPolicy {
        owner: PackageFeatureOwner::ThreadedComments,
        owner_id: XlsxPackageOwnerId::PersonsThreadedComments,
        package_part_patterns: &[
            "xl/threadedComments/threadedComment*.xml",
            "xl/persons/person.xml",
        ],
        relationship_patterns: &["worksheet -> threadedComment", "workbook -> person"],
        typed_live_state: "persons and threaded comments",
        typed_import_fields: &["persons", "threaded comments"],
        provenance_only_fields: &[
            "part paths",
            "relationship ids",
            "empty person part presence",
        ],
        closure_requirements: &["person/threaded comment references are closed"],
        mutation_invalidators: &["person", "threaded comment", "comment/person binding"],
        currentness_validator: "person and threaded comment package identity must match current modeled state",
        export_action: XlsxExportAction::TypedRegenerate,
        diagnostic_code: "xlsx.comments.rewrittenFromLiveState",
        diagnostic_severity: XlsxDiagnosticSeverity::Info,
        diagnostic_reason: XlsxDiagnosticReason::CanonicalFreshExportPolicy,
        continuation: XlsxDiagnosticContinuation::ExportContinued,
        required_tests: ALL_OWNER_POLICY_TESTS,
    },
    CurrentStateOwnerPolicy {
        owner: PackageFeatureOwner::Controls,
        owner_id: XlsxPackageOwnerId::ActiveContent,
        package_part_patterns: &["xl/ctrlProps/ctrlProp*.xml", "xl/activeX/*"],
        relationship_patterns: &[
            "worksheet -> ctrlProp",
            "worksheet -> activeX",
            "activeX binary",
        ],
        typed_live_state: "form controls and disabled active-control diagnostics",
        typed_import_fields: &["supported form control descriptors"],
        provenance_only_fields: &[
            "ActiveX bytes",
            "relationship ids",
            "control property paths",
        ],
        closure_requirements: &[
            "control properties are closed; executable ActiveX is blocked or removed consistently",
        ],
        mutation_invalidators: &["control", "ActiveX payload", "worksheet object anchor"],
        currentness_validator: "active controls must be disabled, dropped, or blocked by policy",
        export_action: XlsxExportAction::BlockedExport,
        diagnostic_code: "xlsx.activeContent.blocked",
        diagnostic_severity: XlsxDiagnosticSeverity::Blocked,
        diagnostic_reason: XlsxDiagnosticReason::UnsafeActiveContent,
        continuation: XlsxDiagnosticContinuation::ExportFailed,
        required_tests: ALL_OWNER_POLICY_TESTS,
    },
    CurrentStateOwnerPolicy {
        owner: PackageFeatureOwner::PrintSettings,
        owner_id: XlsxPackageOwnerId::PrinterSettings,
        package_part_patterns: &["xl/printerSettings/printerSettings*.bin"],
        relationship_patterns: &["worksheet -> printerSettings"],
        typed_live_state: "worksheet page setup and print settings fingerprint",
        typed_import_fields: &["page setup fields"],
        provenance_only_fields: &["printer settings binary", "relationship id", "part path"],
        closure_requirements: &[
            "worksheet r:id, binary part, and content type are emitted or removed together",
        ],
        mutation_invalidators: &[
            "page setup",
            "print options",
            "printer settings relationship",
        ],
        currentness_validator: "binary is inert only while page setup fingerprint and relationship closure validate",
        export_action: XlsxExportAction::PreserveInertArtifact,
        diagnostic_code: "xlsx.printerSettings.staleProvenance",
        diagnostic_severity: XlsxDiagnosticSeverity::Warning,
        diagnostic_reason: XlsxDiagnosticReason::StaleProvenance,
        continuation: XlsxDiagnosticContinuation::ExportContinuedWithSemanticChangeWarning,
        required_tests: ALL_OWNER_POLICY_TESTS,
    },
    CurrentStateOwnerPolicy {
        owner: PackageFeatureOwner::Hyperlinks,
        owner_id: XlsxPackageOwnerId::Hyperlinks,
        package_part_patterns: &["worksheet hyperlink XML refs"],
        relationship_patterns: &["worksheet -> hyperlink"],
        typed_live_state: "worksheet hyperlink state",
        typed_import_fields: &["hyperlink targets and display text"],
        provenance_only_fields: &["relationship id", "target spelling", "target mode"],
        closure_requirements: &["worksheet XML hyperlink refs match emitted relationships"],
        mutation_invalidators: &["hyperlink", "cell text when hyperlink-owned"],
        currentness_validator: "hyperlink rIds are reused only for matching current hyperlink targets",
        export_action: XlsxExportAction::TypedRegenerate,
        diagnostic_code: "xlsx.worksheet.rewrittenFromLiveState",
        diagnostic_severity: XlsxDiagnosticSeverity::Info,
        diagnostic_reason: XlsxDiagnosticReason::CanonicalFreshExportPolicy,
        continuation: XlsxDiagnosticContinuation::ExportContinued,
        required_tests: ALL_OWNER_POLICY_TESTS,
    },
    CurrentStateOwnerPolicy {
        owner: PackageFeatureOwner::Media,
        owner_id: XlsxPackageOwnerId::DrawingsMediaCharts,
        package_part_patterns: &["xl/media/*"],
        relationship_patterns: &["drawing/chart/VML/richData -> image"],
        typed_live_state: "media blobs referenced by current drawings, charts, VML, or richData",
        typed_import_fields: &["supported image blobs and references"],
        provenance_only_fields: &["media path", "content type", "relationship id"],
        closure_requirements: &["each media part has a current typed owner relationship"],
        mutation_invalidators: &["media blob", "drawing", "chart", "VML", "richData"],
        currentness_validator: "media is emitted only when referenced by current owner state",
        export_action: XlsxExportAction::TypedWithValidatedProvenance,
        diagnostic_code: "xlsx.drawings.rewrittenFromLiveState",
        diagnostic_severity: XlsxDiagnosticSeverity::Warning,
        diagnostic_reason: XlsxDiagnosticReason::StaleProvenance,
        continuation: XlsxDiagnosticContinuation::ExportContinuedWithSemanticChangeWarning,
        required_tests: ALL_OWNER_POLICY_TESTS,
    },
];

pub const ROUND_9_OOXML_OWNERSHIP_MATRIX: &[OoxmlOwnershipRow] = &[
    OoxmlOwnershipRow {
        surface: "workbook package, root MCE compatibility attributes, sheets, defined names, calc settings, protection, custom views",
        package_part_patterns: &[
            "xl/workbook.xml",
            "xl/worksheets/sheet*.xml",
            "xl/chartsheets/sheet*.xml",
            "xl/dialogsheets/sheet*.xml",
        ],
        ooxml_modules: &[
            "workbook",
            "worksheet",
            "chartsheet",
            "calc_chain",
            "custom_views",
        ],
        canonical_type_status: CanonicalTypeStatus::NeedsCorrection,
        classification: OoxmlOwnershipClassification::TypedEditable,
        production_reader: "domain::workbook::read; domain::worksheet::read; pipeline::full_parse",
        private_parser_adapter: "WorkbookMetadata, SheetData, namespace/MCE root sidecars, worksheet fast scanners",
        full_parse_result_field: "workbook, sheets, calc_chain",
        parse_output_domain_owner: "ParseOutput workbook metadata, sheets, workbook properties, root namespace/MCE metadata",
        yrs_app_persistence_owner: "workbook/sheet app state; calc-chain intentionally not persisted",
        api_exposure: ApiExposureLevel::Editable,
        production_writer: "write::from_parse_output workbook/sheet writers",
        package_feature_owner: Some(PackageFeatureOwner::CoreWorkbook),
        auxiliary_policy: Some(AuxiliaryPackagePartPolicy::UnsupportedNeedsModel),
        opaque_package_policy: OpaquePackagePolicy::None,
        unsupported_diagnostic_policy: "unsupported MustUnderstand/AlternateContent branches are diagnosed at the MCE resolver; chartsheets/dialogsheets and calcChain gaps use unsupported-needs-model or intentional-recalculation-drop diagnostics",
        dirty_invalidation_triggers: &[
            "sheet add/delete/reorder",
            "workbook property mutation",
            "formula/calc setting mutation",
        ],
        semantic_references: &[
            "workbook r:id",
            "sheetId",
            "sheet owner path",
            "localSheetId",
            "external reference ordinals",
            "mc namespace prefixes",
        ],
        user_visible_behavior: "sheet identity/order/visibility, formulas, workbook-level settings",
        fixture_coverage: "round-9 matrix contract only; feature gates owned by plans 01/02",
    },
    OoxmlOwnershipRow {
        surface: "worksheet core address-bearing features, validations, filters, print, protection, custom views, ignored errors, sheetCalcPr, protected ranges, scenarios, data consolidation, phonetic props, smart tags, cell watches",
        package_part_patterns: &["xl/worksheets/sheet*.xml"],
        ooxml_modules: &[
            "cell_watches",
            "cond_format",
            "print",
            "protection",
            "sparklines",
            "validation",
            "worksheet",
        ],
        canonical_type_status: CanonicalTypeStatus::NeedsCorrection,
        classification: OoxmlOwnershipClassification::TypedEditable,
        production_reader: "domain::worksheet, domain::validation, domain::cond_format, domain::print, domain::protection, domain::sparklines",
        private_parser_adapter: "SheetData semantic containers, parser-local rule structs, and child-level x14 worksheet extension merge",
        full_parse_result_field: "sheets[*]",
        parse_output_domain_owner: "SheetData and worksheet semantic containers",
        yrs_app_persistence_owner: "sheet/cell app state where modeled; diagnostics for gaps",
        api_exposure: ApiExposureLevel::Editable,
        production_writer: "write::sheet and domain worksheet feature writers",
        package_feature_owner: Some(PackageFeatureOwner::CoreWorkbook),
        auxiliary_policy: None,
        opaque_package_policy: OpaquePackagePolicy::DiagnosticDrop,
        unsupported_diagnostic_policy: "typed-owned-partial for partial worksheet models; unsupported-needs-model-dropped for unmodeled active containers",
        dirty_invalidation_triggers: &[
            "cell/range mutation",
            "row/column mutation",
            "worksheet option mutation",
            "conditional format/data validation rule or threshold mutation",
        ],
        semantic_references: &[
            "cell/range refs",
            "dxf ids",
            "table ids",
            "metadata cm/vm",
            "x14 data validation and conditional formatting extension children",
        ],
        user_visible_behavior: "worksheet layout, filtering, validation, print, protection, and visible cell semantics",
        fixture_coverage: "plan 02 typed slice covers sheetFormatPr thickTop/thickBottom, row/cell ph, t=d lexical cells, and sheetView pivotSelection; broader gates still owned by plan 02",
    },
    OoxmlOwnershipRow {
        surface: "styles, shared strings, rich text, and theme registries",
        package_part_patterns: &[
            "xl/styles.xml",
            "xl/sharedStrings.xml",
            "xl/theme/theme*.xml",
        ],
        ooxml_modules: &["shared", "shared_strings", "styles", "themes"],
        canonical_type_status: CanonicalTypeStatus::NeedsCorrection,
        classification: OoxmlOwnershipClassification::TypedEditable,
        production_reader: "domain::styles, domain::strings, domain::rich_text, domain::themes",
        private_parser_adapter: "style/string/theme parser structs",
        full_parse_result_field: "styles, shared_strings, theme",
        parse_output_domain_owner: "ParseOutput style registry, strings, theme",
        yrs_app_persistence_owner: "cell/style/theme app state",
        api_exposure: ApiExposureLevel::Editable,
        production_writer: "domain::styles::write, domain::strings::write, theme writer",
        package_feature_owner: Some(PackageFeatureOwner::CoreWorkbook),
        auxiliary_policy: None,
        opaque_package_policy: OpaquePackagePolicy::None,
        unsupported_diagnostic_policy: "typed-owned-partial for unsupported style/theme/rich-text children",
        dirty_invalidation_triggers: &[
            "cell style mutation",
            "style registry mutation",
            "shared string mutation",
            "theme mutation",
        ],
        semantic_references: &[
            "style ids",
            "dxf ids",
            "shared string ids",
            "theme color/font refs",
        ],
        user_visible_behavior: "rendered values, rich text, and style identity",
        fixture_coverage: "round-9 matrix contract only; feature gates owned by plan 03",
    },
    OoxmlOwnershipRow {
        surface: "cell, row, column, trailing-column, and authored-run style references",
        package_part_patterns: &[
            "xl/styles.xml cellXfs",
            "xl/worksheets/sheet*.xml style attrs",
        ],
        ooxml_modules: &["styles", "worksheet"],
        canonical_type_status: CanonicalTypeStatus::ProductionReady,
        classification: OoxmlOwnershipClassification::TypedEditable,
        production_reader: "worksheet/style readers lower style references into SheetData style_id",
        private_parser_adapter: "StyleExportRemapper",
        full_parse_result_field: "sheets[*].cells/row_styles/col_styles/dimensions/authored_style_runs",
        parse_output_domain_owner: "SheetData style references plus ParseOutput.workbook_stylesheet/style_palette",
        yrs_app_persistence_owner: "cell, row, column, dimension, and range style state",
        api_exposure: ApiExposureLevel::Editable,
        production_writer: "write::from_parse_output::style_remap + sheet_builder",
        package_feature_owner: Some(PackageFeatureOwner::CoreWorkbook),
        auxiliary_policy: None,
        opaque_package_policy: OpaquePackagePolicy::None,
        unsupported_diagnostic_policy: "missing current style IDs are omitted instead of emitting invalid cellXfs references",
        dirty_invalidation_triggers: &[
            "cell style mutation",
            "row style mutation",
            "column style mutation",
            "range style mutation",
            "style registry mutation",
        ],
        semantic_references: &[
            "workbook cell style id",
            "style palette projection id",
            "emitted cellXfs id",
        ],
        user_visible_behavior: "visible cell, row, column, and range formatting",
        fixture_coverage: "write::from_parse_output::tests::styles workbook_stylesheet_style_ids_emit_without_palette_offset",
    },
    OoxmlOwnershipRow {
        surface: "tables, query tables, connections, and auto-filter data bindings",
        package_part_patterns: &[
            "xl/tables/table*.xml",
            "xl/tables/tableSingleCells*.xml",
            "xl/queryTables/queryTable*.xml",
            "xl/connections.xml",
        ],
        ooxml_modules: &["connections", "tables"],
        canonical_type_status: CanonicalTypeStatus::NeedsCorrection,
        classification: OoxmlOwnershipClassification::TypedViewOnly,
        production_reader: "domain::tables, domain::connections",
        private_parser_adapter: "table and connection parser structs",
        full_parse_result_field: "tables, connections",
        parse_output_domain_owner: "WorkbookDataFeatures tables/connections/queryTables projection; compatibility fields SheetData.tables and ParseOutput.connections",
        yrs_app_persistence_owner: "table Yrs state plus workbookConnections registry; unreferenced connections survive export",
        api_exposure: ApiExposureLevel::ReadOnly,
        production_writer: "domain::tables::write; connection writer when modeled",
        package_feature_owner: Some(PackageFeatureOwner::ConnectionsAndQueryTables),
        auxiliary_policy: Some(AuxiliaryPackagePartPolicy::TypedOwned),
        opaque_package_policy: OpaquePackagePolicy::None,
        unsupported_diagnostic_policy: "unsupported-external-capable-dropped for refresh/external-capable connection behavior",
        dirty_invalidation_triggers: &[
            "table mutation",
            "connection mutation",
            "query table binding mutation",
        ],
        semantic_references: &["table id/name", "connection id", "queryTable r:id"],
        user_visible_behavior: "table ranges, filters, and XML/external data binding metadata",
        fixture_coverage: "WorkbookDataFeatures projection contract; L2 export no longer filters unreferenced connections",
    },
    OoxmlOwnershipRow {
        surface: "drawings, drawing references, charts, ChartEx, media, and chart auxiliaries",
        package_part_patterns: &[
            "xl/drawings/drawing*.xml",
            "xl/drawings/_rels/drawing*.xml.rels",
            "xl/charts/chart*.xml",
            "xl/charts/chartEx*.xml",
            "xl/charts/style*.xml",
            "xl/charts/colors*.xml",
            "xl/chartsheets/sheet*.xml",
            "xl/media/*",
        ],
        ooxml_modules: &["chart_ex", "charts", "drawing_refs", "drawings"],
        canonical_type_status: CanonicalTypeStatus::NeedsCorrection,
        classification: OoxmlOwnershipClassification::TypedViewOnly,
        production_reader: "domain::drawings, domain::charts",
        private_parser_adapter: "drawing facts, chart model, image payload adapters",
        full_parse_result_field: "drawings, charts, media",
        parse_output_domain_owner: "SheetData drawing objects and chart/image state",
        yrs_app_persistence_owner: "drawing/chart app state where modeled",
        api_exposure: ApiExposureLevel::ReadOnly,
        production_writer: "drawing/chart writers and package graph",
        package_feature_owner: Some(PackageFeatureOwner::DrawingObjects),
        auxiliary_policy: None,
        opaque_package_policy: OpaquePackagePolicy::None,
        unsupported_diagnostic_policy: "typed-owned-partial for unsupported chart/drawing children; opaque ChartEx replay is unmodified-import preservation only; unsupported-needs-model for chartsheets until plan 01",
        dirty_invalidation_triggers: &[
            "drawing object mutation",
            "chart mutation",
            "image/media mutation",
        ],
        semantic_references: &["drawing r:id", "chart r:id", "anchor refs", "media target"],
        user_visible_behavior: "visible drawing objects, charts, and images",
        fixture_coverage: "round-9 matrix contract only; feature gates owned by plan 04",
    },
    OoxmlOwnershipRow {
        surface: "comments, threaded comments, persons, VML notes, controls, ActiveX, and OLE",
        package_part_patterns: &[
            "xl/comments*.xml",
            "xl/threadedComments/threadedComment*.xml",
            "xl/persons/person.xml",
            "xl/drawings/vmlDrawing*.vml",
            "xl/ctrlProps/ctrlProp*.xml",
            "xl/activeX/*",
            "xl/embeddings/oleObject*.bin",
        ],
        ooxml_modules: &["comments", "controls", "ole"],
        canonical_type_status: CanonicalTypeStatus::NeedsCorrection,
        classification: OoxmlOwnershipClassification::TypedViewOnly,
        production_reader: "domain::comments, domain::controls",
        private_parser_adapter: "comment/control/OLE parser structs",
        full_parse_result_field: "comments, controls, ole_objects",
        parse_output_domain_owner: "SheetData comments, threaded comments, controls, OLE placeholders",
        yrs_app_persistence_owner: "comment/control state where modeled",
        api_exposure: ApiExposureLevel::ReadOnly,
        production_writer: "domain comment/control/OLE writers",
        package_feature_owner: Some(PackageFeatureOwner::Comments),
        auxiliary_policy: Some(AuxiliaryPackagePartPolicy::ActiveForbidden),
        opaque_package_policy: OpaquePackagePolicy::DiagnosticDrop,
        unsupported_diagnostic_policy: "unsupported-active-dropped for ActiveX/executable controls; typed-owned-partial for comments/OLE gaps",
        dirty_invalidation_triggers: &[
            "comment mutation",
            "control mutation",
            "OLE placeholder mutation",
        ],
        semantic_references: &[
            "comment ref",
            "thread/person id",
            "VML shape id",
            "control r:id",
            "OLE r:id",
        ],
        user_visible_behavior: "notes, threaded comments, form controls, OLE placeholders",
        fixture_coverage: "round-9 matrix contract only; feature gates owned by plan 04",
    },
    OoxmlOwnershipRow {
        surface: "worksheet form controls and VML control shapes",
        package_part_patterns: &[
            "xl/ctrlProps/ctrlProp*.xml",
            "xl/drawings/vmlDrawing*.vml",
            "worksheet <controls>",
        ],
        ooxml_modules: &["controls", "drawings"],
        canonical_type_status: CanonicalTypeStatus::ProductionReady,
        classification: OoxmlOwnershipClassification::TypedViewOnly,
        production_reader: "domain::controls::worksheet, domain::controls::form_control_props, domain::controls::vml",
        private_parser_adapter: "FormControlOutput -> FloatingObjectData::FormControl",
        full_parse_result_field: "sheets[*].form_controls",
        parse_output_domain_owner: "SheetData.floating_objects FormControl",
        yrs_app_persistence_owner: "floating object app state",
        api_exposure: ApiExposureLevel::ReadOnly,
        production_writer: "write::from_parse_output::form_controls and controls/VML writers",
        package_feature_owner: Some(PackageFeatureOwner::Controls),
        auxiliary_policy: Some(AuxiliaryPackagePartPolicy::TypedOwned),
        opaque_package_policy: OpaquePackagePolicy::None,
        unsupported_diagnostic_policy: "macro-bearing controls use security-disabled diagnostics; imported controls are preserved as non-editable typed objects",
        dirty_invalidation_triggers: &[
            "form control add/update/delete",
            "control property mutation",
            "VML control shape mutation",
        ],
        semantic_references: &[
            "worksheet control shapeId",
            "worksheet control r:id",
            "ctrlProp part path",
            "VML shape id",
            "linked cell/range formulas",
        ],
        user_visible_behavior: "visible form control placeholder, linked-cell metadata, and disabled macro assignment",
        fixture_coverage: "domain::controls tests cover worksheet controls, VML controls, props, and writer roundtrip",
    },
    OoxmlOwnershipRow {
        surface: "embedded OLE, linked-only OLE, and OLE preview media",
        package_part_patterns: &[
            "xl/embeddings/oleObject*.bin",
            "xl/embeddings/package*.bin",
            "worksheet <oleObjects>",
            "xl/media/*",
            "xl/drawings/vmlDrawing*.vml",
        ],
        ooxml_modules: &["ole", "drawings"],
        canonical_type_status: CanonicalTypeStatus::ProductionReady,
        classification: OoxmlOwnershipClassification::SafeInert,
        production_reader: "domain::controls::ole and VML preview relationship scanner",
        private_parser_adapter: "OleObjectOutput -> FloatingObjectData::OleObject",
        full_parse_result_field: "sheets[*].ole_objects",
        parse_output_domain_owner: "SheetData.floating_objects OleObject",
        yrs_app_persistence_owner: "floating object app state",
        api_exposure: ApiExposureLevel::ReadOnly,
        production_writer: "write::from_parse_output::ole_objects and OLE/VML writers",
        package_feature_owner: Some(PackageFeatureOwner::OleObjects),
        auxiliary_policy: Some(AuxiliaryPackagePartPolicy::InertOpaqueAuxiliary),
        opaque_package_policy: OpaquePackagePolicy::OwnerScopedInert,
        unsupported_diagnostic_policy: "linked OLE uses security-disabled diagnostics; missing embedded bytes use missing-part diagnostics",
        dirty_invalidation_triggers: &[
            "OLE object add/delete/update",
            "embedded binary mutation",
            "preview media mutation",
        ],
        semantic_references: &[
            "worksheet OLE r:id",
            "objectPr anchor",
            "shapeId",
            "embedded binary path",
            "linked target",
            "preview media r:id",
        ],
        user_visible_behavior: "disabled OLE placeholder with preview image when available and link/embed identity",
        fixture_coverage: "domain::controls OLE parser/writer tests and package graph ownership gates",
    },
    OoxmlOwnershipRow {
        surface: "ActiveX controls and persistence payloads",
        package_part_patterns: &[
            "xl/activeX/activeX*.xml",
            "xl/activeX/activeX*.bin",
            "worksheet ActiveX control refs",
        ],
        ooxml_modules: &["controls"],
        canonical_type_status: CanonicalTypeStatus::InventoryOnly,
        classification: OoxmlOwnershipClassification::UnsupportedActive,
        production_reader: "domain::controls::active_x scanner where reachable",
        private_parser_adapter: "ActiveXControl parser struct",
        full_parse_result_field: "diagnostics / controls inventory",
        parse_output_domain_owner: "diagnostics only until disabled placeholders are persisted",
        yrs_app_persistence_owner: "diagnostic-only",
        api_exposure: ApiExposureLevel::DiagnosticOnly,
        production_writer: "diagnostic/drop; never emits enabled ActiveX",
        package_feature_owner: Some(PackageFeatureOwner::Controls),
        auxiliary_policy: Some(AuxiliaryPackagePartPolicy::ActiveForbidden),
        opaque_package_policy: OpaquePackagePolicy::DiagnosticDrop,
        unsupported_diagnostic_policy: "security-disabled-active-content diagnostic with package part and relationship fingerprints",
        dirty_invalidation_triggers: &[
            "ActiveX XML detected",
            "ActiveX binary detected",
            "control persistence relationship detected",
        ],
        semantic_references: &[
            "class id",
            "persistence r:id",
            "ActiveX XML path",
            "ActiveX binary path",
        ],
        user_visible_behavior: "diagnostic-only disabled active content",
        fixture_coverage: "domain::controls active_x parser tests; production placeholder persistence pending",
    },
    OoxmlOwnershipRow {
        surface: "pivot tables, pivot caches, slicers, timelines, metadata, rich data, and MDX/cube adjuncts",
        package_part_patterns: &[
            "xl/pivotTables/pivotTable*.xml",
            "xl/pivotCache/pivotCacheDefinition*.xml",
            "xl/pivotCache/pivotCacheRecords*.xml",
            "xl/slicers/slicer*.xml",
            "xl/slicerCaches/slicerCache*.xml",
            "xl/timelines/timeline*.xml",
            "xl/timelineCaches/timelineCache*.xml",
            "xl/metadata.xml",
            "xl/richData/*",
            "xl/model/*",
        ],
        ooxml_modules: &["mdx", "metadata", "pivot", "slicers", "timelines"],
        canonical_type_status: CanonicalTypeStatus::NeedsCorrection,
        classification: OoxmlOwnershipClassification::TypedViewOnly,
        production_reader: "domain::pivot, domain::slicers, domain::metadata",
        private_parser_adapter: "pivot/cache/slicer/metadata parser structs",
        full_parse_result_field: "pivot_tables, slicers, metadata, rich_data",
        parse_output_domain_owner: "WorkbookDataFeatures pivot/slicer/timeline/metadata projection; compatibility fields ParseOutput.pivot_tables, pivot_cache_records, slicer_caches, metadata and SheetData.slicers; WorkbookMetadata owns imported metadata.xml provenance and richData cluster facts",
        yrs_app_persistence_owner: "pivot/slicer/metadata state where modeled; WorkbookMetadata JSON persists metadata.xml provenance and richData package facts; WorkbookDataFeatures projection rebuilt on export",
        api_exposure: ApiExposureLevel::ReadOnly,
        production_writer: "pivot/slicer/metadata writers with owner-scoped richData package emission",
        package_feature_owner: Some(PackageFeatureOwner::PivotTables),
        auxiliary_policy: Some(AuxiliaryPackagePartPolicy::DiagnosticsOnly),
        opaque_package_policy: OpaquePackagePolicy::DiagnosticDrop,
        unsupported_diagnostic_policy: "unsupported-needs-model-dropped for stale metadata/richData, timelines/data-model/cube gaps until their owners model them",
        dirty_invalidation_triggers: &[
            "pivot mutation",
            "pivot source mutation",
            "slicer/timeline binding mutation",
            "metadata cm/vm mutation",
        ],
        semantic_references: &[
            "pivot cache id",
            "slicer cache id",
            "timeline cache id",
            "cm/vm index",
        ],
        user_visible_behavior: "pivot output, slicers/timelines, rich data display and metadata bindings",
        fixture_coverage: "WorkbookDataFeatures projection contract; feature gates still owned by plan 05 follow-up slices",
    },
    OoxmlOwnershipRow {
        surface: "workbook external links and external-reference ordinal model",
        package_part_patterns: &["xl/externalLinks/externalLink*.xml"],
        ooxml_modules: &["external_links"],
        canonical_type_status: CanonicalTypeStatus::NeedsCorrection,
        classification: OoxmlOwnershipClassification::TypedViewOnly,
        production_reader: "domain::external",
        private_parser_adapter: "external link parser structs and workbook externalReference order",
        full_parse_result_field: "external_links",
        parse_output_domain_owner: "WorkbookDataFeatures externalLinks projection; compatibility field ParseOutput.external_links",
        yrs_app_persistence_owner: "workbook links registry plus imported external cache records",
        api_exposure: ApiExposureLevel::ReadOnly,
        production_writer: "write::from_parse_output external_links writer",
        package_feature_owner: Some(PackageFeatureOwner::ExternalLinks),
        auxiliary_policy: Some(AuxiliaryPackagePartPolicy::ExternalCapable),
        opaque_package_policy: OpaquePackagePolicy::DiagnosticDrop,
        unsupported_diagnostic_policy: "orphan external links and unsupported DDE/OLE refresh behaviors are diagnosed; stale opaque externalLink parts are rejected",
        dirty_invalidation_triggers: &[
            "external link add/update/delete",
            "external link reorder",
            "defined name/formula external reference mutation",
        ],
        semantic_references: &[
            "Excel external reference ordinal",
            "workbook externalReference r:id",
            "externalLink owned path r:id",
            "external cached sheet/name data",
        ],
        user_visible_behavior: "external workbook/DDE/OLE link metadata and formula ordinal bindings",
        fixture_coverage: "WorkbookDataFeatures projection contract; workbook-link cache persistence owned by compute import/export",
    },
    OoxmlOwnershipRow {
        surface: "document properties, labels, custom XML payloads, XML maps, and custom XML bindings",
        package_part_patterns: &[
            "docProps/core.xml",
            "docProps/app.xml",
            "docProps/custom.xml",
            "docMetadata/LabelInfo.xml",
            "customXml/*",
            "xl/xmlMaps.xml",
        ],
        ooxml_modules: &["doc_props", "xml_map"],
        canonical_type_status: CanonicalTypeStatus::NeedsCorrection,
        classification: OoxmlOwnershipClassification::InventoryOnly,
        production_reader: "domain::metadata and package graph inventory",
        private_parser_adapter: "doc prop readers; customXml package inventory",
        full_parse_result_field: "metadata/document properties",
        parse_output_domain_owner: "document metadata and package diagnostics",
        yrs_app_persistence_owner: "document metadata where exposed; custom XML binding pending plan 05",
        api_exposure: ApiExposureLevel::ReadOnly,
        production_writer: "domain::metadata::write and package graph",
        package_feature_owner: Some(PackageFeatureOwner::DocumentProperties),
        auxiliary_policy: Some(AuxiliaryPackagePartPolicy::InertOpaqueAuxiliary),
        opaque_package_policy: OpaquePackagePolicy::OwnerScopedInert,
        unsupported_diagnostic_policy: "inert-opaque-preserved for vetted inert custom XML/XML map package parts; unsupported-needs-model for editable XML-map bindings",
        dirty_invalidation_triggers: &[
            "document property mutation",
            "custom XML binding mutation",
            "sensitivity label mutation",
        ],
        semantic_references: &[
            "custom property pid",
            "XML map id",
            "custom XML relationship target",
        ],
        user_visible_behavior: "document metadata and XML-bound data semantics",
        fixture_coverage: "round-9 matrix contract only; feature gates owned by plans 01/05",
    },
    OoxmlOwnershipRow {
        surface: "external links, web publishing, VBA/macros, revisions, and smart tags",
        package_part_patterns: &[
            "xl/externalLinks/externalLink*.xml",
            "xl/vbaProject.bin",
            "xl/revisions/*",
            "xl/smartTags.xml",
        ],
        ooxml_modules: &[
            "external_links",
            "revisions",
            "smart_tags",
            "volatile",
            "web_publish",
        ],
        canonical_type_status: CanonicalTypeStatus::InventoryOnly,
        classification: OoxmlOwnershipClassification::UnsupportedActive,
        production_reader: "domain::external, domain::vba, domain::web_extensions, package inventory",
        private_parser_adapter: "external link/VBA/web extension scanners",
        full_parse_result_field: "external_links, vba, web_extensions, unsupported package diagnostics",
        parse_output_domain_owner: "diagnostics and external reference metadata where modeled",
        yrs_app_persistence_owner: "diagnostic-only unless a future plan adds typed state",
        api_exposure: ApiExposureLevel::DiagnosticOnly,
        production_writer: "VBA project quarantine-preserve; external links only when typed owner is available; unsupported active adjuncts diagnostic/drop",
        package_feature_owner: Some(PackageFeatureOwner::ExternalLinks),
        auxiliary_policy: Some(AuxiliaryPackagePartPolicy::ActiveQuarantined),
        opaque_package_policy: OpaquePackagePolicy::DiagnosticDrop,
        unsupported_diagnostic_policy: "VBA is preserved as quarantined active content with package closure and no interpretation/execution; other unsupported active or external-capable adjuncts are diagnosed/dropped; shared-workbook revisions are diagnostics-only unless a typed revision model owns invalidation",
        dirty_invalidation_triggers: &[
            "external reference mutation",
            "macro/security content detected",
            "web extension detected",
        ],
        semantic_references: &[
            "external link ordinal",
            "external relationship target",
            "revision id",
        ],
        user_visible_behavior: "external workbook bindings, revision history, executable or refresh-capable content",
        fixture_coverage: "round-9 matrix contract only; feature gates owned by plan 05/security slices",
    },
    OoxmlOwnershipRow {
        surface: "Office web extension taskpane package cluster",
        package_part_patterns: &["xl/webextensions/*"],
        ooxml_modules: &[],
        canonical_type_status: CanonicalTypeStatus::InventoryOnly,
        classification: OoxmlOwnershipClassification::SafeInert,
        production_reader: "domain::web_extensions and package inventory",
        private_parser_adapter: "web extension scanner",
        full_parse_result_field: "web_extensions imported extension parts",
        parse_output_domain_owner: "package fidelity opaque parts",
        yrs_app_persistence_owner: "package fidelity metadata",
        api_exposure: ApiExposureLevel::DiagnosticOnly,
        production_writer: "package graph opaque replay for the closed webextensions cluster",
        package_feature_owner: Some(PackageFeatureOwner::ExternalLinks),
        auxiliary_policy: Some(AuxiliaryPackagePartPolicy::InertOpaqueAuxiliary),
        opaque_package_policy: OpaquePackagePolicy::OwnerScopedInert,
        unsupported_diagnostic_policy: "web extension taskpane cluster is preserved opaquely; semantic editing requires a future typed model",
        dirty_invalidation_triggers: &["web extension package mutation"],
        semantic_references: &[
            "root taskpanes relationship",
            "taskpane webextension relationship",
        ],
        user_visible_behavior: "Office add-in taskpane package payload and activation metadata",
        fixture_coverage: "xlsx roundtrip package graph regression",
    },
    OoxmlOwnershipRow {
        surface: "unsupported functional package adjuncts awaiting typed round-9 models; volatile dependencies are workbook-owned calculation sidecars",
        package_part_patterns: &[
            "xl/volatileDependencies.xml",
            "xl/featurePropertyBag/*",
            "xl/revisions/*",
            "xl/smartTags.xml",
            "xl/xmlMaps.xml",
            "xl/timelines/timeline*.xml",
            "xl/timelineCaches/timelineCache*.xml",
        ],
        ooxml_modules: &[
            "revisions",
            "smart_tags",
            "timelines",
            "volatile",
            "xml_map",
        ],
        canonical_type_status: CanonicalTypeStatus::InventoryOnly,
        classification: OoxmlOwnershipClassification::TypedViewOnly,
        production_reader: "package inventory, volatile dependency scanner, and feature-property-bag parser",
        private_parser_adapter: "workbook-owned volatile dependency sidecar plus typed feature-property bag scanner",
        full_parse_result_field: "volatile_dependency_part, feature_properties, unsupported package diagnostics",
        parse_output_domain_owner: "ParseOutput.volatile_dependency_part and WorkbookMetadata.feature_properties",
        yrs_app_persistence_owner: "workbook volatileDependencyPackagePart JSON sidecar and workbook metadata JSON",
        api_exposure: ApiExposureLevel::DiagnosticOnly,
        production_writer: "package graph modeled workbook relationship/content type and raw sidecar bytes when valid",
        package_feature_owner: Some(PackageFeatureOwner::CoreWorkbook),
        auxiliary_policy: Some(AuxiliaryPackagePartPolicy::TypedOwned),
        opaque_package_policy: OpaquePackagePolicy::DiagnosticDrop,
        unsupported_diagnostic_policy: "malformed or invalidated volatile dependencies are dropped; other adjuncts remain unsupported-needs-model-dropped with package part and relationship fingerprints",
        dirty_invalidation_triggers: &["detected package adjunct", "owning typed feature mutation"],
        semantic_references: &["timeline cache id", "revision id", "XML map id"],
        user_visible_behavior: "functional but currently unmodeled OOXML surfaces that must not be stale-replayed",
        fixture_coverage: "round-9 matrix contract only; feature gates owned by plans 02/05",
    },
];

pub fn ownership_contract(owner: PackageFeatureOwner) -> &'static PackageOwnershipContract {
    PACKAGE_OWNERSHIP_MATRIX
        .iter()
        .find(|contract| contract.owner == owner)
        .expect("package ownership matrix must cover every PackageFeatureOwner")
}

pub fn current_state_owner_policy(owner: PackageFeatureOwner) -> &'static CurrentStateOwnerPolicy {
    CURRENT_STATE_OWNER_POLICY_TABLE
        .iter()
        .find(|policy| policy.owner == owner)
        .expect("current-state owner policy table must cover every PackageFeatureOwner")
}

pub fn current_state_owner_policy_for_part(path: &str) -> Option<&'static CurrentStateOwnerPolicy> {
    modeled_owner_for_part(path).map(current_state_owner_policy)
}

pub fn all_current_state_owner_policies() -> &'static [CurrentStateOwnerPolicy] {
    CURRENT_STATE_OWNER_POLICY_TABLE
}

pub fn modeled_owner_for_part(path: &str) -> Option<PackageFeatureOwner> {
    let path = path.trim_start_matches('/');
    if matches!(
        path,
        "xl/workbook.xml"
            | "xl/styles.xml"
            | "xl/sharedStrings.xml"
            | "xl/metadata.xml"
            | "xl/persons/person.xml"
    ) || (path.starts_with("xl/theme/") && path.ends_with(".xml"))
        || (path.starts_with("xl/worksheets/sheet") && path.ends_with(".xml"))
    {
        Some(PackageFeatureOwner::CoreWorkbook)
    } else if path.starts_with("xl/tables/tableSingleCells") && path.ends_with(".xml") {
        Some(PackageFeatureOwner::WorksheetTables)
    } else if path.starts_with("xl/tables/table") && path.ends_with(".xml") {
        Some(PackageFeatureOwner::WorksheetTables)
    } else if path == "xl/connections.xml"
        || (path.starts_with("xl/queryTables/queryTable") && path.ends_with(".xml"))
    {
        Some(PackageFeatureOwner::ConnectionsAndQueryTables)
    } else if path.starts_with("xl/featurePropertyBag/") && path.ends_with(".xml") {
        Some(PackageFeatureOwner::CoreWorkbook)
    } else if (path.starts_with("xl/embeddings/oleObject")
        || path.starts_with("xl/embeddings/package"))
        && path.ends_with(".bin")
    {
        Some(PackageFeatureOwner::OleObjects)
    } else if path.starts_with("xl/richData/") {
        Some(PackageFeatureOwner::RichData)
    } else if (path.starts_with("xl/pivotTables/pivotTable") && path.ends_with(".xml"))
        || (path.starts_with("xl/pivotCache/pivotCacheDefinition") && path.ends_with(".xml"))
        || (path.starts_with("xl/pivotCache/pivotCacheRecords") && path.ends_with(".xml"))
    {
        Some(PackageFeatureOwner::PivotTables)
    } else if (path.starts_with("xl/slicers/slicer") && path.ends_with(".xml"))
        || (path.starts_with("xl/slicerCaches/slicerCache") && path.ends_with(".xml"))
        || (path.starts_with("xl/timelines/timeline") && path.ends_with(".xml"))
        || (path.starts_with("xl/timelineCaches/timelineCache") && path.ends_with(".xml"))
    {
        Some(PackageFeatureOwner::SlicersAndTimelines)
    } else if (path.starts_with("xl/charts/style") && path.ends_with(".xml"))
        || (path.starts_with("xl/charts/color") && path.ends_with(".xml"))
        || (path.starts_with("xl/charts/colors") && path.ends_with(".xml"))
        || (path.starts_with("xl/drawings/userShapeDrawing") && path.ends_with(".xml"))
    {
        Some(PackageFeatureOwner::ChartAuxiliary)
    } else if path.starts_with("xl/externalLinks/externalLink") && path.ends_with(".xml") {
        Some(PackageFeatureOwner::ExternalLinks)
    } else if (path.starts_with("xl/comments") && path.ends_with(".xml"))
        || (path.starts_with("xl/drawings/vmlDrawing") && path.ends_with(".vml"))
    {
        Some(PackageFeatureOwner::Comments)
    } else if path.starts_with("xl/threadedComments/threadedComment") && path.ends_with(".xml") {
        Some(PackageFeatureOwner::ThreadedComments)
    } else if (path.starts_with("xl/drawings/drawing") && path.ends_with(".xml"))
        || (path.starts_with("xl/charts/chart") && path.ends_with(".xml"))
    {
        Some(PackageFeatureOwner::DrawingObjects)
    } else if (path.starts_with("xl/ctrlProps/ctrlProp") && path.ends_with(".xml"))
        || (path.starts_with("xl/activeX/activeX")
            && (path.ends_with(".xml") || path.ends_with(".bin")))
    {
        Some(PackageFeatureOwner::Controls)
    } else if path.starts_with("xl/printerSettings/printerSettings") && path.ends_with(".bin") {
        Some(PackageFeatureOwner::PrintSettings)
    } else if path.starts_with("xl/media/") {
        Some(PackageFeatureOwner::Media)
    } else if matches!(
        path,
        "docProps/core.xml" | "docProps/app.xml" | "docProps/custom.xml"
    ) {
        Some(PackageFeatureOwner::DocumentProperties)
    } else {
        None
    }
}

pub fn modeled_feature_part_must_not_be_opaque(path: &str) -> bool {
    modeled_owner_for_part(path).is_some()
}

pub fn auxiliary_package_part_policy(path: &str) -> Option<AuxiliaryPackagePartPolicy> {
    let path = path.trim_start_matches('/').replace('\\', "/");
    if path.starts_with("customXml/")
        || path == "xl/xmlMaps.xml"
        || ((path.starts_with("xl/chartsheets/") || path.starts_with("xl/dialogsheets/"))
            && path.ends_with(".xml"))
        || (path.starts_with("xl/printerSettings/") && path.ends_with(".bin"))
        || path.starts_with("docProps/thumbnail.")
        || path == "docMetadata/LabelInfo.xml"
        || path.starts_with("xl/webextensions/")
        || (path.starts_with("xl/customProperty")
            && path.ends_with(".bin")
            && !path.starts_with("xl/customProperty/"))
    {
        Some(AuxiliaryPackagePartPolicy::InertOpaqueAuxiliary)
    } else if path == "xl/persons/person.xml"
        || path.starts_with("xl/threadedComments/")
        || path == "xl/connections.xml"
        || path == "xl/volatileDependencies.xml"
        || path.starts_with("xl/queryTables/")
        || (path.starts_with("xl/tables/tableSingleCells") && path.ends_with(".xml"))
    {
        Some(AuxiliaryPackagePartPolicy::TypedOwned)
    } else if path == "xl/vbaProject.bin" {
        Some(AuxiliaryPackagePartPolicy::ActiveQuarantined)
    } else if path.starts_with("xl/activeX/")
        || path == "_xmlsignatures/origin.sigs"
        || path.starts_with("_xmlsignatures/sig")
    {
        Some(AuxiliaryPackagePartPolicy::ActiveForbidden)
    } else if path.starts_with("xl/featurePropertyBag/") {
        Some(AuxiliaryPackagePartPolicy::TypedOwned)
    } else if path.starts_with("xl/revisions/")
        || path.starts_with("xl/timelineCaches/")
        || path.starts_with("xl/timelines/")
    {
        Some(AuxiliaryPackagePartPolicy::DiagnosticsOnly)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn round_6_feature_ownership_matrix_is_complete() {
        for owner in [
            PackageFeatureOwner::ConnectionsAndQueryTables,
            PackageFeatureOwner::OleObjects,
            PackageFeatureOwner::RichData,
            PackageFeatureOwner::PivotTables,
            PackageFeatureOwner::SlicersAndTimelines,
            PackageFeatureOwner::ChartAuxiliary,
            PackageFeatureOwner::ExternalLinks,
            PackageFeatureOwner::DocumentProperties,
        ] {
            let contract = ownership_contract(owner);
            assert!(!contract.owner_domain.is_empty());
            assert!(!contract.parts.is_empty());
            assert!(!contract.relationships.is_empty());
            assert!(!contract.content_types.is_empty());
            assert!(!contract.relationship_id_hints.is_empty());
            assert!(!contract.dirty_invalidation_triggers.is_empty());
            assert!(contract.opaque_policy.contains("typed"));
        }
    }

    #[test]
    fn modeled_feature_package_parts_are_not_opaque_candidates() {
        for (path, owner) in [
            (
                "xl/queryTables/queryTable1.xml",
                PackageFeatureOwner::ConnectionsAndQueryTables,
            ),
            (
                "xl/embeddings/oleObject1.bin",
                PackageFeatureOwner::OleObjects,
            ),
            ("xl/richData/rdrichvalue.xml", PackageFeatureOwner::RichData),
            (
                "xl/pivotTables/pivotTable1.xml",
                PackageFeatureOwner::PivotTables,
            ),
            (
                "xl/slicerCaches/slicerCache1.xml",
                PackageFeatureOwner::SlicersAndTimelines,
            ),
            ("xl/charts/style1.xml", PackageFeatureOwner::ChartAuxiliary),
            (
                "xl/externalLinks/externalLink1.xml",
                PackageFeatureOwner::ExternalLinks,
            ),
            (
                "docProps/custom.xml",
                PackageFeatureOwner::DocumentProperties,
            ),
        ] {
            assert_eq!(modeled_owner_for_part(path), Some(owner));
            assert!(modeled_feature_part_must_not_be_opaque(path));
        }
    }

    #[test]
    fn unknown_owner_clusters_can_remain_opaque_candidates() {
        assert_eq!(
            modeled_owner_for_part("xl/vendorExtensions/vendor1.xml"),
            None
        );
        assert!(!modeled_feature_part_must_not_be_opaque(
            "xl/vendorExtensions/vendor1.xml"
        ));
    }

    #[test]
    fn round_9_ooxml_ownership_matrix_covers_public_ooxml_modules() {
        let lib_rs = include_str!("../../../../ooxml/types/src/lib.rs");
        let public_modules = parse_public_module_names(lib_rs);
        let covered_modules: BTreeSet<&str> = ROUND_9_OOXML_OWNERSHIP_MATRIX
            .iter()
            .flat_map(|row| row.ooxml_modules.iter().copied())
            .collect();

        let missing: Vec<&str> = public_modules
            .iter()
            .copied()
            .filter(|module| !covered_modules.contains(module))
            .collect();
        assert!(
            missing.is_empty(),
            "ROUND_9_OOXML_OWNERSHIP_MATRIX lacks rows for public ooxml-types modules: {missing:?}"
        );
    }

    #[test]
    fn package_feature_owner_variants_have_writer_contracts() {
        let source = include_str!("package_ownership.rs");
        let variants = parse_enum_variants(source, "PackageFeatureOwner");
        let covered: BTreeSet<String> = PACKAGE_OWNERSHIP_MATRIX
            .iter()
            .map(|contract| format!("{:?}", contract.owner))
            .collect();

        let missing: Vec<String> = variants
            .iter()
            .filter(|variant| !covered.contains(*variant))
            .cloned()
            .collect();
        assert!(
            missing.is_empty(),
            "PACKAGE_OWNERSHIP_MATRIX lacks PackageFeatureOwner coverage for: {missing:?}"
        );
    }

    #[test]
    fn auxiliary_policy_variants_have_round_9_rows() {
        let source = include_str!("package_ownership.rs");
        let variants = parse_enum_variants(source, "AuxiliaryPackagePartPolicy");
        let covered: BTreeSet<String> = ROUND_9_OOXML_OWNERSHIP_MATRIX
            .iter()
            .filter_map(|row| row.auxiliary_policy)
            .map(|policy| format!("{:?}", policy))
            .collect();

        let missing: Vec<String> = variants
            .iter()
            .filter(|variant| !covered.contains(*variant))
            .cloned()
            .collect();
        assert!(
            missing.is_empty(),
            "ROUND_9_OOXML_OWNERSHIP_MATRIX lacks auxiliary policy coverage for: {missing:?}"
        );
    }

    #[test]
    fn round_9_high_risk_surfaces_are_classified() {
        for required_pattern in [
            "xl/chartsheets/sheet*.xml",
            "xl/dialogsheets/sheet*.xml",
            "xl/xmlMaps.xml",
            "customXml/*",
            "xl/revisions/*",
            "xl/volatileDependencies.xml",
            "xl/webextensions/*",
            "xl/vbaProject.bin",
            "xl/timelines/timeline*.xml",
            "xl/timelineCaches/timelineCache*.xml",
            "xl/featurePropertyBag/*",
            "xl/model/*",
            "xl/smartTags.xml",
        ] {
            assert!(
                ROUND_9_OOXML_OWNERSHIP_MATRIX
                    .iter()
                    .any(|row| row.package_part_patterns.contains(&required_pattern)),
                "ROUND_9_OOXML_OWNERSHIP_MATRIX lacks high-risk package pattern {required_pattern}"
            );
        }

        for required_surface in [
            "custom views",
            "cell watches",
            "sheetCalcPr",
            "protected ranges",
            "scenarios",
            "data consolidation",
            "phonetic",
            "smart tags",
        ] {
            assert!(
                ROUND_9_OOXML_OWNERSHIP_MATRIX.iter().any(|row| row
                    .surface
                    .contains(required_surface)
                    || row.user_visible_behavior.contains(required_surface)
                    || row.semantic_references.contains(&required_surface)),
                "ROUND_9_OOXML_OWNERSHIP_MATRIX lacks high-risk worksheet surface {required_surface}"
            );
        }
    }

    fn parse_public_module_names(source: &str) -> BTreeSet<&str> {
        source
            .lines()
            .filter_map(|line| {
                let line = line.trim();
                let rest = line.strip_prefix("pub mod ")?;
                Some(rest.trim_end_matches(';').trim())
            })
            .filter(|module| !module.is_empty())
            .collect()
    }

    fn parse_enum_variants(source: &str, enum_name: &str) -> BTreeSet<String> {
        let enum_start = format!("pub enum {enum_name} {{");
        let mut in_enum = false;
        let mut variants = BTreeSet::new();

        for line in source.lines() {
            let trimmed = line.trim();
            if !in_enum {
                in_enum = trimmed == enum_start;
                continue;
            }
            if trimmed == "}" {
                break;
            }
            if trimmed.is_empty() || trimmed.starts_with("//") || trimmed.starts_with("#[") {
                continue;
            }
            let variant = trimmed
                .trim_end_matches(',')
                .split_once('(')
                .map_or(trimmed.trim_end_matches(','), |(name, _)| name)
                .trim();
            if !variant.is_empty() {
                variants.insert(variant.to_string());
            }
        }

        variants
    }
}

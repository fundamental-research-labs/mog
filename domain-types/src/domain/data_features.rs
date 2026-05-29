use serde::{Deserialize, Serialize};
use value_types::CellValue;

use super::connections::{QueryTable, WorkbookConnectionSet};
use super::external_link::ExternalLink;
use super::pivot::{ParsedPivotTable, PivotCacheSourceDef};
use super::table::TableSpec;
use crate::{DataTableRegion, SheetData, WorkbookMetadata};

/// Workbook-owned aggregate for active OOXML data features.
///
/// Existing parser, Yrs, and writer compatibility fields still project out of
/// this shape during Round 9 migration. New data-feature surfaces should attach
/// here first, then add compatibility projections only where older call sites
/// still require them.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookDataFeatures {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tables: Vec<WorkbookTableFeature>,
    #[serde(default, skip_serializing_if = "WorkbookConnectionSet::is_empty")]
    pub connections: WorkbookConnectionSet,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub query_tables: Vec<WorkbookQueryTableFeature>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub xml_maps: Vec<WorkbookXmlMapFeature>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub external_links: Vec<ExternalLink>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pivot_caches: Vec<WorkbookPivotCacheFeature>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pivot_tables: Vec<ParsedPivotTable>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub slicer_caches: Vec<ooxml_types::slicers::SlicerCacheDef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub slicers: Vec<WorkbookSlicerFeature>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub timeline_caches: Vec<ooxml_types::timelines::TimelineCacheDef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub timelines: Vec<WorkbookTimelineFeature>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<WorkbookMetadata>,
    #[serde(default, skip_serializing_if = "WorkbookWhatIfFeatures::is_empty")]
    pub what_if: WorkbookWhatIfFeatures,
    #[serde(default, skip_serializing_if = "WorkbookFeatureProperties::is_empty")]
    pub feature_properties: WorkbookFeatureProperties,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unsupported: Vec<DataFeatureDiagnostic>,
}

impl WorkbookDataFeatures {
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.tables.is_empty()
            && self.connections.is_empty()
            && self.query_tables.is_empty()
            && self.xml_maps.is_empty()
            && self.external_links.is_empty()
            && self.pivot_caches.is_empty()
            && self.pivot_tables.is_empty()
            && self.slicer_caches.is_empty()
            && self.slicers.is_empty()
            && self.timeline_caches.is_empty()
            && self.timelines.is_empty()
            && self
                .metadata
                .as_ref()
                .is_none_or(WorkbookMetadata::is_empty)
            && self.what_if.is_empty()
            && self.feature_properties.is_empty()
            && self.unsupported.is_empty()
    }

    #[must_use]
    pub fn from_compat_fields(
        sheets: &[SheetData],
        connections: &WorkbookConnectionSet,
        external_links: &[ExternalLink],
        pivot_tables: &[ParsedPivotTable],
        pivot_cache_sources: &[PivotCacheSourceDef],
        pivot_cache_records: &std::collections::HashMap<u32, Vec<Vec<CellValue>>>,
        slicer_caches: &[ooxml_types::slicers::SlicerCacheDef],
        timeline_caches: &[ooxml_types::timelines::TimelineCacheDef],
        metadata: &Option<WorkbookMetadata>,
        data_table_regions: &[DataTableRegion],
    ) -> Self {
        let mut tables = Vec::new();
        let mut query_tables = Vec::new();
        let mut slicers = Vec::new();
        let mut timelines = Vec::new();

        for (sheet_index, sheet) in sheets.iter().enumerate() {
            let sheet_owner = SheetFeatureOwner {
                sheet_index: sheet_index as u32,
                sheet_name: sheet.name.clone(),
                sheet_id: sheet.sheet_id,
            };

            for table in &sheet.tables {
                tables.push(WorkbookTableFeature {
                    owner: sheet_owner.clone(),
                    table: table.clone(),
                });
                if let Some(query_table) = &table.query_table {
                    query_tables.push(WorkbookQueryTableFeature {
                        owner: sheet_owner.clone(),
                        table_id: table.id,
                        table_name: table.name.clone(),
                        query_table: query_table.clone(),
                    });
                }
            }

            for slicer in &sheet.slicers {
                slicers.push(WorkbookSlicerFeature {
                    owner: sheet_owner.clone(),
                    slicer: slicer.clone(),
                    anchor: sheet
                        .slicer_anchors
                        .iter()
                        .find(|anchor| anchor.slicer_name == slicer.name)
                        .cloned(),
                });
            }

            for timeline in &sheet.timelines {
                timelines.push(WorkbookTimelineFeature {
                    owner: sheet_owner.clone(),
                    timeline: timeline.clone(),
                    anchor: sheet
                        .timeline_anchors
                        .iter()
                        .find(|anchor| anchor.timeline_name == timeline.name)
                        .cloned(),
                });
            }
        }

        let mut pivot_caches: Vec<_> = pivot_cache_sources
            .iter()
            .map(|source| WorkbookPivotCacheFeature {
                cache_id: source.cache_id,
                source: Some(source.clone()),
                records: pivot_cache_records
                    .get(&source.cache_id)
                    .cloned()
                    .unwrap_or_default(),
                package: None,
                unsupported: Vec::new(),
            })
            .collect();
        for (cache_id, records) in pivot_cache_records {
            if pivot_caches.iter().any(|cache| cache.cache_id == *cache_id) {
                continue;
            }
            pivot_caches.push(WorkbookPivotCacheFeature {
                cache_id: *cache_id,
                source: None,
                records: records.clone(),
                package: None,
                unsupported: Vec::new(),
            });
        }
        pivot_caches.sort_by_key(|cache| cache.cache_id);

        Self {
            tables,
            connections: connections.clone(),
            query_tables,
            xml_maps: Vec::new(),
            external_links: external_links.to_vec(),
            pivot_caches,
            pivot_tables: pivot_tables.to_vec(),
            slicer_caches: slicer_caches.to_vec(),
            slicers,
            timeline_caches: timeline_caches.to_vec(),
            timelines,
            metadata: metadata.clone(),
            what_if: WorkbookWhatIfFeatures {
                data_table_regions: data_table_regions.to_vec(),
                scenarios: Vec::new(),
                data_consolidations: Vec::new(),
            },
            feature_properties: metadata
                .as_ref()
                .map(|metadata| metadata.feature_properties.clone())
                .unwrap_or_default(),
            unsupported: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookFeatureProperties {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bags: Vec<FeaturePropertyBag>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<DataFeatureDiagnostic>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package: Option<FeaturePropertyBagPackageIdentity>,
}

impl WorkbookFeatureProperties {
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.bags.is_empty() && self.diagnostics.is_empty() && self.package.is_none()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeaturePropertyBagPackageIdentity {
    pub path: String,
    pub content_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_relationship_id: Option<String>,
    pub workbook_relationship_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_relationship_target: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeaturePropertyBag {
    pub stable_id: String,
    pub imported_ordinal: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imported_bag_id: Option<u32>,
    pub bag_type: String,
    pub kind: FeaturePropertyBagKind,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attributes: Vec<FeaturePropertyAttribute>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<FeaturePropertyBagElement>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FeaturePropertyBagKind {
    Checkbox,
    XfControls,
    XfComplement,
    XfComplements,
    #[default]
    Unknown,
}

impl FeaturePropertyBagKind {
    #[must_use]
    pub fn from_bag_type(value: &str) -> Self {
        match value {
            "Checkbox" => Self::Checkbox,
            "XFControls" => Self::XfControls,
            "XFComplement" => Self::XfComplement,
            "XFComplements" => Self::XfComplements,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeaturePropertyAttribute {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeaturePropertyBagElement {
    pub name: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attributes: Vec<FeaturePropertyAttribute>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<FeaturePropertyBagElement>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetFeatureOwner {
    pub sheet_index: u32,
    pub sheet_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet_id: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookTableFeature {
    pub owner: SheetFeatureOwner,
    pub table: TableSpec,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookQueryTableFeature {
    pub owner: SheetFeatureOwner,
    pub table_id: u32,
    pub table_name: String,
    pub query_table: QueryTable,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookXmlMapFeature {
    pub map_id: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mapped_cells: Vec<WorkbookXmlCellBinding>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mapped_columns: Vec<WorkbookXmlTableColumnBinding>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub custom_xml_parts: Vec<CustomXmlPayloadBinding>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unsupported: Vec<DataFeatureDiagnostic>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookXmlCellBinding {
    pub owner: SheetFeatureOwner,
    pub cell_ref: String,
    pub xml_cell_pr: ooxml_types::xml_map::XmlCellPr,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookXmlTableColumnBinding {
    pub owner: SheetFeatureOwner,
    pub table_id: u32,
    pub table_name: String,
    pub column_id: u32,
    pub xml_column_pr: ooxml_types::xml_map::XmlColumnPr,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomXmlPayloadBinding {
    pub item_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_props_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relationship_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookPivotCacheFeature {
    pub cache_id: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<PivotCacheSourceDef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub records: Vec<Vec<CellValue>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package: Option<PivotCachePackageIdentity>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unsupported: Vec<DataFeatureDiagnostic>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotCachePackageIdentity {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub definition_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub records_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_relationship_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookSlicerFeature {
    pub owner: SheetFeatureOwner,
    pub slicer: ooxml_types::slicers::SlicerDef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<ooxml_types::slicers::SlicerAnchor>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookTimelineFeature {
    pub owner: SheetFeatureOwner,
    pub timeline: ooxml_types::timelines::TimelineDef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<ooxml_types::timelines::TimelineAnchor>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookWhatIfFeatures {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub data_table_regions: Vec<DataTableRegion>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scenarios: Vec<WorksheetScenarioFeature>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub data_consolidations: Vec<WorksheetDataConsolidationFeature>,
}

impl WorkbookWhatIfFeatures {
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.data_table_regions.is_empty()
            && self.scenarios.is_empty()
            && self.data_consolidations.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorksheetScenarioFeature {
    pub owner: SheetFeatureOwner,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorksheetDataConsolidationFeature {
    pub owner: SheetFeatureOwner,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataFeatureDiagnostic {
    pub code: DataFeatureDiagnosticCode,
    pub severity: DataFeatureDiagnosticSeverity,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relationship_owner: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relationship_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub affected_feature_id: Option<String>,
    pub export_behavior: DataFeatureExportBehavior,
    pub summary: String,
    #[serde(default)]
    pub api_visible: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DataFeatureDiagnosticCode {
    DroppedCalcChain,
    UnsupportedVolatileDependencies,
    UnsupportedTimeline,
    UnsupportedDataModel,
    UnsupportedCubeMetadata,
    UnsupportedFeaturePropertyBag,
    MissingFeaturePropertyBagPart,
    MissingFeaturePropertyBagContentType,
    WrongFeaturePropertyBagContentType,
    MalformedFeaturePropertyBagXml,
    InvalidFeaturePropertyBagReference,
    OrphanExternalLink,
    BrokenQueryTableRelationship,
    MissingConnectionId,
    MissingPivotCache,
    BrokenSlicerBinding,
    BrokenTimelineBinding,
    UnsupportedXmlMapBinding,
    RichDataMetadataIndexMismatch,
    UntypedActiveRichData,
    StaleOpaquePartRejected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DataFeatureDiagnosticSeverity {
    Info,
    #[default]
    Warning,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DataFeatureExportBehavior {
    PreservedFromTypedState,
    RebuiltFromTypedState,
    #[default]
    DroppedWithDiagnostic,
}

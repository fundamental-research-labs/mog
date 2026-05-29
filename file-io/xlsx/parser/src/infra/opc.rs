// =============================================================================
// Relationship Type Constants
// =============================================================================

use std::collections::HashMap;

use crate::infra::scanner::{extract_quoted_value, find_attr_simd, find_gt_simd, find_tag_simd};

/// Relationship type for worksheets.
pub const REL_WORKSHEET: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";

/// Relationship type for styles.
pub const REL_STYLES: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles";

/// Relationship type for theme.
pub const REL_THEME: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";

/// Strict relationship type for theme.
pub const REL_THEME_STRICT: &str = "http://purl.oclc.org/ooxml/officeDocument/relationships/theme";

pub fn is_theme_relationship_type(rel_type: &str) -> bool {
    rel_type == REL_THEME || rel_type == REL_THEME_STRICT
}

/// Relationship type for shared strings.
pub const REL_SHARED_STRINGS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings";

/// Relationship type for the main office document (workbook).
pub const REL_OFFICE_DOCUMENT: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";

/// Relationship type for core properties (metadata).
pub const REL_CORE_PROPERTIES: &str =
    "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties";

/// Relationship type for extended properties (app metadata).
pub const REL_EXTENDED_PROPERTIES: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties";

/// Relationship type for custom properties.
pub const REL_CUSTOM_PROPERTIES: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties";

/// Relationship type for DrawingML drawings.
pub const REL_DRAWING: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";

/// Relationship type for comments.
pub const REL_COMMENTS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";

/// Relationship type for tables.
pub const REL_TABLE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/table";

/// Relationship type for worksheet-owned single-cell XML table bindings.
pub const REL_TABLE_SINGLE_CELLS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableSingleCells";

/// Relationship type for charts.
pub const REL_CHART: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";

/// Relationship type for ChartEx (modern chart types).
pub const REL_CHART_EX: &str = "http://schemas.microsoft.com/office/2014/relationships/chartEx";

/// Relationship type for hyperlinks.
pub const REL_HYPERLINK: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";

/// Relationship type for OLE objects.
pub const REL_OLE_OBJECT: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject";
/// Relationship type for embedded package objects.
pub const REL_EMBEDDED_PACKAGE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/package";
/// Relationship type for worksheet ActiveX control XML parts.
pub const REL_ACTIVE_X_CONTROL: &str =
    "http://schemas.microsoft.com/office/2006/relationships/activeXControl";
/// Relationship type for ActiveX binary persistence parts.
pub const REL_ACTIVE_X_CONTROL_BINARY: &str =
    "http://schemas.microsoft.com/office/2006/relationships/activeXControlBinary";

/// Relationship type for pivot cache definitions.
pub const REL_PIVOT_CACHE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition";

/// Strict relationship type for pivot cache definitions.
pub const REL_PIVOT_CACHE_STRICT: &str =
    "http://purl.oclc.org/ooxml/officeDocument/relationships/pivotCacheDefinition";

/// Relationship type for pivot tables.
pub const REL_PIVOT_TABLE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable";

/// Relationship type for VML drawings (legacy, used for comments).
pub const REL_VML_DRAWING: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing";

/// Relationship type for printer settings.
pub const REL_PRINTER_SETTINGS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/printerSettings";

/// Relationship type for external links.
pub const REL_EXTERNAL_LINK: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink";

/// Relationship type for an external workbook path stored in an external link part.
pub const REL_EXTERNAL_LINK_PATH: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath";

/// Relationship type for an external workbook path longer than Excel's legacy path limit.
pub const REL_EXTERNAL_LINK_LONG_PATH: &str =
    "http://schemas.microsoft.com/office/2019/04/relationships/externalLinkLongPath";

/// Relationship type for a missing external workbook path.
pub const REL_XL_PATH_MISSING: &str =
    "http://schemas.microsoft.com/office/2006/relationships/xlExternalLinkPath/xlPathMissing";

/// Relationship type for a missing long external workbook path.
pub const REL_XL_LONG_PATH_MISSING: &str = "http://schemas.microsoft.com/office/2009/04/relationships/xlExternalLinkLongPath/xlPathMissing";

/// Relationship type for an external workbook path rooted at Excel's startup directory.
pub const REL_XL_STARTUP: &str =
    "http://schemas.microsoft.com/office/2006/relationships/xlExternalLinkPath/xlStartup";

/// Relationship type for an external workbook path rooted at Excel's alternate startup directory.
pub const REL_XL_ALTERNATE_STARTUP: &str =
    "http://schemas.microsoft.com/office/2006/relationships/xlExternalLinkPath/xlAlternateStartup";

/// Relationship type for an external workbook path rooted at Excel's library directory.
pub const REL_XL_LIBRARY: &str =
    "http://schemas.microsoft.com/office/2006/relationships/xlExternalLinkPath/xlLibrary";

/// Relationship type for a long external workbook path rooted at Excel's startup directory.
pub const REL_XL_LONG_STARTUP: &str =
    "http://schemas.microsoft.com/office/2019/04/relationships/xlExternalLinkLongPath/xlStartup";

/// Relationship type for a long external workbook path rooted at Excel's alternate startup directory.
pub const REL_XL_LONG_ALTERNATE_STARTUP: &str = "http://schemas.microsoft.com/office/2019/04/relationships/xlExternalLinkLongPath/xlAlternateStartup";

/// Relationship type for a long external workbook path rooted at Excel's library directory.
pub const REL_XL_LONG_LIBRARY: &str =
    "http://schemas.microsoft.com/office/2009/04/relationships/xlExternalLinkLongPath/xlLibrary";

/// Relationship type for SmartArt diagram data.
pub const REL_DIAGRAM_DATA: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData";

/// Relationship type for SmartArt diagram layout.
pub const REL_DIAGRAM_LAYOUT: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramLayout";

/// Relationship type for SmartArt diagram colors.
pub const REL_DIAGRAM_COLORS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramColors";

/// Relationship type for SmartArt diagram quick style.
pub const REL_DIAGRAM_QUICK_STYLE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramQuickStyle";

/// Relationship type for SmartArt diagram drawing.
pub const REL_DIAGRAM_DRAWING: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramDrawing";

/// Relationship type for slicers (sheet-level, Microsoft extension).
pub const REL_SLICER: &str = "http://schemas.microsoft.com/office/2007/relationships/slicer";

/// Relationship type for slicer caches (workbook-level, Microsoft extension).
pub const REL_SLICER_CACHE: &str =
    "http://schemas.microsoft.com/office/2007/relationships/slicerCache";

/// Relationship type for timelines (sheet-level, Microsoft extension).
pub const REL_TIMELINE: &str = "http://schemas.microsoft.com/office/2011/relationships/timeline";

/// Relationship type for timeline caches (workbook-level, Microsoft extension).
pub const REL_TIMELINE_CACHE: &str =
    "http://schemas.microsoft.com/office/2011/relationships/timelineCache";

/// Relationship type for spreadsheet metadata (xl/metadata.xml).
pub const REL_METADATA: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata";

/// Relationship type for custom XML map definitions (xl/xmlMaps.xml).
pub const REL_XML_MAPS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/xmlMaps";

/// Relationship type for shared-workbook revision headers.
pub const REL_REVISION_HEADERS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/revisionHeaders";

/// Relationship type for shared-workbook revision log parts.
pub const REL_REVISION_LOG: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/revisionLog";

/// Relationship type for shared-workbook user-name data.
pub const REL_REVISION_USER_NAMES: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/usernames";

/// Relationship type for the calculation chain (xl/calcChain.xml).
pub const REL_CALC_CHAIN: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain";

/// Strict relationship type for the calculation chain.
pub const REL_CALC_CHAIN_STRICT: &str =
    "http://purl.oclc.org/ooxml/officeDocument/relationships/calcChain";

/// Relationship type for workbook volatile dependencies.
pub const REL_VOLATILE_DEPENDENCIES: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/volatileDependencies";

/// Strict relationship type for workbook volatile dependencies.
pub const REL_VOLATILE_DEPENDENCIES_STRICT: &str =
    "http://purl.oclc.org/ooxml/officeDocument/relationships/volatileDependencies";

/// Relationship type for threaded comments (modern Excel 365 comments).
pub const REL_THREADED_COMMENT: &str =
    "http://schemas.microsoft.com/office/2017/10/relationships/threadedComment";

/// Relationship type for the person list (xl/persons/person.xml).
pub const REL_PERSON: &str = "http://schemas.microsoft.com/office/2017/10/relationships/person";

/// Relationship type for VBA projects.
pub const REL_VBA_PROJECT: &str =
    "http://schemas.microsoft.com/office/2006/relationships/vbaProject";

/// Relationship type for chart style sidecar parts.
pub const REL_CHART_STYLE: &str =
    "http://schemas.microsoft.com/office/2011/relationships/chartStyle";

/// Relationship type for chart color style sidecar parts.
pub const REL_CHART_COLOR_STYLE: &str =
    "http://schemas.microsoft.com/office/2011/relationships/chartColorStyle";

/// Relationship type for chart user-shapes sidecar drawing parts.
pub const REL_CHART_USER_SHAPES: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartUserShapes";

/// Relationship type for images.
pub const REL_IMAGE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

/// Relationship type for pivot cache records.
pub const REL_PIVOT_CACHE_RECORDS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords";

/// Strict relationship type for pivot cache records.
pub const REL_PIVOT_CACHE_RECORDS_STRICT: &str =
    "http://purl.oclc.org/ooxml/officeDocument/relationships/pivotCacheRecords";

/// Relationship type for form control property parts.
pub const REL_CTRL_PROP: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/ctrlProp";

/// Relationship type for worksheet custom property parts.
pub const REL_CUSTOM_PROPERTY: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customProperty";

/// XML namespace for package relationship parts.
pub const RELATIONSHIPS_NS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum PackageOwner {
    Root,
    Workbook,
    Worksheet { sheet_index: usize, path: String },
    Drawing { path: String },
    Chart { path: String },
    VmlDrawing { path: String },
    PivotTable { path: String },
    PivotCache { path: String },
    ExternalLink { path: String },
    CustomPart { path: String },
}

impl PackageOwner {
    pub fn owner_part_path(&self) -> Option<&str> {
        match self {
            Self::Root => None,
            Self::Workbook => Some("xl/workbook.xml"),
            Self::Worksheet { path, .. }
            | Self::Drawing { path }
            | Self::Chart { path }
            | Self::VmlDrawing { path }
            | Self::PivotTable { path }
            | Self::PivotCache { path }
            | Self::ExternalLink { path }
            | Self::CustomPart { path } => Some(path),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum OoxmlRelationshipType {
    OfficeDocument,
    CoreProperties,
    ExtendedProperties,
    CustomProperties,
    Worksheet,
    Styles,
    Theme,
    SharedStrings,
    CalcChain,
    Comments,
    ThreadedComments,
    VmlDrawing,
    Drawing,
    Chart,
    ChartEx,
    ChartStyle,
    ChartColorStyle,
    ChartUserShapes,
    Image,
    Table,
    TableSingleCells,
    PivotTable,
    PivotCacheDefinition,
    PivotCacheRecords,
    Hyperlink,
    PrinterSettings,
    CtrlProp,
    CustomProperty,
    ExternalLink,
    ExternalLinkPath,
    ExternalLinkLongPath,
    XlPathMissing,
    XlLongPathMissing,
    XlStartup,
    XlAlternateStartup,
    XlLibrary,
    XlLongStartup,
    XlLongAlternateStartup,
    XlLongLibrary,
    DiagramData,
    DiagramLayout,
    DiagramColors,
    DiagramQuickStyle,
    DiagramDrawing,
    Slicer,
    SlicerCache,
    Timeline,
    TimelineCache,
    Metadata,
    VolatileDependencies,
    OleObject,
    EmbeddedPackage,
    ActiveXControl,
    ActiveXControlBinary,
    Person,
    VbaProject,
    Unknown(String),
}

impl OoxmlRelationshipType {
    pub fn from_uri(uri: &str) -> Self {
        match uri {
            REL_OFFICE_DOCUMENT => Self::OfficeDocument,
            REL_CORE_PROPERTIES => Self::CoreProperties,
            REL_EXTENDED_PROPERTIES => Self::ExtendedProperties,
            REL_CUSTOM_PROPERTIES => Self::CustomProperties,
            REL_WORKSHEET => Self::Worksheet,
            REL_STYLES => Self::Styles,
            REL_THEME | REL_THEME_STRICT => Self::Theme,
            REL_SHARED_STRINGS => Self::SharedStrings,
            REL_CALC_CHAIN | REL_CALC_CHAIN_STRICT => Self::CalcChain,
            REL_VOLATILE_DEPENDENCIES | REL_VOLATILE_DEPENDENCIES_STRICT => {
                Self::VolatileDependencies
            }
            REL_COMMENTS => Self::Comments,
            REL_THREADED_COMMENT => Self::ThreadedComments,
            REL_VML_DRAWING => Self::VmlDrawing,
            REL_DRAWING => Self::Drawing,
            REL_CHART => Self::Chart,
            REL_CHART_EX => Self::ChartEx,
            REL_CHART_STYLE => Self::ChartStyle,
            REL_CHART_COLOR_STYLE => Self::ChartColorStyle,
            REL_CHART_USER_SHAPES => Self::ChartUserShapes,
            REL_IMAGE => Self::Image,
            REL_TABLE => Self::Table,
            REL_TABLE_SINGLE_CELLS => Self::TableSingleCells,
            REL_PIVOT_TABLE => Self::PivotTable,
            REL_PIVOT_CACHE | REL_PIVOT_CACHE_STRICT => Self::PivotCacheDefinition,
            REL_PIVOT_CACHE_RECORDS | REL_PIVOT_CACHE_RECORDS_STRICT => Self::PivotCacheRecords,
            REL_HYPERLINK => Self::Hyperlink,
            REL_PRINTER_SETTINGS => Self::PrinterSettings,
            REL_CTRL_PROP => Self::CtrlProp,
            REL_CUSTOM_PROPERTY => Self::CustomProperty,
            REL_EXTERNAL_LINK => Self::ExternalLink,
            REL_EXTERNAL_LINK_PATH => Self::ExternalLinkPath,
            REL_EXTERNAL_LINK_LONG_PATH => Self::ExternalLinkLongPath,
            REL_XL_PATH_MISSING => Self::XlPathMissing,
            REL_XL_LONG_PATH_MISSING => Self::XlLongPathMissing,
            REL_XL_STARTUP => Self::XlStartup,
            REL_XL_ALTERNATE_STARTUP => Self::XlAlternateStartup,
            REL_XL_LIBRARY => Self::XlLibrary,
            REL_XL_LONG_STARTUP => Self::XlLongStartup,
            REL_XL_LONG_ALTERNATE_STARTUP => Self::XlLongAlternateStartup,
            REL_XL_LONG_LIBRARY => Self::XlLongLibrary,
            REL_DIAGRAM_DATA => Self::DiagramData,
            REL_DIAGRAM_LAYOUT => Self::DiagramLayout,
            REL_DIAGRAM_COLORS => Self::DiagramColors,
            REL_DIAGRAM_QUICK_STYLE => Self::DiagramQuickStyle,
            REL_DIAGRAM_DRAWING => Self::DiagramDrawing,
            REL_SLICER => Self::Slicer,
            REL_SLICER_CACHE => Self::SlicerCache,
            REL_TIMELINE => Self::Timeline,
            REL_TIMELINE_CACHE => Self::TimelineCache,
            REL_METADATA => Self::Metadata,
            REL_OLE_OBJECT => Self::OleObject,
            REL_EMBEDDED_PACKAGE => Self::EmbeddedPackage,
            REL_ACTIVE_X_CONTROL => Self::ActiveXControl,
            REL_ACTIVE_X_CONTROL_BINARY => Self::ActiveXControlBinary,
            REL_PERSON => Self::Person,
            REL_VBA_PROJECT => Self::VbaProject,
            other => Self::Unknown(other.to_string()),
        }
    }

    pub fn uri(&self) -> &str {
        match self {
            Self::OfficeDocument => REL_OFFICE_DOCUMENT,
            Self::CoreProperties => REL_CORE_PROPERTIES,
            Self::ExtendedProperties => REL_EXTENDED_PROPERTIES,
            Self::CustomProperties => REL_CUSTOM_PROPERTIES,
            Self::Worksheet => REL_WORKSHEET,
            Self::Styles => REL_STYLES,
            Self::Theme => REL_THEME,
            Self::SharedStrings => REL_SHARED_STRINGS,
            Self::CalcChain => REL_CALC_CHAIN,
            Self::Comments => REL_COMMENTS,
            Self::ThreadedComments => REL_THREADED_COMMENT,
            Self::VmlDrawing => REL_VML_DRAWING,
            Self::Drawing => REL_DRAWING,
            Self::Chart => REL_CHART,
            Self::ChartEx => REL_CHART_EX,
            Self::ChartStyle => REL_CHART_STYLE,
            Self::ChartColorStyle => REL_CHART_COLOR_STYLE,
            Self::ChartUserShapes => REL_CHART_USER_SHAPES,
            Self::Image => REL_IMAGE,
            Self::Table => REL_TABLE,
            Self::TableSingleCells => REL_TABLE_SINGLE_CELLS,
            Self::PivotTable => REL_PIVOT_TABLE,
            Self::PivotCacheDefinition => REL_PIVOT_CACHE,
            Self::PivotCacheRecords => REL_PIVOT_CACHE_RECORDS,
            Self::Hyperlink => REL_HYPERLINK,
            Self::PrinterSettings => REL_PRINTER_SETTINGS,
            Self::CtrlProp => REL_CTRL_PROP,
            Self::CustomProperty => REL_CUSTOM_PROPERTY,
            Self::ExternalLink => REL_EXTERNAL_LINK,
            Self::ExternalLinkPath => REL_EXTERNAL_LINK_PATH,
            Self::ExternalLinkLongPath => REL_EXTERNAL_LINK_LONG_PATH,
            Self::XlPathMissing => REL_XL_PATH_MISSING,
            Self::XlLongPathMissing => REL_XL_LONG_PATH_MISSING,
            Self::XlStartup => REL_XL_STARTUP,
            Self::XlAlternateStartup => REL_XL_ALTERNATE_STARTUP,
            Self::XlLibrary => REL_XL_LIBRARY,
            Self::XlLongStartup => REL_XL_LONG_STARTUP,
            Self::XlLongAlternateStartup => REL_XL_LONG_ALTERNATE_STARTUP,
            Self::XlLongLibrary => REL_XL_LONG_LIBRARY,
            Self::DiagramData => REL_DIAGRAM_DATA,
            Self::DiagramLayout => REL_DIAGRAM_LAYOUT,
            Self::DiagramColors => REL_DIAGRAM_COLORS,
            Self::DiagramQuickStyle => REL_DIAGRAM_QUICK_STYLE,
            Self::DiagramDrawing => REL_DIAGRAM_DRAWING,
            Self::Slicer => REL_SLICER,
            Self::SlicerCache => REL_SLICER_CACHE,
            Self::Timeline => REL_TIMELINE,
            Self::TimelineCache => REL_TIMELINE_CACHE,
            Self::Metadata => REL_METADATA,
            Self::VolatileDependencies => REL_VOLATILE_DEPENDENCIES,
            Self::OleObject => REL_OLE_OBJECT,
            Self::EmbeddedPackage => REL_EMBEDDED_PACKAGE,
            Self::ActiveXControl => REL_ACTIVE_X_CONTROL,
            Self::ActiveXControlBinary => REL_ACTIVE_X_CONTROL_BINARY,
            Self::Person => REL_PERSON,
            Self::VbaProject => REL_VBA_PROJECT,
            Self::Unknown(uri) => uri,
        }
    }
}

pub fn is_external_workbook_base_path_relationship_type(rel_type: &str) -> bool {
    matches!(
        rel_type,
        REL_EXTERNAL_LINK_PATH
            | REL_EXTERNAL_LINK_LONG_PATH
            | REL_XL_PATH_MISSING
            | REL_XL_LONG_PATH_MISSING
            | REL_XL_STARTUP
            | REL_XL_ALTERNATE_STARTUP
            | REL_XL_LIBRARY
            | REL_XL_LONG_STARTUP
            | REL_XL_LONG_ALTERNATE_STARTUP
            | REL_XL_LONG_LIBRARY
    )
}

pub fn is_missing_external_workbook_path_relationship_type(rel_type: &str) -> bool {
    matches!(rel_type, REL_XL_PATH_MISSING | REL_XL_LONG_PATH_MISSING)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RelationshipTargetMode {
    Internal,
    External,
}

impl RelationshipTargetMode {
    pub fn from_attr(value: Option<&str>) -> Self {
        match value {
            Some(mode) if mode.eq_ignore_ascii_case("External") => Self::External,
            _ => Self::Internal,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RelationshipTarget {
    Internal {
        raw: String,
        path: String,
    },
    External {
        raw: String,
    },
    InvalidInternal {
        raw: String,
        error: OpcTargetResolutionError,
    },
}

impl RelationshipTarget {
    pub fn raw(&self) -> &str {
        match self {
            Self::Internal { raw, .. }
            | Self::External { raw }
            | Self::InvalidInternal { raw, .. } => raw,
        }
    }

    pub fn path(&self) -> Option<&str> {
        match self {
            Self::Internal { path, .. } => Some(path),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnedRelationship {
    pub owner: PackageOwner,
    pub id: String,
    pub rel_type: OoxmlRelationshipType,
    pub rel_type_uri: String,
    pub target_mode: RelationshipTargetMode,
    pub target: RelationshipTarget,
}

pub fn parse_owned_relationships(owner: PackageOwner, xml: &[u8]) -> Vec<OwnedRelationship> {
    let mut relationships = Vec::new();
    let mut pos = 0;
    while let Some(rel_start) = find_tag_simd(xml, b"Relationship", pos) {
        let rel_end = find_gt_simd(xml, rel_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let rel_elem = &xml[rel_start..rel_end];

        if let (Some(id), Some(rel_type_uri), Some(raw_target)) = (
            rel_attr(rel_elem, b"Id=\""),
            rel_attr(rel_elem, b"Type=\""),
            rel_attr(rel_elem, b"Target=\""),
        ) {
            let target_mode =
                RelationshipTargetMode::from_attr(rel_attr(rel_elem, b"TargetMode=\"").as_deref());
            let target = match target_mode {
                RelationshipTargetMode::External => RelationshipTarget::External {
                    raw: raw_target.clone(),
                },
                RelationshipTargetMode::Internal => {
                    match resolve_relationship_target(owner.owner_part_path(), &raw_target) {
                        Ok(path) => RelationshipTarget::Internal {
                            raw: raw_target.clone(),
                            path,
                        },
                        Err(error) => RelationshipTarget::InvalidInternal {
                            raw: raw_target.clone(),
                            error,
                        },
                    }
                }
            };

            relationships.push(OwnedRelationship {
                owner: owner.clone(),
                id,
                rel_type: OoxmlRelationshipType::from_uri(&rel_type_uri),
                rel_type_uri,
                target_mode,
                target,
            });
        }

        pos = rel_end;
    }
    relationships
}

fn rel_attr(element: &[u8], attr: &[u8]) -> Option<String> {
    let pos = find_attr_simd(element, attr, 0)?;
    let (start, end) = extract_quoted_value(element, pos + attr.len())?;
    std::str::from_utf8(&element[start..end])
        .ok()
        .map(decode_xml_text)
}

fn decode_xml_text(text: &str) -> String {
    if !text.contains('&') {
        return text.to_string();
    }

    text.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

macro_rules! rel_view {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy)]
        pub struct $name<'a> {
            relationships: &'a [OwnedRelationship],
        }

        impl<'a> $name<'a> {
            pub fn new(relationships: &'a [OwnedRelationship]) -> Self {
                Self { relationships }
            }

            pub fn all(&self) -> &'a [OwnedRelationship] {
                self.relationships
            }

            pub fn unknown(&self) -> Vec<&'a OwnedRelationship> {
                self.relationships
                    .iter()
                    .filter(|rel| matches!(rel.rel_type, OoxmlRelationshipType::Unknown(_)))
                    .collect()
            }

            pub fn by_id(&self, id: &str) -> Option<&'a OwnedRelationship> {
                self.relationships.iter().find(|rel| rel.id == id)
            }
        }
    };
}

rel_view!(WorkbookRelationships);
rel_view!(WorksheetRelationships);
rel_view!(DrawingRelationships);
rel_view!(ChartRelationships);
rel_view!(VmlDrawingRelationships);

impl<'a> WorkbookRelationships<'a> {
    pub fn worksheets(&self) -> Vec<&'a OwnedRelationship> {
        self.relationships
            .iter()
            .filter(|rel| rel.rel_type == OoxmlRelationshipType::Worksheet)
            .collect()
    }

    pub fn pivot_cache_definitions(&self) -> Vec<&'a OwnedRelationship> {
        self.relationships
            .iter()
            .filter(|rel| rel.rel_type == OoxmlRelationshipType::PivotCacheDefinition)
            .collect()
    }

    pub fn slicer_caches(&self) -> Vec<&'a OwnedRelationship> {
        self.relationships
            .iter()
            .filter(|rel| rel.rel_type == OoxmlRelationshipType::SlicerCache)
            .collect()
    }

    pub fn timeline_caches(&self) -> Vec<&'a OwnedRelationship> {
        self.relationships
            .iter()
            .filter(|rel| rel.rel_type == OoxmlRelationshipType::TimelineCache)
            .collect()
    }
}

impl<'a> WorksheetRelationships<'a> {
    pub fn drawing(&self) -> Option<&'a OwnedRelationship> {
        self.relationships
            .iter()
            .find(|rel| rel.rel_type == OoxmlRelationshipType::Drawing)
    }

    pub fn legacy_vml_drawings(&self) -> Vec<&'a OwnedRelationship> {
        self.relationships
            .iter()
            .filter(|rel| rel.rel_type == OoxmlRelationshipType::VmlDrawing)
            .collect()
    }

    pub fn comments(&self) -> Vec<&'a OwnedRelationship> {
        self.relationships
            .iter()
            .filter(|rel| rel.rel_type == OoxmlRelationshipType::Comments)
            .collect()
    }

    pub fn tables(&self) -> Vec<&'a OwnedRelationship> {
        self.relationships
            .iter()
            .filter(|rel| rel.rel_type == OoxmlRelationshipType::Table)
            .collect()
    }

    pub fn table_single_cells(&self) -> Vec<&'a OwnedRelationship> {
        self.relationships
            .iter()
            .filter(|rel| rel.rel_type == OoxmlRelationshipType::TableSingleCells)
            .collect()
    }

    pub fn hyperlinks(&self) -> Vec<&'a OwnedRelationship> {
        self.relationships
            .iter()
            .filter(|rel| rel.rel_type == OoxmlRelationshipType::Hyperlink)
            .collect()
    }

    pub fn printer_settings(&self) -> Vec<&'a OwnedRelationship> {
        self.relationships
            .iter()
            .filter(|rel| rel.rel_type == OoxmlRelationshipType::PrinterSettings)
            .collect()
    }

    pub fn pivot_tables(&self) -> Vec<&'a OwnedRelationship> {
        self.relationships
            .iter()
            .filter(|rel| rel.rel_type == OoxmlRelationshipType::PivotTable)
            .collect()
    }

    pub fn slicers(&self) -> Vec<&'a OwnedRelationship> {
        self.relationships
            .iter()
            .filter(|rel| rel.rel_type == OoxmlRelationshipType::Slicer)
            .collect()
    }

    pub fn timelines(&self) -> Vec<&'a OwnedRelationship> {
        self.relationships
            .iter()
            .filter(|rel| rel.rel_type == OoxmlRelationshipType::Timeline)
            .collect()
    }
}

impl<'a> DrawingRelationships<'a> {
    pub fn charts(&self) -> Vec<&'a OwnedRelationship> {
        self.relationships
            .iter()
            .filter(|rel| rel.rel_type == OoxmlRelationshipType::Chart)
            .collect()
    }

    pub fn chart_ex(&self) -> Vec<&'a OwnedRelationship> {
        self.relationships
            .iter()
            .filter(|rel| rel.rel_type == OoxmlRelationshipType::ChartEx)
            .collect()
    }

    pub fn images(&self) -> Vec<&'a OwnedRelationship> {
        self.relationships
            .iter()
            .filter(|rel| rel.rel_type == OoxmlRelationshipType::Image)
            .collect()
    }

    pub fn diagram_drawing(&self) -> Vec<&'a OwnedRelationship> {
        self.relationships
            .iter()
            .filter(|rel| rel.rel_type == OoxmlRelationshipType::DiagramDrawing)
            .collect()
    }

    pub fn typed_target_map(&self, rel_types: &[OoxmlRelationshipType]) -> HashMap<String, String> {
        self.relationships
            .iter()
            .filter(|rel| rel_types.iter().any(|rel_type| rel.rel_type == *rel_type))
            .filter_map(|rel| {
                rel.target
                    .path()
                    .map(|path| (rel.id.clone(), path.to_string()))
            })
            .collect()
    }
}

impl<'a> ChartRelationships<'a> {
    pub fn chart_style(&self) -> Option<&'a OwnedRelationship> {
        self.relationships
            .iter()
            .find(|rel| rel.rel_type == OoxmlRelationshipType::ChartStyle)
    }

    pub fn chart_color_style(&self) -> Option<&'a OwnedRelationship> {
        self.relationships
            .iter()
            .find(|rel| rel.rel_type == OoxmlRelationshipType::ChartColorStyle)
    }
}

impl<'a> VmlDrawingRelationships<'a> {
    pub fn images(&self) -> Vec<&'a OwnedRelationship> {
        self.relationships
            .iter()
            .filter(|rel| rel.rel_type == OoxmlRelationshipType::Image)
            .collect()
    }
}

/// Convert an OPC relationship target to a ZIP archive path.
///
/// OPC targets can be relative (`../drawings/drawing1.xml`) or absolute
/// (`/xl/drawings/drawing1.xml`). This normalizes both forms into a ZIP
/// path like `xl/drawings/drawing1.xml`.
///
/// `base_dir` is the directory of the part that owns the relationship
/// (e.g. `"xl/worksheets"` for sheet-level rels, `"xl"` for workbook rels).
/// It is only used when the target is relative.
pub fn opc_target_to_zip_path(target: &str, base_dir: &str) -> String {
    if let Some(stripped) = target.strip_prefix('/') {
        stripped.to_string()
    } else if let Some(rest) = target.strip_prefix("../") {
        // Walk up one level from base_dir, then append the rest.
        let parent = base_dir.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
        if parent.is_empty() {
            rest.to_string()
        } else {
            format!("{}/{}", parent, rest)
        }
    } else {
        format!("{}/{}", base_dir, target)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpcTargetResolutionError {
    EmptyTarget,
    BackslashTarget,
    EscapesPackageRoot,
    InvalidSegment,
}

/// Convert a relationship part path to its owner part.
///
/// `_rels/.rels` is the package-root relationship part and has no owner part.
/// `xl/worksheets/_rels/sheet1.xml.rels` owns `xl/worksheets/sheet1.xml`.
pub fn relationship_owner_from_rels_path(rels_path: &str) -> Option<String> {
    if rels_path == "_rels/.rels" {
        return None;
    }

    let (dir, file) = rels_path.rsplit_once('/')?;
    let owner_file = file.strip_suffix(".rels")?;
    let owner_dir = dir.strip_suffix("/_rels")?;
    if owner_dir.is_empty() {
        Some(owner_file.to_string())
    } else {
        Some(format!("{owner_dir}/{owner_file}"))
    }
}

/// Resolve an internal relationship target against its owner part.
///
/// `owner_part == None` represents the package-root relationship part.
pub fn resolve_relationship_target(
    owner_part: Option<&str>,
    target: &str,
) -> Result<String, OpcTargetResolutionError> {
    if target.is_empty() {
        return Err(OpcTargetResolutionError::EmptyTarget);
    }
    if target.contains('\\') {
        return Err(OpcTargetResolutionError::BackslashTarget);
    }

    let mut segments: Vec<&str> = Vec::new();
    if target.starts_with('/') {
        push_normalized_segments(&mut segments, target.trim_start_matches('/'))?;
    } else {
        if let Some(owner) = owner_part {
            if let Some((dir, _)) = owner.rsplit_once('/') {
                push_normalized_segments(&mut segments, dir)?;
            }
        }
        push_normalized_segments(&mut segments, target)?;
    }

    if segments.is_empty() {
        return Err(OpcTargetResolutionError::EmptyTarget);
    }
    Ok(segments.join("/"))
}

fn push_normalized_segments<'a>(
    segments: &mut Vec<&'a str>,
    path: &'a str,
) -> Result<(), OpcTargetResolutionError> {
    for segment in path.split('/') {
        match segment {
            "" => return Err(OpcTargetResolutionError::InvalidSegment),
            "." => {}
            ".." => {
                if segments.pop().is_none() {
                    return Err(OpcTargetResolutionError::EscapesPackageRoot);
                }
            }
            s => segments.push(s),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absolute_path() {
        assert_eq!(
            opc_target_to_zip_path("/xl/drawings/drawing1.xml", "xl/worksheets"),
            "xl/drawings/drawing1.xml"
        );
    }

    #[test]
    fn relative_path_from_worksheets() {
        assert_eq!(
            opc_target_to_zip_path("../drawings/drawing1.xml", "xl/worksheets"),
            "xl/drawings/drawing1.xml"
        );
    }

    #[test]
    fn relative_path_from_xl() {
        assert_eq!(
            opc_target_to_zip_path("../comments1.xml", "xl/worksheets"),
            "xl/comments1.xml"
        );
    }

    #[test]
    fn same_directory_reference() {
        assert_eq!(
            opc_target_to_zip_path("chart1.xml", "xl/charts"),
            "xl/charts/chart1.xml"
        );
    }

    #[test]
    fn relationship_owner_paths() {
        assert_eq!(relationship_owner_from_rels_path("_rels/.rels"), None);
        assert_eq!(
            relationship_owner_from_rels_path("xl/_rels/workbook.xml.rels").as_deref(),
            Some("xl/workbook.xml")
        );
        assert_eq!(
            relationship_owner_from_rels_path("xl/worksheets/_rels/sheet1.xml.rels").as_deref(),
            Some("xl/worksheets/sheet1.xml")
        );
    }

    #[test]
    fn resolve_relationship_targets() {
        assert_eq!(
            resolve_relationship_target(
                Some("xl/worksheets/sheet1.xml"),
                "../drawings/drawing1.xml"
            )
            .unwrap(),
            "xl/drawings/drawing1.xml"
        );
        assert_eq!(
            resolve_relationship_target(Some("xl/workbook.xml"), "worksheets/sheet1.xml").unwrap(),
            "xl/worksheets/sheet1.xml"
        );
        assert_eq!(
            resolve_relationship_target(None, "xl/workbook.xml").unwrap(),
            "xl/workbook.xml"
        );
        assert_eq!(
            resolve_relationship_target(
                Some("xl/worksheets/sheet1.xml"),
                "/xl/drawings/drawing1.xml"
            )
            .unwrap(),
            "xl/drawings/drawing1.xml"
        );
        assert_eq!(
            resolve_relationship_target(Some("xl/workbook.xml"), "../../evil.xml"),
            Err(OpcTargetResolutionError::EscapesPackageRoot)
        );
    }

    #[test]
    fn typed_relationships_keep_drawing_and_vml_distinct() {
        let rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments3.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>"#;
        let relationships = parse_owned_relationships(
            PackageOwner::Worksheet {
                sheet_index: 3,
                path: "xl/worksheets/sheet3.xml".to_string(),
            },
            rels,
        );
        let worksheet = WorksheetRelationships::new(&relationships);

        assert_eq!(
            worksheet.drawing().and_then(|rel| rel.target.path()),
            Some("xl/drawings/drawing1.xml")
        );
        assert_eq!(worksheet.legacy_vml_drawings().len(), 1);
        assert_eq!(
            worksheet.legacy_vml_drawings()[0].target.path(),
            Some("xl/drawings/vmlDrawing1.vml")
        );
    }

    #[test]
    fn typed_relationships_do_not_classify_near_miss_uris() {
        let rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://example.invalid/relationships/not-a-drawing" Target="../drawings/drawing1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/>
</Relationships>"#;
        let relationships = parse_owned_relationships(
            PackageOwner::Worksheet {
                sheet_index: 1,
                path: "xl/worksheets/sheet1.xml".to_string(),
            },
            rels,
        );
        let worksheet = WorksheetRelationships::new(&relationships);

        assert!(worksheet.drawing().is_none());
        assert_eq!(worksheet.legacy_vml_drawings().len(), 1);
        assert!(matches!(
            worksheet.by_id("rId1").map(|rel| &rel.rel_type),
            Some(OoxmlRelationshipType::Unknown(uri)) if uri == "http://example.invalid/relationships/not-a-drawing"
        ));
    }

    #[test]
    fn typed_relationships_resolve_external_and_owner_relative_targets() {
        let rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
</Relationships>"#;
        let relationships = parse_owned_relationships(
            PackageOwner::Drawing {
                path: "xl/drawings/drawing1.xml".to_string(),
            },
            rels,
        );
        let drawing = DrawingRelationships::new(&relationships);

        assert_eq!(
            drawing.charts()[0].target.path(),
            Some("xl/charts/chart1.xml")
        );
        assert_eq!(
            drawing.by_id("rId2").map(|rel| rel.target_mode),
            Some(RelationshipTargetMode::External)
        );
        assert_eq!(
            drawing.by_id("rId2").map(|rel| rel.target.raw()),
            Some("https://example.com")
        );
    }

    #[test]
    fn known_relationship_types_round_trip_without_unknown_fallback() {
        let known = [
            OoxmlRelationshipType::OfficeDocument,
            OoxmlRelationshipType::CoreProperties,
            OoxmlRelationshipType::ExtendedProperties,
            OoxmlRelationshipType::CustomProperties,
            OoxmlRelationshipType::Worksheet,
            OoxmlRelationshipType::Styles,
            OoxmlRelationshipType::Theme,
            OoxmlRelationshipType::SharedStrings,
            OoxmlRelationshipType::CalcChain,
            OoxmlRelationshipType::Comments,
            OoxmlRelationshipType::ThreadedComments,
            OoxmlRelationshipType::VmlDrawing,
            OoxmlRelationshipType::Drawing,
            OoxmlRelationshipType::Chart,
            OoxmlRelationshipType::ChartEx,
            OoxmlRelationshipType::ChartStyle,
            OoxmlRelationshipType::ChartColorStyle,
            OoxmlRelationshipType::Image,
            OoxmlRelationshipType::Table,
            OoxmlRelationshipType::TableSingleCells,
            OoxmlRelationshipType::PivotTable,
            OoxmlRelationshipType::PivotCacheDefinition,
            OoxmlRelationshipType::PivotCacheRecords,
            OoxmlRelationshipType::Hyperlink,
            OoxmlRelationshipType::PrinterSettings,
            OoxmlRelationshipType::CtrlProp,
            OoxmlRelationshipType::CustomProperty,
            OoxmlRelationshipType::ExternalLink,
            OoxmlRelationshipType::ExternalLinkPath,
            OoxmlRelationshipType::ExternalLinkLongPath,
            OoxmlRelationshipType::XlPathMissing,
            OoxmlRelationshipType::XlLongPathMissing,
            OoxmlRelationshipType::XlStartup,
            OoxmlRelationshipType::XlAlternateStartup,
            OoxmlRelationshipType::XlLibrary,
            OoxmlRelationshipType::XlLongStartup,
            OoxmlRelationshipType::XlLongAlternateStartup,
            OoxmlRelationshipType::XlLongLibrary,
            OoxmlRelationshipType::DiagramData,
            OoxmlRelationshipType::DiagramLayout,
            OoxmlRelationshipType::DiagramColors,
            OoxmlRelationshipType::DiagramQuickStyle,
            OoxmlRelationshipType::DiagramDrawing,
            OoxmlRelationshipType::Slicer,
            OoxmlRelationshipType::SlicerCache,
            OoxmlRelationshipType::Timeline,
            OoxmlRelationshipType::TimelineCache,
            OoxmlRelationshipType::Metadata,
            OoxmlRelationshipType::OleObject,
            OoxmlRelationshipType::Person,
            OoxmlRelationshipType::VbaProject,
        ];

        for rel_type in known {
            assert_eq!(OoxmlRelationshipType::from_uri(rel_type.uri()), rel_type);
        }
    }

    #[test]
    fn external_workbook_base_path_relationships_are_exact() {
        assert!(is_external_workbook_base_path_relationship_type(
            REL_EXTERNAL_LINK_PATH
        ));
        assert!(is_external_workbook_base_path_relationship_type(
            REL_EXTERNAL_LINK_LONG_PATH
        ));
        assert!(is_external_workbook_base_path_relationship_type(
            REL_XL_PATH_MISSING
        ));
        assert!(is_external_workbook_base_path_relationship_type(
            REL_XL_LONG_PATH_MISSING
        ));
        assert!(!is_external_workbook_base_path_relationship_type(
            "http://example.invalid/relationships/externalLinkPath"
        ));
        assert!(!is_missing_external_workbook_path_relationship_type(
            "http://example.invalid/relationships/xlPathMissing"
        ));
    }
}

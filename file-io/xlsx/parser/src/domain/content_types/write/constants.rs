/// Content type for main workbook
pub const CT_WORKBOOK: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";

/// Content type for worksheets
pub const CT_WORKSHEET: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";

/// Content type for styles
pub const CT_STYLES: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml";

/// Content type for shared strings
pub const CT_SHARED_STRINGS: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml";

/// Content type for theme
pub const CT_THEME: &str = "application/vnd.openxmlformats-officedocument.theme+xml";

/// Content type for relationships
pub const CT_RELATIONSHIPS: &str = "application/vnd.openxmlformats-package.relationships+xml";

/// Content type for core properties
pub const CT_CORE_PROPERTIES: &str = "application/vnd.openxmlformats-package.core-properties+xml";

/// Content type for extended properties (app.xml)
pub const CT_EXTENDED_PROPERTIES: &str =
    "application/vnd.openxmlformats-officedocument.extended-properties+xml";

/// Content type for custom properties (custom.xml)
pub const CT_CUSTOM_PROPERTIES: &str =
    "application/vnd.openxmlformats-officedocument.custom-properties+xml";

/// Content type for drawings
pub const CT_DRAWING: &str = "application/vnd.openxmlformats-officedocument.drawing+xml";

/// Content type for charts
pub const CT_CHART: &str = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";

/// Content type for ChartEx parts.
pub(super) const CT_CHART_EX: &str = "application/vnd.ms-office.chartex+xml";

/// Content type for tables
pub const CT_TABLE: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml";

/// Content type for worksheet-owned single-cell XML table bindings.
pub const CT_TABLE_SINGLE_CELLS: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.tableSingleCells+xml";

/// Content type for comments
pub const CT_COMMENTS: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml";

/// Content type for pivot tables
pub const CT_PIVOT_TABLE: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml";

/// Content type for pivot cache definition
pub const CT_PIVOT_CACHE: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml";

/// Content type for printer settings binaries
pub const CT_PRINTER_SETTINGS: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings";

/// Content type for VBA projects
pub const CT_VBA: &str = "application/vnd.ms-office.vbaProject";

/// Content type for slicer parts (x14 extension)
pub const CT_SLICER: &str = "application/vnd.ms-excel.slicer+xml";

/// Content type for slicer cache definitions (x14 extension)
pub const CT_SLICER_CACHE: &str = "application/vnd.ms-excel.slicerCache+xml";

/// Content type for timeline parts (x15 extension)
pub const CT_TIMELINE: &str = "application/vnd.ms-excel.timeline+xml";

/// Content type for timeline cache definitions (x15 extension)
pub const CT_TIMELINE_CACHE: &str = "application/vnd.ms-excel.timelineCache+xml";

/// Content type for generic XML
pub const CT_XML: &str = "application/xml";

/// Content type for SmartArt diagram data
pub const CT_DIAGRAM_DATA: &str =
    "application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml";

/// Content type for SmartArt diagram layout definition
pub const CT_DIAGRAM_LAYOUT: &str =
    "application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml";

/// Content type for SmartArt diagram colors
pub const CT_DIAGRAM_COLORS: &str =
    "application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml";

/// Content type for SmartArt diagram style definition
pub const CT_DIAGRAM_STYLE: &str =
    "application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml";

/// Content type for SmartArt diagram drawing (Microsoft extension)
pub const CT_DIAGRAM_DRAWING: &str = "application/vnd.ms-office.drawingml.diagramDrawing+xml";

/// Content type for chart style (Microsoft 2011 extension)
pub const CT_CHART_STYLE: &str = "application/vnd.ms-office.chartstyle+xml";

/// Content type for chart color style (Microsoft 2011 extension)
pub const CT_CHART_COLOR_STYLE: &str = "application/vnd.ms-office.chartcolorstyle+xml";

/// Content type for PNG images
pub const CT_PNG: &str = "image/png";

/// Content type for JPEG images
pub const CT_JPEG: &str = "image/jpeg";

/// Content type for GIF images
pub const CT_GIF: &str = "image/gif";

/// Content type for EMF images
pub const CT_EMF: &str = "image/x-emf";

/// Content type for WMF images
pub const CT_WMF: &str = "image/x-wmf";

/// Content type for spreadsheet metadata (xl/metadata.xml)
pub const CT_METADATA: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml";

/// Content type for the calculation chain part.
pub const CT_CALC_CHAIN: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml";

/// Content type for the volatile dependencies part.
pub const CT_VOLATILE_DEPENDENCIES: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.volatileDependencies+xml";

/// XML namespace for content types
pub(super) const CONTENT_TYPES_NS: &str =
    "http://schemas.openxmlformats.org/package/2006/content-types";

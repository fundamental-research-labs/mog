//! XLSX writing modules
//!
//! This module provides components for writing XLSX files, including:
//! - ZIP archive writer for the underlying container format
//! - Relationship manager for OPC relationship files
//! - Shared strings table writer for string deduplication
//! - Content types manager for [Content_Types].xml
//! - Workbook writer for xl/workbook.xml
//! - Sheet writer for worksheet XML generation
//! - Theme writer for xl/theme/theme1.xml
//! - Conditional formatting writer for worksheet formatting rules
//! - XML writer utilities
//!
//! # Module Structure
//!
//! - `zip_writer` - Creates ZIP archives for XLSX output
//! - `relationships` - Manages .rels relationship files
//! - `shared_strings` - Shared strings table with deduplication and frequency ordering
//! - `content_types` - Manages [Content_Types].xml manifest
//! - `workbook` - Generates xl/workbook.xml with sheets, defined names, and settings
//! - `sheet` - Generates worksheet XML (xl/worksheets/sheet{n}.xml)
//! - `themes_writer` - Generates xl/theme/theme1.xml with color and font schemes
//! - `cond_format_writer` - Generates conditional formatting rules in worksheets
//! - `xml_writer` - XML writing utilities

pub mod from_parse_output;
pub(crate) mod legacy_vml_ownership;
pub mod mc_builder;

pub mod drawing_writer_helpers;
pub mod package_graph;
pub mod package_ownership;
pub mod pivot_writer;
pub mod relationships;
pub mod sheet;
pub mod write_error;
pub mod xml_writer;
pub mod zip_writer;

pub use crate::domain::comments::write::{
    CommentAuthor, CommentShape, CommentTextRun, CommentsWriter, LegacyComment, ThreadedAuthor,
    ThreadedComment, ThreadedCommentsWriter, ThreadedMention, generate_guid,
};
pub use crate::domain::cond_format::write::{
    AboveAverageRule, CellIsRule, CfOperator, CfRule, CfRuleKind, CfRuleType, CfStyle,
    CfTimePeriod, CfValueObject, CfWriter, CfvoType, ColorScaleRule, ConditionalFormatting,
    DataBarAxisPosition, DataBarRule, IconSetRule, IconSetType, TextRule, Top10Rule,
};
pub use crate::domain::content_types::write::{
    CT_CALC_CHAIN, CT_CHART, CT_COMMENTS, CT_CORE_PROPERTIES, CT_CUSTOM_PROPERTIES,
    CT_DIAGRAM_COLORS, CT_DIAGRAM_DATA, CT_DIAGRAM_DRAWING, CT_DIAGRAM_LAYOUT, CT_DIAGRAM_STYLE,
    CT_DRAWING, CT_EMF, CT_EXTENDED_PROPERTIES, CT_GIF, CT_JPEG, CT_METADATA, CT_PIVOT_CACHE,
    CT_PIVOT_TABLE, CT_PNG, CT_PRINTER_SETTINGS, CT_RELATIONSHIPS, CT_SHARED_STRINGS, CT_SLICER,
    CT_SLICER_CACHE, CT_STYLES, CT_TABLE, CT_TABLE_SINGLE_CELLS, CT_THEME, CT_VBA,
    CT_VOLATILE_DEPENDENCIES, CT_WMF, CT_WORKBOOK, CT_WORKSHEET, CT_XML, ContentTypeDefault,
    ContentTypeOverride, ContentTypesManager, create_xlsx_content_types,
};
pub use crate::domain::controls::write::{
    CONTENT_TYPE_CTRL_PROP, ControlsWriter, REL_CTRL_PROP, ctrl_prop_relationship_target,
};
pub use crate::domain::controls::write_ole::{
    OleWriter, ole_object_relationship_target, ole_object_zip_path,
};
pub use crate::domain::pivot::write::{
    CacheFieldDef, CacheSource, CacheSourceType, DataFieldDef, DataFieldFunction, PivotAxis,
    PivotCacheWriter, PivotFieldDef, PivotFieldItem, PivotItemType, PivotLocation, PivotStyle,
    PivotTableWriter, RowColItem, SharedItem as PivotSharedItem, WorksheetSource,
};
pub use crate::domain::print::write::{HeaderFooter, PrintWriter};
pub use crate::domain::protection::write::{
    ProtectedRange, ProtectedRanges, SheetProtection, SheetProtectionWrite, WorkbookProtection,
    WorkbookProtectionWrite, generate_salt, hash_password_legacy, hash_password_sha512,
};
pub use crate::domain::slicers::write::{
    EXT_URI_SLICER_CACHES, EXT_URI_SLICER_LIST, EXT_URI_TABLE_SLICER_CACHE, NS_MC, NS_X14, NS_X15,
    NS_XR10, write_slicer_cache, write_slicer_part, write_workbook_slicer_caches_ext,
    write_worksheet_slicer_ext,
};
pub use crate::domain::sparklines::write::{
    DisplayEmptyCellsAs as SparklineEmptyDisplay, Sparkline, SparklineAxisType, SparklineColor,
    SparklineGroup, SparklineGroupBuilder, SparklineType, SparklinesWriter,
};
pub use crate::domain::strings::write::{RichTextRun, SharedStringValue, SharedStringsWriter};
pub use crate::domain::styles::write::{
    AlignmentDef, BorderDef, BorderSideDef, BorderStyle, CellStyleDef, CellXfDef, ColorDef,
    ColorsDef, DxfDef, FillDef, FontDef, FontScheme, GradientStop, GradientType, HorizontalAlign,
    NumberFormatDef, PatternType, ProtectionDef, StylesWriter, Stylesheet, TableStyleDef,
    TableStyleElementDef, TableStyleType, UnderlineStyle, VerticalAlign, VerticalAlignRun,
};
pub use crate::domain::tables::write::{
    AutoFilterDef, CustomFilter, DynamicFilterType, FilterColumn, FilterOperator, FilterType,
    SortBy, SortCondition, SortState, TableColumn, TableStyleInfo, TableWriter, TotalsRowFunction,
    default_table_style_info, table_writer_from_domain,
};
pub use crate::domain::themes::write::{
    ColorScheme, ColorSchemeExt, FontCollection, RgbHexColor, ScriptFont, ThemeColorIndex,
    ThemeFontDef, ThemeWriter,
};
pub use crate::domain::validation::write::{
    DataValidation, DataValidationWriter, ErrorStyle, ValidationOperator, ValidationType,
};
pub use crate::domain::workbook::write::{
    CalcMode, CalcSettings, DefinedNameDef, SheetDef, SheetState, WorkbookView, WorkbookWriter,
    calc_settings_for_export, calc_settings_from_domain,
};
pub use from_parse_output::{
    ExportDiagnostic, ExportDiagnosticCode, ExportReport, ExportSemanticImpact,
    write_xlsx_from_parse_output, write_xlsx_from_parse_output_with_report,
};
pub use relationships::{
    REL_CALC_CHAIN, REL_CHART, REL_CHART_EX, REL_COMMENTS, REL_CORE_PROPERTIES,
    REL_CUSTOM_PROPERTIES, REL_DIAGRAM_COLORS, REL_DIAGRAM_DATA, REL_DIAGRAM_DRAWING,
    REL_DIAGRAM_LAYOUT, REL_DIAGRAM_QUICK_STYLE, REL_DRAWING, REL_EXTENDED_PROPERTIES,
    REL_EXTERNAL_LINK, REL_HYPERLINK, REL_METADATA, REL_OFFICE_DOCUMENT, REL_OLE_OBJECT,
    REL_PERSON, REL_PIVOT_CACHE, REL_PIVOT_TABLE, REL_PRINTER_SETTINGS, REL_SHARED_STRINGS,
    REL_SLICER, REL_SLICER_CACHE, REL_STYLES, REL_TABLE, REL_TABLE_SINGLE_CELLS, REL_THEME,
    REL_THREADED_COMMENT, REL_VML_DRAWING, REL_WORKSHEET, RELATIONSHIPS_NS, Relationship,
    RelationshipManager, create_root_rels, create_root_rels_full,
    create_root_rels_full_with_custom, create_sheet_rels, create_workbook_rels,
};
pub use sheet::{
    CellData, CellValue, ColWidth, MergeRange, RowDef, Selection, SheetFormatPr, SheetPane,
    SheetView, SheetViewType, SheetWriter, col_to_letter, to_a1,
};
pub use write_error::WriteError;
pub use xml_writer::{XmlWriteError, XmlWriter};
pub use zip_writer::{CompressionMethod, ZipWriteEntry, ZipWriteError, ZipWriter};

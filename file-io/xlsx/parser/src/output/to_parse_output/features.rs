//! Feature conversions: tables, charts, form controls, OLE objects, connectors,
//! conditional formats, data validations, sparklines, slicers, floating objects,
//! data tables, print settings, page breaks, comment runs, outline groups.

use std::collections::HashMap;

use crate::infra::opc::opc_target_to_zip_path;
use domain_types::domain::floating_object::{
    AnchorMode, ChartDrawingFrameOoxmlProps, ConnectorBinding, ConnectorData, ConnectorOoxmlProps,
    FloatingObject, FloatingObjectAnchor, FloatingObjectCommon, FloatingObjectData,
    FormControlData, FormControlOoxmlProps, OleObjectData, OleObjectOoxmlProps,
    OleObjectPackageIdentity, OleObjectPreviewIdentity, PictureData, PictureOoxmlProps, ShapeData,
    ShapeOoxmlProps,
};
use domain_types::{
    AxisBound, AxisBoundLabel, CFCellRange, CFColorPoint, CFColorScale, CFCustomIcon, CFDataBar,
    CFIconSet, CFIconThreshold, CFRule, CFStyle, ChartDefinition, ChartSpec, ConditionalFormat,
    DataTableRegion, EmptyCellDisplay, ErrorStyle, HeaderFooter, ImportedPrinterSettingsIdentity,
    OutlineGroup, PageBreaks, PageMargins, PrintSettings, PrinterSettingsPageSetupFingerprint,
    RichTextRun, Sparkline as DtSparkline, SparklineAxisSettings, SparklineCellAddress,
    SparklineDataRange, SparklineGroup as DtSparklineGroup, SparklineType as DtSparklineType,
    SparklineVisualSettings, TableColumnSpec, TableSpec, TotalsFunction, ValidationOperator,
    ValidationRule, ValidationSpec,
    chart::{AnchorPosition, ObjectSize},
};

use crate::domain::drawings::{Anchor as DrawingAnchor, Drawing, DrawingContent};
use crate::domain::sparklines::read::SparklineGroup;
use crate::output::results::{
    ColWidth, CommentRunOutput, ConnectorOutput, DataTableInfo, DvSummary, FormControlOutput,
    FullParsedSheet, OleObjectOutput, PageBreaksOutput, ParsedTable, PrintSettingsOutput,
    RowHeight,
};

use super::non_empty;

#[allow(clippy::string_slice)]
mod charts;
mod comments;
#[allow(clippy::string_slice)]
mod conditional_formats;
mod data_tables;
mod floating_objects;
mod legacy_objects;
mod outlines;
mod print;
#[allow(clippy::string_slice)]
mod sparklines;
mod tables;
#[cfg(test)]
mod tests;
mod validations;

#[cfg(test)]
pub(crate) use charts::{
    build_fallback_chart_spec, chart_ex_anchor_position, chart_frames_by_relationship_target,
    chart_ref_extent_from_spec,
};
pub(crate) use charts::{
    convert_parsed_chart_ex_to_chart_specs, convert_parsed_charts_to_chart_specs,
};
pub(crate) use comments::convert_comment_runs;
#[cfg(test)]
pub(crate) use conditional_formats::convert_cf_rule;
pub(crate) use conditional_formats::convert_conditional_formats;
pub(crate) use data_tables::convert_data_tables;
pub(crate) use floating_objects::convert_floating_objects;
pub(crate) use legacy_objects::{convert_connectors, convert_form_controls, convert_ole_objects};
pub(crate) use outlines::compute_outline_groups;
pub(crate) use print::{convert_hf_images, convert_page_breaks, convert_print_settings};
pub(crate) use sparklines::convert_sparkline_groups;
pub(crate) use tables::convert_tables;
pub(crate) use validations::convert_data_validations;

//! Office.js chart title, legend, data-label, and formatting projections.
//!
//! The chart API is backed by the persisted ChartData hierarchy. Every read
//! resolves the current chart through ChartRef, and every write reads the
//! current nested value before sending a complete top-level field back
//! through the compute chart facade. The latter is required because the
//! floating-object update API merges top-level keys and therefore replaces a
//! nested object as a unit.
//!
//! The JavaScript adapter uses these extension operations. The
//! chartId/worksheetId pair is preferred; parentId is accepted when a chart
//! was created and has not loaded its engine ID yet.
//!
//! * chartFormatGetObject binds a title, legend, data-label, format, or
//!   formatting-part object (kind identifies the target).
//! * chartFormatGetLegendEntries binds a legend-entry collection.
//! * chartFormatLegendEntriesGetCount completes a collection count result.
//! * chartFormatLegendEntriesGetItemAt binds one legend entry.
//! * chartFormatFillGetSolidColor completes a fill color result.

use std::collections::HashMap;
use std::sync::Arc;

use compute_api::Sheet;
use domain_types::domain::chart::{
    ChartColorData, ChartDashStyle, ChartFillData, ChartFontData, ChartFormatData, ChartLineData,
    ChartUnderlineStyle,
};
use domain_types::domain::floating_object::{ChartData, FloatingObject, FloatingObjectData};
use serde_json::{Map, Value, json};

use crate::chart_core::{ChartError, ChartRef};
use crate::dispatch::{ExtensionHandler, ExtensionObject, HostDispatchContext};
use crate::host::BatchError;

/// Errors returned by the chart formatting adapter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ChartFormatError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ChartFormatOwner {
    Chart,
    Title,
    Legend,
    DataLabels,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ChartFormatKind {
    Title,
    Legend,
    DataLabels,
    AreaFormat,
    TitleFormat,
    LegendFormat,
    DataLabelFormat,
    LeaderLines,
    LeaderLinesFormat,
    LeaderLinesLine,
    Fill(ChartFormatOwner),
    Font(ChartFormatOwner),
    Border(ChartFormatOwner),
    Line(ChartFormatOwner),
    LegendEntries,
    LegendEntry(usize),
}

impl ChartFormatKind {
    /// Parse the stable wire names emitted by chart_format.js.
    pub(crate) fn from_wire(kind: &str) -> Result<Self, ChartFormatError> {
        let kind = match kind {
            "title" | "chartTitle" => Self::Title,
            "legend" | "chartLegend" => Self::Legend,
            "dataLabels" | "chartDataLabels" => Self::DataLabels,
            "format" | "chartFormat" | "areaFormat" | "chartAreaFormat" => Self::AreaFormat,
            "titleFormat" | "chartTitleFormat" => Self::TitleFormat,
            "legendFormat" | "chartLegendFormat" => Self::LegendFormat,
            "dataLabelFormat" | "chartDataLabelFormat" => Self::DataLabelFormat,
            "leaderLines" | "chartLeaderLines" => Self::LeaderLines,
            "leaderLinesFormat" | "chartLeaderLinesFormat" => Self::LeaderLinesFormat,
            "leaderLinesLine" | "chartLeaderLinesLine" => Self::LeaderLinesLine,
            "areaFill" | "chartFill" | "chartFormatFill" => Self::Fill(ChartFormatOwner::Chart),
            "titleFill" | "titleFormatFill" => Self::Fill(ChartFormatOwner::Title),
            "legendFill" | "legendFormatFill" => Self::Fill(ChartFormatOwner::Legend),
            "dataLabelFill" | "dataLabelsFill" | "dataLabelFormatFill" => {
                Self::Fill(ChartFormatOwner::DataLabels)
            }
            "areaFont" | "chartFont" | "chartFormatFont" => Self::Font(ChartFormatOwner::Chart),
            "titleFont" | "titleFormatFont" => Self::Font(ChartFormatOwner::Title),
            "legendFont" | "legendFormatFont" => Self::Font(ChartFormatOwner::Legend),
            "dataLabelFont" | "dataLabelsFont" | "dataLabelFormatFont" => {
                Self::Font(ChartFormatOwner::DataLabels)
            }
            "areaBorder" | "chartBorder" | "chartFormatBorder" => {
                Self::Border(ChartFormatOwner::Chart)
            }
            "titleBorder" | "titleFormatBorder" => Self::Border(ChartFormatOwner::Title),
            "legendBorder" | "legendFormatBorder" => Self::Border(ChartFormatOwner::Legend),
            "dataLabelBorder" | "dataLabelsBorder" | "dataLabelFormatBorder" => {
                Self::Border(ChartFormatOwner::DataLabels)
            }
            "areaLine" | "chartLine" | "chartFormatLine" => Self::Line(ChartFormatOwner::Chart),
            "titleLine" | "titleFormatLine" => Self::Line(ChartFormatOwner::Title),
            "legendLine" | "legendFormatLine" => Self::Line(ChartFormatOwner::Legend),
            "dataLabelLine" | "dataLabelsLine" | "dataLabelFormatLine" => {
                Self::Line(ChartFormatOwner::DataLabels)
            }
            _ => {
                return Err(unsupported(format!(
                    "Unsupported chart formatting kind '{kind}'"
                )));
            }
        };
        Ok(kind)
    }
}

/// A typed chart child reference. It deliberately stores only a stable ChartRef
/// and a target selector; no mutable formatting state is cached.
#[derive(Clone)]
pub(crate) struct ChartFormatRef {
    chart: ChartRef,
    kind: ChartFormatKind,
}

impl ChartFormatRef {
    pub(crate) fn new(
        sheet: Sheet,
        chart_id: impl Into<String>,
        kind: &str,
    ) -> Result<Self, ChartFormatError> {
        Self::from_chart(ChartRef::new(sheet, chart_id), kind)
    }

    pub(crate) fn from_chart(chart: ChartRef, kind: &str) -> Result<Self, ChartFormatError> {
        Ok(Self {
            chart,
            kind: ChartFormatKind::from_wire(kind)?,
        })
    }

    pub(crate) fn from_target(chart: ChartRef, kind: ChartFormatKind) -> Self {
        Self { chart, kind }
    }

    pub(crate) fn chart(&self) -> &ChartRef {
        &self.chart
    }

    pub(crate) fn kind(&self) -> ChartFormatKind {
        self.kind
    }

    pub(crate) fn load_properties(
        &self,
        properties: &[String],
    ) -> Result<HashMap<String, Value>, ChartFormatError> {
        let chart = self.chart_data()?;
        let mut result = HashMap::new();
        for property in properties {
            let value = match self.kind {
                ChartFormatKind::Title => load_title_property(&chart, property)?,
                ChartFormatKind::Legend => load_legend_property(&chart, property)?,
                ChartFormatKind::DataLabels => load_data_labels_property(&chart, property)?,
                ChartFormatKind::AreaFormat => load_area_format_property(&chart, property)?,
                ChartFormatKind::TitleFormat
                | ChartFormatKind::LegendFormat
                | ChartFormatKind::DataLabelFormat
                | ChartFormatKind::LeaderLines
                | ChartFormatKind::LeaderLinesFormat => {
                    return Err(unsupported(format!(
                        "Chart format navigation property '{property}' is not scalar"
                    )));
                }
                ChartFormatKind::Fill(owner) => load_fill_property(&chart, owner, property)?,
                ChartFormatKind::Font(owner) => load_font_property(&chart, owner, property)?,
                ChartFormatKind::Border(owner) | ChartFormatKind::Line(owner) => {
                    load_line_property(&chart, owner, property)?
                }
                ChartFormatKind::LeaderLinesLine => load_leader_line_property(&chart, property)?,
                ChartFormatKind::LegendEntries | ChartFormatKind::LegendEntry(_) => {
                    return Err(unsupported(format!(
                        "Chart formatting target cannot load '{property}'"
                    )));
                }
            };
            result.insert(property.clone(), value);
        }
        Ok(result)
    }

    pub(crate) fn set_property(
        &self,
        property: &str,
        value: &Value,
    ) -> Result<(), ChartFormatError> {
        match self.kind {
            ChartFormatKind::Title => self.set_title_property(property, value),
            ChartFormatKind::Legend => self.set_legend_property(property, value),
            ChartFormatKind::DataLabels => self.set_data_labels_property(property, value),
            ChartFormatKind::AreaFormat => self.set_area_format_property(property, value),
            ChartFormatKind::TitleFormat
            | ChartFormatKind::LegendFormat
            | ChartFormatKind::DataLabelFormat
            | ChartFormatKind::LeaderLines
            | ChartFormatKind::LeaderLinesFormat => Err(unsupported(format!(
                "Chart format navigation property '{property}' is read-only"
            ))),
            ChartFormatKind::Fill(owner) => self.set_fill_property(owner, property, value),
            ChartFormatKind::Font(owner) => self.set_font_property(owner, property, value),
            ChartFormatKind::Border(owner) | ChartFormatKind::Line(owner) => {
                self.set_line_property(owner, property, value)
            }
            ChartFormatKind::LeaderLinesLine => self.set_leader_line_property(property, value),
            ChartFormatKind::LegendEntries => Err(unsupported(format!(
                "Chart legend entry collection property '{property}' is read-only"
            ))),
            ChartFormatKind::LegendEntry(index) => {
                if property != "visible" {
                    return Err(unsupported(format!(
                        "ChartLegendEntry.{property} is read-only or unsupported"
                    )));
                }
                let visible = boolean(value, property)?;
                self.set_legend_entry(index, visible)
            }
        }
    }

    pub(crate) fn solid_color(&self) -> Result<Value, ChartFormatError> {
        let ChartFormatKind::Fill(owner) = self.kind else {
            return Err(unsupported(
                "getSolidColor is only available on ChartFill".to_string(),
            ));
        };
        let chart = self.chart_data()?;
        let Some(format) = format_for(&chart, owner) else {
            return Ok(Value::Null);
        };
        let Some(ChartFillData::Solid { color, .. }) = format.fill.as_ref() else {
            return Ok(Value::Null);
        };
        color_value(color)
    }

    fn chart_data(&self) -> Result<ChartData, ChartFormatError> {
        let snapshot = self.chart.snapshot().map_err(chart_error)?;
        let object: FloatingObject = serde_json::from_value(snapshot).map_err(encoding)?;
        match object.data {
            FloatingObjectData::Chart(chart) => Ok(chart),
            _ => Err(invalid("The referenced floating object is not a chart")),
        }
    }

    fn update_field(&self, field: &str, value: Value) -> Result<(), ChartFormatError> {
        self.chart
            .update_fields(&json!({ field: value }))
            .map_err(chart_error)
    }

    fn update_format<F>(&self, owner: ChartFormatOwner, mutate: F) -> Result<(), ChartFormatError>
    where
        F: FnOnce(&mut ChartFormatData) -> Result<(), ChartFormatError>,
    {
        let chart = self.chart_data()?;
        let mut format = format_for(&chart, owner)
            .cloned()
            .unwrap_or_else(empty_format);
        mutate(&mut format)?;
        let serialized = serde_json::to_value(format).map_err(encoding)?;
        match owner {
            ChartFormatOwner::Chart => self.update_field("chartFormat", serialized),
            ChartFormatOwner::Title => self.update_field("titleFormat", serialized),
            ChartFormatOwner::Legend => {
                let chart = self.chart_data()?;
                let mut legend = chart.legend.clone().unwrap_or_else(default_legend);
                legend.format = Some(serde_json::from_value(serialized).map_err(encoding)?);
                self.update_field("legend", serde_json::to_value(legend).map_err(encoding)?)
            }
            ChartFormatOwner::DataLabels => {
                let chart = self.chart_data()?;
                let mut labels = chart
                    .data_labels
                    .clone()
                    .unwrap_or_else(default_data_labels);
                labels.visual_format = Some(serde_json::from_value(serialized).map_err(encoding)?);
                self.update_field(
                    "dataLabels",
                    serde_json::to_value(labels).map_err(encoding)?,
                )
            }
        }
    }

    fn update_legend<F>(&self, mutate: F) -> Result<(), ChartFormatError>
    where
        F: FnOnce(&mut domain_types::domain::chart::LegendData) -> Result<(), ChartFormatError>,
    {
        let chart = self.chart_data()?;
        let mut legend = chart.legend.clone().unwrap_or_else(default_legend);
        mutate(&mut legend)?;
        self.update_field("legend", serde_json::to_value(legend).map_err(encoding)?)
    }

    fn update_data_labels<F>(&self, mutate: F) -> Result<(), ChartFormatError>
    where
        F: FnOnce(&mut domain_types::domain::chart::DataLabelData) -> Result<(), ChartFormatError>,
    {
        let chart = self.chart_data()?;
        let mut labels = chart
            .data_labels
            .clone()
            .unwrap_or_else(default_data_labels);
        mutate(&mut labels)?;
        self.update_field(
            "dataLabels",
            serde_json::to_value(labels).map_err(encoding)?,
        )
    }

    fn set_title_property(&self, property: &str, value: &Value) -> Result<(), ChartFormatError> {
        match property {
            "text" => self.update_field("title", string(value, property).map(Value::String)?),
            "visible" => {
                let visible = boolean(value, property)?;
                self.update_field("autoTitleDeleted", Value::Bool(!visible))
            }
            "horizontalAlignment" => self.update_field(
                "titleHAlign",
                Value::String(title_horizontal_alignment(value, property)?.to_string()),
            ),
            "verticalAlignment" => self.update_field(
                "titleVAlign",
                Value::String(title_vertical_alignment(value, property)?.to_string()),
            ),
            "showShadow" => {
                self.update_field("titleShowShadow", Value::Bool(boolean(value, property)?))
            }
            "textOrientation" => {
                let orientation = text_orientation(value, property)?;
                self.update_format(ChartFormatOwner::Title, |format| {
                    format.text_rotation = Some(orientation);
                    Ok(())
                })
            }
            "overlay" | "position" => Err(unsupported(format!(
                "ChartTitle.{property} has no persisted chart-data representation"
            ))),
            "height" | "left" | "top" | "width" => Err(read_only(property, "ChartTitle")),
            other => Err(unsupported(format!("ChartTitle.{other} is unsupported"))),
        }
    }

    fn set_legend_property(&self, property: &str, value: &Value) -> Result<(), ChartFormatError> {
        match property {
            "visible" => {
                let visible = boolean(value, property)?;
                self.update_legend(|legend| {
                    legend.visible = visible;
                    legend.show = visible;
                    Ok(())
                })
            }
            "overlay" => {
                let overlay = boolean(value, property)?;
                self.update_legend(|legend| {
                    legend.overlay = Some(overlay);
                    Ok(())
                })
            }
            "position" => {
                let position = legend_position(value, property)?;
                self.update_legend(|legend| {
                    legend.position = position.to_string();
                    Ok(())
                })
            }
            "showShadow" => {
                let show_shadow = boolean(value, property)?;
                self.update_legend(|legend| {
                    legend.show_shadow = Some(show_shadow);
                    Ok(())
                })
            }
            "height" | "left" | "top" | "width" => Err(read_only(property, "ChartLegend")),
            "legendEntries" => Err(read_only(property, "ChartLegend")),
            other => Err(unsupported(format!("ChartLegend.{other} is unsupported"))),
        }
    }

    fn set_data_labels_property(
        &self,
        property: &str,
        value: &Value,
    ) -> Result<(), ChartFormatError> {
        match property {
            "autoText" => self.update_data_labels(|labels| {
                labels.auto_text = Some(boolean(value, property)?);
                Ok(())
            }),
            "geometricShapeType" => self.update_data_labels(|labels| {
                labels.geometric_shape_type = Some(string(value, property)?);
                Ok(())
            }),
            "horizontalAlignment" => {
                let alignment = data_label_horizontal_alignment(value, property)?.to_string();
                self.update_data_labels(|labels| {
                    labels.horizontal_alignment = Some(alignment);
                    Ok(())
                })
            }
            "linkNumberFormat" => self.update_data_labels(|labels| {
                labels.link_number_format = Some(boolean(value, property)?);
                Ok(())
            }),
            "numberFormat" => self.update_data_labels(|labels| {
                labels.number_format = Some(string(value, property)?);
                Ok(())
            }),
            "position" => {
                let position = data_label_position(value, property)?.to_string();
                self.update_data_labels(|labels| {
                    labels.position = Some(position);
                    Ok(())
                })
            }
            "separator" => self.update_data_labels(|labels| {
                labels.separator = Some(string(value, property)?);
                Ok(())
            }),
            "showBubbleSize" => self.update_data_labels(|labels| {
                let value = boolean(value, property)?;
                labels.show_bubble_size = Some(value);
                recompute_label_visibility(labels);
                Ok(())
            }),
            "showCategoryName" => self.update_data_labels(|labels| {
                let value = boolean(value, property)?;
                labels.show_category_name = Some(value);
                recompute_label_visibility(labels);
                Ok(())
            }),
            "showLeaderLines" => self.update_data_labels(|labels| {
                labels.show_leader_lines = Some(boolean(value, property)?);
                Ok(())
            }),
            "showLegendKey" => self.update_data_labels(|labels| {
                let value = boolean(value, property)?;
                labels.show_legend_key = Some(value);
                recompute_label_visibility(labels);
                Ok(())
            }),
            "showPercentage" => self.update_data_labels(|labels| {
                let value = boolean(value, property)?;
                labels.show_percentage = Some(value);
                recompute_label_visibility(labels);
                Ok(())
            }),
            "showSeriesName" => self.update_data_labels(|labels| {
                let value = boolean(value, property)?;
                labels.show_series_name = Some(value);
                recompute_label_visibility(labels);
                Ok(())
            }),
            "showValue" => self.update_data_labels(|labels| {
                let value = boolean(value, property)?;
                labels.show_value = Some(value);
                recompute_label_visibility(labels);
                Ok(())
            }),
            "textOrientation" => {
                let orientation = text_orientation(value, property)?;
                self.update_data_labels(|labels| {
                    labels.text_orientation = Some(orientation);
                    let format = labels.visual_format.get_or_insert_with(empty_format);
                    format.text_rotation = Some(orientation);
                    Ok(())
                })
            }
            "verticalAlignment" => {
                let alignment = data_label_vertical_alignment(value, property)?.to_string();
                self.update_data_labels(|labels| {
                    labels.vertical_alignment = Some(alignment);
                    Ok(())
                })
            }
            "showAsStickyCallout" => Err(read_only(property, "ChartDataLabels")),
            other => Err(unsupported(format!(
                "ChartDataLabels.{other} is unsupported"
            ))),
        }
    }

    fn set_area_format_property(
        &self,
        property: &str,
        value: &Value,
    ) -> Result<(), ChartFormatError> {
        match property {
            "colorScheme" => {
                let scheme = color_scheme(value, property)?;
                self.update_field("colorScheme", json!(scheme))
            }
            "roundedCorners" => {
                self.update_field("roundedCorners", Value::Bool(boolean(value, property)?))
            }
            other => Err(unsupported(format!(
                "ChartAreaFormat.{other} is unsupported"
            ))),
        }
    }

    fn set_fill_property(
        &self,
        owner: ChartFormatOwner,
        property: &str,
        value: &Value,
    ) -> Result<(), ChartFormatError> {
        match property {
            "solidColor" | "setSolidColor" => {
                let color = parse_color(value, property)?;
                self.update_format(owner, |format| {
                    format.fill = Some(ChartFillData::Solid {
                        color,
                        transparency: None,
                    });
                    Ok(())
                })
            }
            "clear" => self.update_format(owner, |format| {
                if !value.is_null() {
                    return Err(invalid("ChartFill.clear does not accept a value"));
                }
                format.fill = Some(ChartFillData::NoFill);
                Ok(())
            }),
            other => Err(unsupported(format!("ChartFill.{other} is unsupported"))),
        }
    }

    fn set_font_property(
        &self,
        owner: ChartFormatOwner,
        property: &str,
        value: &Value,
    ) -> Result<(), ChartFormatError> {
        self.update_format(owner, |format| {
            let font = format.font.get_or_insert_with(empty_font);
            match property {
                "bold" => font.bold = Some(boolean(value, property)?),
                "color" => font.color = Some(parse_color(value, property)?),
                "italic" => font.italic = Some(boolean(value, property)?),
                "name" => {
                    let name = string(value, property)?;
                    let length = name.chars().count();
                    if !(1..=31).contains(&length) {
                        return Err(invalid(
                            "ChartFont.name must contain 1 through 31 characters",
                        ));
                    }
                    font.name = Some(name);
                }
                "size" => {
                    let size = finite_number(value, property)?;
                    if !(1.0..=409.0).contains(&size) {
                        return Err(invalid("ChartFont.size must be between 1 and 409 points"));
                    }
                    font.size = Some(size);
                }
                "underline" => font.underline = Some(underline(value, property)?),
                other => return Err(unsupported(format!("ChartFont.{other} is unsupported"))),
            }
            Ok(())
        })
    }

    fn set_line_property(
        &self,
        owner: ChartFormatOwner,
        property: &str,
        value: &Value,
    ) -> Result<(), ChartFormatError> {
        self.update_format(owner, |format| {
            let line = format.line.get_or_insert_with(empty_line);
            match property {
                "color" => {
                    line.color = Some(parse_color(value, property)?);
                    line.no_fill = Some(false);
                }
                "lineStyle" => {
                    let (style, no_fill) = line_style(value, property)?;
                    line.dash_style = style;
                    line.no_fill = Some(no_fill);
                }
                "weight" => {
                    let weight = finite_number(value, property)?;
                    if weight < 0.0 {
                        return Err(invalid("ChartLineFormat.weight must be non-negative"));
                    }
                    line.width = Some(weight);
                }
                "clear" => {
                    if !value.is_null() {
                        return Err(invalid("ChartLineFormat.clear does not accept a value"));
                    }
                    line.color = None;
                    line.width = None;
                    line.dash_style = None;
                    line.transparency = None;
                    line.no_fill = Some(true);
                }
                other => {
                    return Err(unsupported(format!(
                        "ChartLineFormat.{other} is unsupported"
                    )));
                }
            }
            Ok(())
        })
    }

    fn set_leader_line_property(
        &self,
        property: &str,
        value: &Value,
    ) -> Result<(), ChartFormatError> {
        let chart = self.chart_data()?;
        let mut labels = chart
            .data_labels
            .clone()
            .unwrap_or_else(default_data_labels);
        let line = labels.leader_lines_format.get_or_insert_with(empty_line);
        match property {
            "color" => {
                line.color = Some(parse_color(value, property)?);
                line.no_fill = Some(false);
            }
            "lineStyle" => {
                let (style, no_fill) = line_style(value, property)?;
                line.dash_style = style;
                line.no_fill = Some(no_fill);
            }
            "weight" => {
                let weight = finite_number(value, property)?;
                if weight < 0.0 {
                    return Err(invalid("ChartLineFormat.weight must be non-negative"));
                }
                line.width = Some(weight);
            }
            "clear" => {
                if !value.is_null() {
                    return Err(invalid("ChartLineFormat.clear does not accept a value"));
                }
                line.color = None;
                line.width = None;
                line.dash_style = None;
                line.transparency = None;
                line.no_fill = Some(true);
            }
            other => {
                return Err(unsupported(format!(
                    "ChartLineFormat.{other} is unsupported"
                )));
            }
        }
        self.update_field(
            "dataLabels",
            serde_json::to_value(labels).map_err(encoding)?,
        )
    }

    fn set_legend_entry(&self, index: usize, visible: bool) -> Result<(), ChartFormatError> {
        let chart = self.chart_data()?;
        let mut legend = chart.legend.clone().unwrap_or_else(default_legend);
        let entries = legend.entries.get_or_insert_with(Vec::new);
        let Some(entry) = entries.get_mut(index) else {
            return Err(item_not_found(&index.to_string(), "legend entry"));
        };
        entry.visible = Some(visible);
        entry.delete = Some(!visible);
        self.update_field("legend", serde_json::to_value(legend).map_err(encoding)?)
    }
}

impl ExtensionObject for ChartFormatRef {
    fn object_type(&self) -> &'static str {
        "ChartFormat"
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        self.load_properties(properties).map_err(batch_error)
    }

    fn set(&self, property: &str, value: &Value) -> Result<(), BatchError> {
        self.set_property(property, value).map_err(batch_error)
    }
}

/// Host-side legend-entry collection. Collection items are bound by the JS
/// item factory, so the engine remains the authority for every entry read and
/// write while the collection can use the normal Office.js hydration shape.
#[derive(Clone)]
pub(crate) struct ChartLegendEntriesRef {
    chart: ChartRef,
}

impl ChartLegendEntriesRef {
    pub(crate) fn new(chart: ChartRef) -> Self {
        Self { chart }
    }

    fn entries(
        &self,
    ) -> Result<Vec<domain_types::domain::chart::LegendEntryData>, ChartFormatError> {
        let snapshot = self.chart.snapshot().map_err(chart_error)?;
        let object: FloatingObject = serde_json::from_value(snapshot).map_err(encoding)?;
        let FloatingObjectData::Chart(chart) = object.data else {
            return Err(invalid("The referenced floating object is not a chart"));
        };
        Ok(chart
            .legend
            .and_then(|legend| legend.entries)
            .unwrap_or_default())
    }

    pub(crate) fn count(&self) -> Result<usize, ChartFormatError> {
        Ok(self.entries()?.len())
    }

    pub(crate) fn item(&self, index: usize) -> ChartFormatRef {
        ChartFormatRef::from_target(self.chart.clone(), ChartFormatKind::LegendEntry(index))
    }

    pub(crate) fn load_collection(
        &self,
        properties: &[String],
    ) -> Result<HashMap<String, Value>, ChartFormatError> {
        let mut result = HashMap::new();
        if properties
            .iter()
            .any(|p| p == "items" || p.starts_with("items/"))
        {
            let item_properties: Vec<String> = properties
                .iter()
                .filter_map(|property| property.strip_prefix("items/"))
                .filter(|property| !property.is_empty())
                .map(ToString::to_string)
                .collect();
            let item_properties = if item_properties.is_empty() {
                vec!["index".to_string(), "visible".to_string()]
            } else {
                item_properties
            };
            let entries = self.entries()?;
            let mut descriptors = Vec::with_capacity(entries.len());
            for index in 0..entries.len() {
                let reference = self.item(index);
                descriptors.push(json!({
                    "key": index.to_string(),
                    "properties": reference.load_properties(&item_properties)?,
                }));
            }
            result.insert("items".to_string(), Value::Array(descriptors));
        }
        Ok(result)
    }
}

impl ExtensionObject for ChartLegendEntriesRef {
    fn object_type(&self) -> &'static str {
        "ChartLegendEntryCollection"
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        self.load_collection(properties).map_err(batch_error)
    }

    fn set(&self, property: &str, _value: &Value) -> Result<(), BatchError> {
        Err(batch_error(unsupported(format!(
            "ChartLegendEntryCollection.{property} is read-only"
        ))))
    }
}

/// Extension operation handler used by the host integrator.
pub(crate) struct ChartFormatExtensionHandler;

impl ExtensionHandler for ChartFormatExtensionHandler {
    fn can_handle(&self, operation: &str) -> bool {
        matches!(
            operation,
            "chartFormatGetObject"
                | "chartFormatGetLegendEntries"
                | "chartFormatLegendEntriesGetCount"
                | "chartFormatLegendEntriesGetItemAt"
                | "chartFormatFillGetSolidColor"
        )
    }

    fn handle(
        &self,
        operation: &Value,
        context: &mut HostDispatchContext<'_>,
    ) -> Result<(), BatchError> {
        let op = operation
            .get("op")
            .and_then(Value::as_str)
            .ok_or_else(|| batch_error(invalid("Chart formatting operation has no op")))?;
        match op {
            "chartFormatGetLegendEntries" => {
                let id = required_field(operation, "id")?;
                let chart = chart_from_operation(operation, context)?;
                context.bind_object(&id, Arc::new(ChartLegendEntriesRef::new(chart)));
            }
            "chartFormatLegendEntriesGetCount" => {
                let result_id = required_field(operation, "resultId")?;
                let parent_id = required_field(operation, "collectionId")?;
                let collection = context.extension_object::<ChartLegendEntriesRef>(&parent_id)?;
                let count = collection.count().map_err(batch_error)?;
                context.set_result(&result_id, json!(count));
            }
            "chartFormatLegendEntriesGetItemAt" => {
                let id = required_field(operation, "id")?;
                let index = operation
                    .get("index")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| batch_error(invalid("legend entry index must be an integer")))?;
                let chart = chart_from_operation(operation, context)?;
                let reference = ChartFormatRef::from_target(
                    chart,
                    ChartFormatKind::LegendEntry(index as usize),
                );
                context.bind_object(&id, Arc::new(reference));
            }
            "chartFormatFillGetSolidColor" => {
                let result_id = required_field(operation, "resultId")?;
                let chart = chart_from_operation(operation, context)?;
                let kind = operation
                    .get("kind")
                    .and_then(Value::as_str)
                    .ok_or_else(|| batch_error(invalid("ChartFill operation has no kind")))?;
                let reference = ChartFormatRef::from_chart(chart, kind).map_err(batch_error)?;
                context.set_result(&result_id, reference.solid_color().map_err(batch_error)?);
            }
            "chartFormatGetObject" => {
                let id = required_field(operation, "id")?;
                let kind = operation
                    .get("kind")
                    .and_then(Value::as_str)
                    .ok_or_else(|| batch_error(invalid("Chart formatting object has no kind")))?;
                let chart = chart_from_operation(operation, context)?;
                let reference = ChartFormatRef::from_chart(chart, kind).map_err(batch_error)?;
                context.bind_object(&id, Arc::new(reference));
            }
            _ => unreachable!("can_handle filters chart formatting operations"),
        }
        Ok(())
    }
}

fn chart_from_operation(
    operation: &Value,
    context: &HostDispatchContext<'_>,
) -> Result<ChartRef, BatchError> {
    if let Some(parent_id) = operation.get("parentId").and_then(Value::as_str)
        && let Ok(chart) = context.extension_object::<ChartRef>(parent_id)
    {
        return Ok((*chart).clone());
    }

    let chart_id = required_field(operation, "chartId")?;
    let worksheet_id = required_field(operation, "worksheetId")?;
    let worksheet = context.worksheet(&worksheet_id)?;
    Ok(ChartRef::new(worksheet.sheet(), chart_id))
}

fn required_field(operation: &Value, field: &str) -> Result<String, BatchError> {
    operation
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| {
            batch_error(invalid(format!(
                "Chart formatting operation requires {field}"
            )))
        })
}

fn load_title_property(chart: &ChartData, property: &str) -> Result<Value, ChartFormatError> {
    match property {
        "text" => Ok(Value::String(chart.title.clone().unwrap_or_default())),
        "visible" => Ok(Value::Bool(title_visible(chart))),
        "horizontalAlignment" => Ok(Value::String(
            read_alignment(
                chart.title_h_align.as_deref(),
                "Center",
                &["left", "center", "right"],
            )?
            .to_string(),
        )),
        "verticalAlignment" => Ok(Value::String(
            read_alignment(
                chart.title_v_align.as_deref(),
                "Center",
                &["top", "middle", "bottom"],
            )?
            .to_string(),
        )),
        "showShadow" => Ok(Value::Bool(chart.title_show_shadow.unwrap_or(false))),
        "textOrientation" => Ok(json!(
            chart
                .title_format
                .as_ref()
                .and_then(|format| format.text_rotation)
                .unwrap_or(0.0)
        )),
        "height" | "left" | "top" | "width" => Ok(Value::Null),
        "overlay" | "position" => Err(unsupported(format!(
            "ChartTitle.{property} has no persisted chart-data representation"
        ))),
        other => Err(unsupported(format!("ChartTitle.{other} is unsupported"))),
    }
}

fn load_legend_property(chart: &ChartData, property: &str) -> Result<Value, ChartFormatError> {
    let legend = chart.legend.as_ref();
    match property {
        "visible" => Ok(Value::Bool(legend.is_some_and(|legend| legend.visible))),
        "overlay" => Ok(Value::Bool(
            legend.and_then(|legend| legend.overlay).unwrap_or(false),
        )),
        "position" => Ok(Value::String(legend_position_read(
            legend
                .map(|legend| legend.position.as_str())
                .unwrap_or("right"),
        )?)),
        "showShadow" => Ok(Value::Bool(
            legend
                .and_then(|legend| legend.show_shadow)
                .or_else(|| legend.and_then(|legend| legend.shadow.as_ref()?.visible))
                .unwrap_or(false),
        )),
        "height" | "left" | "top" | "width" => Ok(Value::Null),
        "legendEntries" => Err(unsupported(
            "ChartLegend.legendEntries is a navigation property".to_string(),
        )),
        other => Err(unsupported(format!("ChartLegend.{other} is unsupported"))),
    }
}

fn load_data_labels_property(chart: &ChartData, property: &str) -> Result<Value, ChartFormatError> {
    let labels = chart.data_labels.as_ref();
    match property {
        "autoText" => Ok(Value::Bool(
            labels.and_then(|labels| labels.auto_text).unwrap_or(true),
        )),
        "geometricShapeType" => Ok(labels
            .and_then(|labels| labels.geometric_shape_type.clone())
            .map(Value::String)
            .unwrap_or(Value::Null)),
        "horizontalAlignment" => Ok(Value::String(read_alignment(
            labels.and_then(|labels| labels.horizontal_alignment.as_deref()),
            "Center",
            &["left", "center", "right"],
        )?)),
        "linkNumberFormat" => Ok(Value::Bool(
            labels
                .and_then(|labels| labels.link_number_format)
                .unwrap_or(false),
        )),
        "numberFormat" => Ok(Value::String(
            labels
                .and_then(|labels| {
                    labels
                        .number_format
                        .clone()
                        .or_else(|| labels.format.clone())
                })
                .unwrap_or_else(|| "General".to_string()),
        )),
        "position" => Ok(Value::String(data_label_position_read(
            labels.and_then(|labels| labels.position.as_deref()),
        )?)),
        "separator" => Ok(Value::String(
            labels
                .and_then(|labels| labels.separator.clone())
                .unwrap_or_else(|| ",".to_string()),
        )),
        "showAsStickyCallout" => Ok(Value::Bool(labels.is_some_and(|labels| {
            labels
                .geometric_shape_type
                .as_deref()
                .is_some_and(is_sticky_callout)
        }))),
        "showBubbleSize" => Ok(Value::Bool(
            labels
                .and_then(|labels| labels.show_bubble_size)
                .unwrap_or(false),
        )),
        "showCategoryName" => Ok(Value::Bool(
            labels
                .and_then(|labels| labels.show_category_name)
                .unwrap_or(false),
        )),
        "showLeaderLines" => Ok(Value::Bool(
            labels
                .and_then(|labels| labels.show_leader_lines)
                .unwrap_or(false),
        )),
        "showLegendKey" => Ok(Value::Bool(
            labels
                .and_then(|labels| labels.show_legend_key)
                .unwrap_or(false),
        )),
        "showPercentage" => Ok(Value::Bool(
            labels
                .and_then(|labels| labels.show_percentage)
                .unwrap_or(false),
        )),
        "showSeriesName" => Ok(Value::Bool(
            labels
                .and_then(|labels| labels.show_series_name)
                .unwrap_or(false),
        )),
        "showValue" => Ok(Value::Bool(
            labels.and_then(|labels| labels.show_value).unwrap_or(false),
        )),
        "textOrientation" => Ok(json!(
            labels
                .and_then(|labels| {
                    labels.text_orientation.or_else(|| {
                        labels
                            .visual_format
                            .as_ref()
                            .and_then(|format| format.text_rotation)
                    })
                })
                .unwrap_or(0.0)
        )),
        "verticalAlignment" => Ok(Value::String(read_alignment(
            labels.and_then(|labels| labels.vertical_alignment.as_deref()),
            "Center",
            &["top", "middle", "bottom"],
        )?)),
        other => Err(unsupported(format!(
            "ChartDataLabels.{other} is unsupported"
        ))),
    }
}

fn load_area_format_property(chart: &ChartData, property: &str) -> Result<Value, ChartFormatError> {
    match property {
        "colorScheme" => Ok(Value::String(color_scheme_read(chart.color_scheme)?)),
        "roundedCorners" => Ok(Value::Bool(chart.rounded_corners.unwrap_or(false))),
        other => Err(unsupported(format!(
            "ChartAreaFormat.{other} is unsupported"
        ))),
    }
}

fn load_fill_property(
    chart: &ChartData,
    owner: ChartFormatOwner,
    property: &str,
) -> Result<Value, ChartFormatError> {
    if property != "solidColor" {
        return Err(unsupported(format!("ChartFill.{property} is unsupported")));
    }
    let Some(format) = format_for(chart, owner) else {
        return Ok(Value::Null);
    };
    let Some(ChartFillData::Solid { color, .. }) = format.fill.as_ref() else {
        return Ok(Value::Null);
    };
    color_value(color)
}

fn load_font_property(
    chart: &ChartData,
    owner: ChartFormatOwner,
    property: &str,
) -> Result<Value, ChartFormatError> {
    let font = format_for(chart, owner).and_then(|format| format.font.as_ref());
    match property {
        "bold" => Ok(Value::Bool(
            font.and_then(|font| font.bold).unwrap_or(false),
        )),
        "color" => match font.and_then(|font| font.color.as_ref()) {
            Some(color) => color_value(color),
            None => Ok(Value::String("#000000".to_string())),
        },
        "italic" => Ok(Value::Bool(
            font.and_then(|font| font.italic).unwrap_or(false),
        )),
        "name" => Ok(Value::String(
            font.and_then(|font| font.name.clone())
                .unwrap_or_else(|| "Calibri".to_string()),
        )),
        "size" => Ok(json!(font.and_then(|font| font.size).unwrap_or(11.0))),
        "underline" => Ok(Value::String(underline_read(
            font.and_then(|font| font.underline.as_ref()),
        )?)),
        other => Err(unsupported(format!("ChartFont.{other} is unsupported"))),
    }
}

fn load_line_property(
    chart: &ChartData,
    owner: ChartFormatOwner,
    property: &str,
) -> Result<Value, ChartFormatError> {
    let line = format_for(chart, owner).and_then(|format| format.line.as_ref());
    match property {
        "color" => match line.and_then(|line| line.color.as_ref()) {
            Some(color) => color_value(color),
            None => Ok(Value::String("#000000".to_string())),
        },
        "lineStyle" => Ok(Value::String(line_style_read(line)?)),
        "weight" => Ok(json!(line.and_then(|line| line.width).unwrap_or(0.0))),
        other => Err(unsupported(format!(
            "ChartLineFormat.{other} is unsupported"
        ))),
    }
}

fn load_leader_line_property(chart: &ChartData, property: &str) -> Result<Value, ChartFormatError> {
    let line = chart
        .data_labels
        .as_ref()
        .and_then(|labels| labels.leader_lines_format.as_ref());
    match property {
        "color" => match line.and_then(|line| line.color.as_ref()) {
            Some(color) => color_value(color),
            None => Ok(Value::String("#000000".to_string())),
        },
        "lineStyle" => Ok(Value::String(line_style_read(line)?)),
        "weight" => Ok(json!(line.and_then(|line| line.width).unwrap_or(0.0))),
        other => Err(unsupported(format!(
            "ChartLineFormat.{other} is unsupported"
        ))),
    }
}

fn format_for<'a>(chart: &'a ChartData, owner: ChartFormatOwner) -> Option<&'a ChartFormatData> {
    match owner {
        ChartFormatOwner::Chart => chart.chart_format.as_ref(),
        ChartFormatOwner::Title => chart.title_format.as_ref(),
        ChartFormatOwner::Legend => chart.legend.as_ref()?.format.as_ref(),
        ChartFormatOwner::DataLabels => chart.data_labels.as_ref()?.visual_format.as_ref(),
    }
}

fn empty_format() -> ChartFormatData {
    serde_json::from_value(Value::Object(Map::new())).expect("empty chart format is valid")
}

fn empty_font() -> ChartFontData {
    serde_json::from_value(Value::Object(Map::new())).expect("empty chart font is valid")
}

fn empty_line() -> ChartLineData {
    serde_json::from_value(Value::Object(Map::new())).expect("empty chart line is valid")
}

fn default_legend() -> domain_types::domain::chart::LegendData {
    serde_json::from_value(json!({
        "show": false,
        "position": "right",
        "visible": false,
    }))
    .expect("default chart legend is valid")
}

fn default_data_labels() -> domain_types::domain::chart::DataLabelData {
    serde_json::from_value(json!({ "show": false })).expect("default data labels are valid")
}

fn title_visible(chart: &ChartData) -> bool {
    chart.auto_title_deleted != Some(true)
        && (chart.title.is_some() || chart.auto_title_deleted == Some(false))
}

fn recompute_label_visibility(labels: &mut domain_types::domain::chart::DataLabelData) {
    labels.show = labels.delete != Some(true)
        && [
            labels.show_value,
            labels.show_category_name,
            labels.show_series_name,
            labels.show_percentage,
            labels.show_bubble_size,
            labels.show_legend_key,
        ]
        .into_iter()
        .flatten()
        .any(|value| value);
}

fn color_value(color: &ChartColorData) -> Result<Value, ChartFormatError> {
    match color {
        ChartColorData::Hex(value) => Ok(Value::String(if value.starts_with('#') {
            value.clone()
        } else {
            format!("#{value}")
        })),
        ChartColorData::Theme { .. } => Err(unsupported(
            "Theme chart colors cannot be projected to ChartFont/ChartFill HTML colors".to_string(),
        )),
    }
}

fn parse_color(value: &Value, property: &str) -> Result<ChartColorData, ChartFormatError> {
    let value = string(value, property)?;
    let hex = value.strip_prefix('#').unwrap_or(&value);
    if hex.len() != 6 || !hex.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err(invalid(format!(
            "{property} must be an HTML #RRGGBB color; named and theme colors are not persisted by the chart model"
        )));
    }
    Ok(ChartColorData::Hex(hex.to_ascii_uppercase()))
}

fn read_alignment(
    value: Option<&str>,
    default: &str,
    allowed: &[&str],
) -> Result<&'static str, ChartFormatError> {
    let value = value.unwrap_or(default);
    let value = match value {
        "left" | "Left" => "Left",
        "center" | "middle" | "Center" => "Center",
        "right" | "Right" => "Right",
        "top" | "Top" => "Top",
        "bottom" | "Bottom" => "Bottom",
        "justify" | "Justify" => "Justify",
        "distributed" | "Distributed" => "Distributed",
        other => {
            return Err(encoding(format!(
                "Unknown persisted chart alignment '{other}'"
            )));
        }
    };
    if allowed.iter().any(|allowed| {
        (*allowed == "left" && value == "Left")
            || (*allowed == "center" && value == "Center")
            || (*allowed == "right" && value == "Right")
            || (*allowed == "top" && value == "Top")
            || (*allowed == "middle" && value == "Center")
            || (*allowed == "bottom" && value == "Bottom")
    }) {
        Ok(value)
    } else {
        Err(unsupported(format!(
            "Persisted chart alignment '{value}' is not representable"
        )))
    }
}

fn title_horizontal_alignment(
    value: &Value,
    property: &str,
) -> Result<&'static str, ChartFormatError> {
    enum_value(
        value,
        property,
        &[("Center", "center"), ("Left", "left"), ("Right", "right")],
    )
}

fn title_vertical_alignment(
    value: &Value,
    property: &str,
) -> Result<&'static str, ChartFormatError> {
    enum_value(
        value,
        property,
        &[("Center", "middle"), ("Top", "top"), ("Bottom", "bottom")],
    )
}

fn data_label_horizontal_alignment(
    value: &Value,
    property: &str,
) -> Result<&'static str, ChartFormatError> {
    enum_value(
        value,
        property,
        &[("Center", "center"), ("Left", "left"), ("Right", "right")],
    )
}

fn data_label_vertical_alignment(
    value: &Value,
    property: &str,
) -> Result<&'static str, ChartFormatError> {
    enum_value(
        value,
        property,
        &[("Center", "middle"), ("Top", "top"), ("Bottom", "bottom")],
    )
}

fn legend_position(value: &Value, property: &str) -> Result<&'static str, ChartFormatError> {
    enum_value(
        value,
        property,
        &[
            ("Top", "top"),
            ("Bottom", "bottom"),
            ("Left", "left"),
            ("Right", "right"),
            ("Corner", "topRight"),
        ],
    )
}

fn legend_position_read(value: &str) -> Result<String, ChartFormatError> {
    match value {
        "top" | "Top" => Ok("Top".to_string()),
        "bottom" | "Bottom" => Ok("Bottom".to_string()),
        "left" | "Left" => Ok("Left".to_string()),
        "right" | "Right" | "" => Ok("Right".to_string()),
        "topRight" | "corner" | "Corner" => Ok("Corner".to_string()),
        "custom" | "Custom" => Ok("Custom".to_string()),
        other => Err(encoding(format!(
            "Unknown persisted chart legend position '{other}'"
        ))),
    }
}

fn data_label_position(value: &Value, property: &str) -> Result<&'static str, ChartFormatError> {
    enum_value(
        value,
        property,
        &[
            ("Center", "center"),
            ("InsideEnd", "insideEnd"),
            ("InsideBase", "insideBase"),
            ("OutsideEnd", "outsideEnd"),
            ("Left", "left"),
            ("Right", "right"),
            ("Top", "top"),
            ("Bottom", "bottom"),
            ("BestFit", "bestFit"),
        ],
    )
}

fn data_label_position_read(value: Option<&str>) -> Result<String, ChartFormatError> {
    match value.unwrap_or("bestFit") {
        "center" | "Center" => Ok("Center".to_string()),
        "insideEnd" | "InsideEnd" => Ok("InsideEnd".to_string()),
        "insideBase" | "InsideBase" => Ok("InsideBase".to_string()),
        "outsideEnd" | "OutsideEnd" => Ok("OutsideEnd".to_string()),
        "left" | "Left" => Ok("Left".to_string()),
        "right" | "Right" => Ok("Right".to_string()),
        "top" | "Top" => Ok("Top".to_string()),
        "bottom" | "Bottom" => Ok("Bottom".to_string()),
        "bestFit" | "BestFit" => Ok("BestFit".to_string()),
        "none" | "None" | "invalid" | "Invalid" | "callout" | "Callout" => Err(unsupported(
            "The persisted chart model does not represent this data-label position".to_string(),
        )),
        other => Err(encoding(format!(
            "Unknown persisted chart data-label position '{other}'"
        ))),
    }
}

fn color_scheme(value: &Value, property: &str) -> Result<u8, ChartFormatError> {
    let value = value
        .as_str()
        .ok_or_else(|| invalid(format!("{property} must be a ChartColorScheme value")))?;
    let number = match value {
        "ColorfulPalette1" => 1,
        "ColorfulPalette2" => 2,
        "ColorfulPalette3" => 3,
        "ColorfulPalette4" => 4,
        "MonochromaticPalette1" => 5,
        "MonochromaticPalette2" => 6,
        "MonochromaticPalette3" => 7,
        "MonochromaticPalette4" => 8,
        "MonochromaticPalette5" => 9,
        "MonochromaticPalette6" => 10,
        "MonochromaticPalette7" => 11,
        "MonochromaticPalette8" => 12,
        "MonochromaticPalette9" => 13,
        "MonochromaticPalette10" => 14,
        "MonochromaticPalette11" => 15,
        "MonochromaticPalette12" => 16,
        "MonochromaticPalette13" => 17,
        _ => return Err(invalid(format!("Invalid ChartColorScheme value '{value}'"))),
    };
    Ok(number)
}

fn color_scheme_read(value: Option<u8>) -> Result<String, ChartFormatError> {
    let value = value.unwrap_or(1);
    let name = match value {
        1..=4 => format!("ColorfulPalette{value}"),
        5..=17 => format!("MonochromaticPalette{}", value - 4),
        _ => {
            return Err(encoding(format!(
                "Unknown persisted chart color scheme {value}"
            )));
        }
    };
    Ok(name)
}

fn line_style(
    value: &Value,
    property: &str,
) -> Result<(Option<ChartDashStyle>, bool), ChartFormatError> {
    let value = value
        .as_str()
        .ok_or_else(|| invalid(format!("{property} must be a ChartLineStyle value")))?;
    let style = match value {
        "None" => return Ok((None, true)),
        "Continuous" => ChartDashStyle::Solid,
        "Dash" => ChartDashStyle::Dash,
        "DashDot" => ChartDashStyle::DashDot,
        "Dot" => ChartDashStyle::Dot,
        "DashDotDot" | "Grey25" | "Grey50" | "Grey75" | "Automatic" | "RoundDot" => {
            return Err(unsupported(format!(
                "ChartLineStyle.{value} has no lossless ChartLineData representation"
            )));
        }
        _ => return Err(invalid(format!("Invalid ChartLineStyle value '{value}'"))),
    };
    Ok((Some(style), false))
}

fn line_style_read(line: Option<&ChartLineData>) -> Result<String, ChartFormatError> {
    let Some(line) = line else {
        return Ok("None".to_string());
    };
    if line.no_fill == Some(true) {
        return Ok("None".to_string());
    }
    match line.dash_style.as_ref().unwrap_or(&ChartDashStyle::Solid) {
        ChartDashStyle::Solid => Ok("Continuous".to_string()),
        ChartDashStyle::Dash => Ok("Dash".to_string()),
        ChartDashStyle::DashDot => Ok("DashDot".to_string()),
        ChartDashStyle::Dot => Ok("Dot".to_string()),
        ChartDashStyle::LongDash
        | ChartDashStyle::LongDashDot
        | ChartDashStyle::LongDashDotDot
        | ChartDashStyle::SysDash
        | ChartDashStyle::SysDot
        | ChartDashStyle::SysDashDot
        | ChartDashStyle::SysDashDotDot => Err(unsupported(
            "The persisted chart line style is not representable by ChartLineStyle".to_string(),
        )),
    }
}

fn underline(value: &Value, property: &str) -> Result<ChartUnderlineStyle, ChartFormatError> {
    match value.as_str() {
        Some("None") => Ok(ChartUnderlineStyle::None),
        Some("Single") => Ok(ChartUnderlineStyle::Single),
        Some(other) => Err(unsupported(format!(
            "ChartUnderlineStyle.{other} is not representable by the pinned ChartFont API"
        ))),
        None => Err(invalid(format!(
            "{property} must be a ChartUnderlineStyle value"
        ))),
    }
}

fn underline_read(value: Option<&ChartUnderlineStyle>) -> Result<String, ChartFormatError> {
    match value.unwrap_or(&ChartUnderlineStyle::None) {
        ChartUnderlineStyle::None => Ok("None".to_string()),
        ChartUnderlineStyle::Single => Ok("Single".to_string()),
        _ => Err(unsupported(
            "The persisted chart underline style is not representable by ChartUnderlineStyle"
                .to_string(),
        )),
    }
}

fn is_sticky_callout(value: &str) -> bool {
    matches!(
        value,
        "AccentCallout1"
            | "AccentCallout2"
            | "BorderCallout1"
            | "BorderCallout2"
            | "WedgeRectCallout"
            | "WedgeRRectCallout"
            | "WedgeEllipseCallout"
    )
}

fn text_orientation(value: &Value, property: &str) -> Result<f64, ChartFormatError> {
    let value = finite_number(value, property)?;
    if !((-90.0..=90.0).contains(&value) || value == 180.0) {
        return Err(invalid(format!(
            "{property} must be -90 through 90, or 180"
        )));
    }
    Ok(value)
}

fn enum_value(
    value: &Value,
    property: &str,
    allowed: &[(&'static str, &'static str)],
) -> Result<&'static str, ChartFormatError> {
    let value = value
        .as_str()
        .ok_or_else(|| invalid(format!("{property} must be an enum value")))?;
    allowed
        .iter()
        .find(|(wire, _)| *wire == value)
        .map(|(_, persisted)| *persisted)
        .ok_or_else(|| invalid(format!("Invalid {property} value '{value}'")))
}

fn string(value: &Value, property: &str) -> Result<String, ChartFormatError> {
    value
        .as_str()
        .map(ToString::to_string)
        .ok_or_else(|| invalid(format!("{property} must be a string")))
}

fn boolean(value: &Value, property: &str) -> Result<bool, ChartFormatError> {
    value
        .as_bool()
        .ok_or_else(|| invalid(format!("{property} must be a boolean")))
}

fn finite_number(value: &Value, property: &str) -> Result<f64, ChartFormatError> {
    let value = value
        .as_f64()
        .ok_or_else(|| invalid(format!("{property} must be a number")))?;
    if !value.is_finite() {
        return Err(invalid(format!("{property} must be finite")));
    }
    Ok(value)
}

fn chart_error(error: ChartError) -> ChartFormatError {
    ChartFormatError {
        code: error.code,
        message: error.message,
    }
}

fn batch_error(error: ChartFormatError) -> BatchError {
    BatchError {
        code: error.code,
        message: error.message,
    }
}

fn invalid(message: impl Into<String>) -> ChartFormatError {
    ChartFormatError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn unsupported(message: impl Into<String>) -> ChartFormatError {
    ChartFormatError {
        code: "ApiNotFound",
        message: message.into(),
    }
}

fn encoding(message: impl Into<String>) -> ChartFormatError {
    ChartFormatError {
        code: "GeneralException",
        message: message.into(),
    }
}

fn read_only(property: &str, object: &str) -> ChartFormatError {
    ChartFormatError {
        code: "InvalidArgument",
        message: format!("{object}.{property} is read-only"),
    }
}

fn item_not_found(index: &str, object: &str) -> ChartFormatError {
    ChartFormatError {
        code: "ItemNotFound",
        message: format!("The requested {object} index {index} does not exist"),
    }
}

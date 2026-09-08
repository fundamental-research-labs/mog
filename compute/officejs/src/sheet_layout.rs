//! Office.js worksheet view, frozen-pane, and page-layout adapters.
//!
//! The JavaScript side of this family owns Office object paths and batching.
//! This module owns the translation from those paths to the existing typed
//! compute-api layout/print primitives.  In particular, reads always query
//! the engine at operation time; no worksheet view or page-layout state is
//! cached in the Office.js host.

use std::collections::HashMap;

use compute_api::{ComputeApiError, Sheet, Workbook};
use domain_types::domain::print::{HeaderFooter, PageMargins, PrintSettings};
use domain_types::{FrozenPanes, PrintRange, PrintTitles};
use serde_json::{Map, Value, json};

use crate::range_navigation::{
    EXCEL_MAX_COLUMNS, EXCEL_MAX_ROWS, RangeAddress, RangeNavigationError, parse_range_address,
};

/// Errors returned by the worksheet layout/page-layout translation layer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SheetLayoutError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

impl From<ComputeApiError> for SheetLayoutError {
    fn from(error: ComputeApiError) -> Self {
        let code = match &error {
            ComputeApiError::SheetNotFound { .. } => "ItemNotFound",
            ComputeApiError::InvalidAddress { .. } | ComputeApiError::InvalidRange { .. } => {
                "InvalidArgument"
            }
            ComputeApiError::InvalidOperation(_) => "InvalidOperation",
            _ => "GeneralException",
        };
        Self {
            code,
            message: error.to_string(),
        }
    }
}

fn invalid(message: impl Into<String>) -> SheetLayoutError {
    SheetLayoutError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn unsupported(message: impl Into<String>) -> SheetLayoutError {
    SheetLayoutError {
        code: "ApiNotFound",
        message: message.into(),
    }
}

fn navigation(error: RangeNavigationError) -> SheetLayoutError {
    SheetLayoutError {
        code: error.code,
        message: error.message,
    }
}

// ---------------------------------------------------------------------------
// Worksheet view properties
// ---------------------------------------------------------------------------

/// A worksheet-backed view reference for `showGridlines`, `showHeadings`, and
/// `tabColor`.
///
/// `showHeadings` is the Office.js aggregate of the engine's independent row
/// and column header flags.  A write therefore updates both engine settings;
/// a read is true only when both flags are true.
#[derive(Clone)]
pub(crate) struct WorksheetViewRef {
    workbook: Workbook,
    sheet: Sheet,
}

impl WorksheetViewRef {
    pub(crate) fn new(workbook: Workbook, sheet: Sheet) -> Self {
        Self { workbook, sheet }
    }

    /// Project the requested worksheet view properties from persisted state.
    pub(crate) fn load(
        &self,
        properties: &[String],
    ) -> Result<HashMap<String, Value>, SheetLayoutError> {
        let settings = self
            .workbook
            .sheets()
            .get_sheet_settings(self.sheet.id())
            .map_err(SheetLayoutError::from)?;
        // `get_tab_color` is the typed read counterpart to the existing
        // `set_tab_color` facade.  It intentionally remains a live query so a
        // fresh Worksheet proxy sees a color written by an earlier batch.
        let tab_color = self
            .workbook
            .sheets()
            .get_tab_color(self.sheet.id())
            .map_err(SheetLayoutError::from)?;
        let visibility = self
            .workbook
            .sheets()
            .get_sheet_visibility(self.sheet.id())
            .map_err(SheetLayoutError::from)?;

        let requested: Vec<&str> = if properties.is_empty() {
            vec!["showGridlines", "showHeadings", "tabColor"]
        } else {
            properties.iter().map(String::as_str).collect()
        };

        let mut result = HashMap::new();
        for property in requested {
            let value = match property {
                "showGridlines" => json!(settings.show_gridlines),
                "showHeadings" => {
                    json!(settings.show_row_headers && settings.show_column_headers)
                }
                "tabColor" => {
                    if visibility != "visible" {
                        Value::Null
                    } else {
                        Value::String(tab_color.clone().unwrap_or_default())
                    }
                }
                "isNullObject" => Value::Bool(false),
                other => {
                    return Err(invalid(format!(
                        "Unsupported Worksheet load property '{other}'"
                    )));
                }
            };
            result.insert(property.to_string(), value);
        }
        Ok(result)
    }

    /// Apply one Office.js worksheet view property through the persisted
    /// sheet-settings/tab-color APIs.
    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<(), SheetLayoutError> {
        match property {
            "showGridlines" => {
                let value = value
                    .as_bool()
                    .ok_or_else(|| invalid("Worksheet.showGridlines must be a boolean"))?;
                self.workbook
                    .sheets()
                    .set_sheet_setting(
                        self.sheet.id(),
                        "showGridlines",
                        if value { "true" } else { "false" },
                    )
                    .map_err(SheetLayoutError::from)?;
            }
            "showHeadings" => {
                let value = value
                    .as_bool()
                    .ok_or_else(|| invalid("Worksheet.showHeadings must be a boolean"))?;
                let encoded = if value { "true" } else { "false" };
                self.workbook
                    .sheets()
                    .set_sheet_setting(self.sheet.id(), "showRowHeaders", encoded)
                    .map_err(SheetLayoutError::from)?;
                self.workbook
                    .sheets()
                    .set_sheet_setting(self.sheet.id(), "showColumnHeaders", encoded)
                    .map_err(SheetLayoutError::from)?;
            }
            "tabColor" => {
                let value = value
                    .as_str()
                    .ok_or_else(|| invalid("Worksheet.tabColor must be a string"))?;
                self.workbook
                    .sheets()
                    .set_tab_color(
                        self.sheet.id(),
                        if value.is_empty() { None } else { Some(value) },
                    )
                    .map_err(SheetLayoutError::from)?;
            }
            other => {
                return Err(unsupported(format!(
                    "Worksheet.{other} is read-only or unsupported"
                )));
            }
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Frozen panes
// ---------------------------------------------------------------------------

/// A worksheet-backed `WorksheetFreezePanes` reference.
#[derive(Clone)]
pub(crate) struct WorksheetFreezePanesRef {
    sheet: Sheet,
}

impl WorksheetFreezePanesRef {
    pub(crate) fn new(sheet: Sheet) -> Self {
        Self { sheet }
    }

    pub(crate) fn freeze_at(&self, address: &str) -> Result<(), SheetLayoutError> {
        let parsed = parse_range_address(&self.sheet, address).map_err(navigation)?;
        let (rows, cols) = freeze_counts(&parsed, address)?;
        self.sheet
            .layout()
            .set_frozen_panes(rows, cols)
            .map(|_| ())
            .map_err(SheetLayoutError::from)
    }

    pub(crate) fn freeze_rows(&self, count: u32) -> Result<(), SheetLayoutError> {
        self.sheet
            .layout()
            .freeze_rows(count)
            .map(|_| ())
            .map_err(SheetLayoutError::from)
    }

    pub(crate) fn freeze_columns(&self, count: u32) -> Result<(), SheetLayoutError> {
        self.sheet
            .layout()
            .freeze_columns(count)
            .map(|_| ())
            .map_err(SheetLayoutError::from)
    }

    pub(crate) fn unfreeze(&self) -> Result<(), SheetLayoutError> {
        self.sheet
            .layout()
            .set_frozen_panes(0, 0)
            .map(|_| ())
            .map_err(SheetLayoutError::from)
    }

    /// Read the live frozen-pane counts from the compute engine.
    pub(crate) fn get_frozen_panes(&self) -> Result<FrozenPanes, SheetLayoutError> {
        self.sheet
            .layout()
            .get_frozen_panes()
            .map_err(SheetLayoutError::from)
    }

    /// Return the unqualified Range address Office.js uses for the frozen
    /// top-left pane.  A row-only or column-only freeze retains its unbounded
    /// axis (`1:2` or `A:C`), while a two-axis freeze is a bounded rectangle.
    pub(crate) fn get_location_address(&self) -> Result<Option<String>, SheetLayoutError> {
        let panes = self.get_frozen_panes()?;
        frozen_location_address(&panes)
    }
}

fn freeze_counts(parsed: &RangeAddress, address: &str) -> Result<(u32, u32), SheetLayoutError> {
    if parsed.is_whole_sheet() {
        return Err(invalid(format!(
            "WorksheetFreezePanes.freezeAt requires a non-empty range; '{address}' is the whole worksheet"
        )));
    }

    let (start_row, start_col, end_row, end_col) = parsed.bounds();
    if end_row >= EXCEL_MAX_ROWS || end_col >= EXCEL_MAX_COLUMNS {
        return Err(invalid(format!(
            "WorksheetFreezePanes.freezeAt range '{address}' exceeds the worksheet grid"
        )));
    }

    // A single cell is the split point: Excel freezes the rows above it and
    // columns to its left (B3 means two rows and one column).  A rectangular
    // range describes the cells in the top-left frozen pane, so its bottom
    // and right boundaries determine the persisted counts.  Entire-row and
    // entire-column ranges retain their unbounded axis while contributing the
    // bounded axis count.
    let single_cell = !parsed.is_entire_row()
        && !parsed.is_entire_column()
        && start_row == end_row
        && start_col == end_col;
    let rows = if parsed.is_entire_column() {
        0
    } else if single_cell {
        start_row
    } else {
        end_row
            .checked_add(1)
            .ok_or_else(|| invalid("WorksheetFreezePanes.freezeAt row boundary overflow"))?
    };
    let cols = if parsed.is_entire_row() {
        0
    } else if single_cell {
        start_col
    } else {
        end_col
            .checked_add(1)
            .ok_or_else(|| invalid("WorksheetFreezePanes.freezeAt column boundary overflow"))?
    };

    // The range parser guarantees non-empty, ordered bounds. Keep the local
    // checks explicit because this helper is also used by host integrations
    // that may construct RangeAddress values directly in the future.
    if start_row > end_row || start_col > end_col || (rows == 0 && cols == 0) {
        return Err(invalid(format!(
            "WorksheetFreezePanes.freezeAt range '{address}' is invalid"
        )));
    }
    Ok((rows, cols))
}

/// Convert persisted frozen boundaries into the Range address returned by
/// `getLocation`.
pub(crate) fn frozen_location_address(
    panes: &FrozenPanes,
) -> Result<Option<String>, SheetLayoutError> {
    if panes.rows == 0 && panes.cols == 0 {
        return Ok(None);
    }
    if panes.rows > EXCEL_MAX_ROWS || panes.cols > EXCEL_MAX_COLUMNS {
        return Err(invalid("Frozen pane boundaries exceed the worksheet grid"));
    }
    let address = match (panes.rows, panes.cols) {
        (rows, 0) => format!("1:{rows}"),
        (0, cols) => format!("A:{}", column_name(cols - 1)),
        (rows, cols) => bounds_to_a1(0, 0, rows - 1, cols - 1),
    };
    Ok(Some(address))
}

// ---------------------------------------------------------------------------
// PageLayout
// ---------------------------------------------------------------------------

/// A worksheet-backed `PageLayout` reference.
#[derive(Clone)]
pub(crate) struct PageLayoutRef {
    sheet: Sheet,
}

impl PageLayoutRef {
    pub(crate) fn new(sheet: Sheet) -> Self {
        Self { sheet }
    }

    fn settings(&self) -> Result<PrintSettings, SheetLayoutError> {
        self.sheet
            .print()
            .get_print_settings()
            .map_err(SheetLayoutError::from)
    }

    /// Project PageLayout scalar fields from a fresh print-settings query.
    pub(crate) fn load(
        &self,
        properties: &[String],
    ) -> Result<HashMap<String, Value>, SheetLayoutError> {
        let settings = self.settings()?;
        let requested: Vec<&str> = if properties.is_empty() {
            PAGE_LAYOUT_PROPERTIES.to_vec()
        } else {
            properties.iter().map(String::as_str).collect()
        };
        let mut result = HashMap::new();
        for property in requested {
            let value = page_layout_value(&settings, property)?;
            result.insert(property.to_string(), value);
        }
        Ok(result)
    }

    /// Apply one scalar PageLayout property. The current settings are read
    /// immediately before the update so adjacent queued setters preserve one
    /// another and fresh proxies observe persisted state.
    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<(), SheetLayoutError> {
        let mut settings = self.settings()?;
        update_page_layout_value(&mut settings, property, value)?;
        self.sheet
            .print()
            .set_print_settings(settings)
            .map(|_| ())
            .map_err(SheetLayoutError::from)
    }

    pub(crate) fn get_print_area(&self) -> Result<Option<PrintRange>, SheetLayoutError> {
        self.sheet
            .print()
            .get_print_area()
            .map_err(SheetLayoutError::from)
    }

    pub(crate) fn set_print_area(&self, area: Option<PrintRange>) -> Result<(), SheetLayoutError> {
        self.sheet
            .print()
            .set_print_area(area)
            .map(|_| ())
            .map_err(SheetLayoutError::from)
    }

    pub(crate) fn get_print_titles(&self) -> Result<PrintTitles, SheetLayoutError> {
        self.sheet
            .print()
            .get_print_titles()
            .map_err(SheetLayoutError::from)
    }

    pub(crate) fn set_print_titles(&self, titles: PrintTitles) -> Result<(), SheetLayoutError> {
        self.sheet
            .print()
            .set_print_titles(titles)
            .map(|_| ())
            .map_err(SheetLayoutError::from)
    }

    /// Update the requested print margins after converting Office.js units to
    /// the persisted inch representation.  Values omitted from `options` are
    /// retained by the fresh settings read above.
    pub(crate) fn set_print_margins(
        &self,
        unit: &str,
        options: &Map<String, Value>,
    ) -> Result<(), SheetLayoutError> {
        let multiplier = match unit {
            "Points" => 1.0 / 72.0,
            "Inches" => 1.0,
            "Centimeters" => 1.0 / 2.54,
            other => {
                return Err(invalid(format!(
                    "PageLayout.setPrintMargins has unsupported unit '{other}'"
                )))
            }
        };
        let mut settings = self.settings()?;
        let margins = settings.margins.get_or_insert_with(PageMargins::default);
        for (name, value) in options {
            let value = points_value(value, &format!("PageLayout.setPrintMargins.{name}"))?;
            let value = value * multiplier;
            match name.as_str() {
                "bottom" => margins.bottom = value,
                "footer" => margins.footer = value,
                "header" => margins.header = value,
                "left" => margins.left = value,
                "right" => margins.right = value,
                "top" => margins.top = value,
                other => {
                    return Err(invalid(format!(
                        "Unsupported PageLayout margin property '{other}'"
                    )))
                }
            }
        }
        self.sheet
            .print()
            .set_print_settings(settings)
            .map(|_| ())
            .map_err(SheetLayoutError::from)
    }

    /// Set one title axis while preserving the other axis.
    pub(crate) fn set_print_title_rows(
        &self,
        rows: Option<(u32, u32)>,
    ) -> Result<(), SheetLayoutError> {
        let mut titles = self.get_print_titles()?;
        titles.repeat_rows = rows;
        self.set_print_titles(titles)
    }

    pub(crate) fn set_print_title_columns(
        &self,
        cols: Option<(u32, u32)>,
    ) -> Result<(), SheetLayoutError> {
        let mut titles = self.get_print_titles()?;
        titles.repeat_cols = cols;
        self.set_print_titles(titles)
    }
}

/// PageLayout scalar names from the pinned Office.js declaration. `zoom` is a
/// structured scalar object; `headersFooters` is intentionally excluded until
/// its dedicated HeaderFooterGroup adapter is available.
pub(crate) const PAGE_LAYOUT_PROPERTIES: &[&str] = &[
    "alignMarginsHeaderFooter",
    "blackAndWhite",
    "bottomMargin",
    "centerHorizontally",
    "centerVertically",
    "draftMode",
    "firstPageNumber",
    "footerMargin",
    "headerMargin",
    "leftMargin",
    "orientation",
    "paperSize",
    "printComments",
    "printErrors",
    "printGridlines",
    "printHeadings",
    "printOrder",
    "printQuality",
    "rightMargin",
    "topMargin",
    "zoom",
];

fn page_layout_value(settings: &PrintSettings, property: &str) -> Result<Value, SheetLayoutError> {
    let margins = settings.margins.clone().unwrap_or_default();
    let value = match property {
        "alignMarginsHeaderFooter" => json!(
            settings
                .header_footer
                .as_ref()
                .and_then(|header_footer| header_footer.align_with_margins)
                .unwrap_or(true)
        ),
        "blackAndWhite" => json!(settings.black_and_white),
        "bottomMargin" => json!(inches_to_points(margins.bottom)),
        "centerHorizontally" => json!(settings.h_centered),
        "centerVertically" => json!(settings.v_centered),
        "draftMode" => json!(settings.draft),
        "firstPageNumber" => {
            if settings.use_first_page_number {
                settings
                    .first_page_number
                    .map(|number| json!(number))
                    .unwrap_or_else(|| Value::String(String::new()))
            } else {
                Value::String(String::new())
            }
        }
        "footerMargin" => json!(inches_to_points(margins.footer)),
        "headerMargin" => json!(inches_to_points(margins.header)),
        "leftMargin" => json!(inches_to_points(margins.left)),
        "orientation" => Value::String(
            match settings.orientation.as_deref() {
                Some("landscape") | Some("Landscape") => "Landscape",
                _ => "Portrait",
            }
            .to_string(),
        ),
        "paperSize" => Value::String(paper_type(settings.paper_size.unwrap_or(1))?.to_string()),
        "printComments" => Value::String(print_comments_token(settings.cell_comments.as_deref())),
        "printErrors" => Value::String(print_errors_token(settings.print_errors.as_deref())),
        "printGridlines" => json!(settings.gridlines),
        "printHeadings" => json!(settings.headings),
        "printOrder" => Value::String(print_order_token(settings.page_order.as_deref())),
        "printQuality" => json!([
            settings.horizontal_dpi.unwrap_or(0),
            settings.vertical_dpi.unwrap_or(0)
        ]),
        "rightMargin" => json!(inches_to_points(margins.right)),
        "topMargin" => json!(inches_to_points(margins.top)),
        "zoom" => json!({
            "horizontalFitToPages": settings.fit_to_width,
            "scale": settings.scale,
            "verticalFitToPages": settings.fit_to_height,
        }),
        "headersFooters" => {
            return Err(unsupported(
                "PageLayout.headersFooters is not supported by this Office.js host",
            ));
        }
        "isNullObject" => Value::Bool(false),
        other => {
            return Err(invalid(format!(
                "Unsupported PageLayout load property '{other}'"
            )));
        }
    };
    Ok(value)
}

fn update_page_layout_value(
    settings: &mut PrintSettings,
    property: &str,
    value: &Value,
) -> Result<(), SheetLayoutError> {
    match property {
        "alignMarginsHeaderFooter" => {
            let value = value
                .as_bool()
                .ok_or_else(|| invalid("PageLayout.alignMarginsHeaderFooter must be a boolean"))?;
            settings
                .header_footer
                .get_or_insert_with(HeaderFooter::default)
                .align_with_margins = Some(value);
        }
        "blackAndWhite" => {
            settings.black_and_white = bool_value(value, "PageLayout.blackAndWhite")?;
        }
        "bottomMargin" => {
            let value = points_value(value, "PageLayout.bottomMargin")?;
            settings
                .margins
                .get_or_insert_with(PageMargins::default)
                .bottom = points_to_inches(value);
        }
        "centerHorizontally" => {
            settings.h_centered = bool_value(value, "PageLayout.centerHorizontally")?;
        }
        "centerVertically" => {
            settings.v_centered = bool_value(value, "PageLayout.centerVertically")?;
        }
        "draftMode" => {
            settings.draft = bool_value(value, "PageLayout.draftMode")?;
        }
        "firstPageNumber" => {
            if value.as_str() == Some("") {
                settings.first_page_number = None;
                settings.use_first_page_number = false;
            } else {
                let number = required_u32(value, "PageLayout.firstPageNumber")?;
                settings.first_page_number = Some(number);
                settings.use_first_page_number = true;
            }
        }
        "footerMargin" => {
            let value = points_value(value, "PageLayout.footerMargin")?;
            settings
                .margins
                .get_or_insert_with(PageMargins::default)
                .footer = points_to_inches(value);
        }
        "headerMargin" => {
            let value = points_value(value, "PageLayout.headerMargin")?;
            settings
                .margins
                .get_or_insert_with(PageMargins::default)
                .header = points_to_inches(value);
        }
        "leftMargin" => {
            let value = points_value(value, "PageLayout.leftMargin")?;
            settings
                .margins
                .get_or_insert_with(PageMargins::default)
                .left = points_to_inches(value);
        }
        "orientation" => {
            let value = value
                .as_str()
                .ok_or_else(|| invalid("PageLayout.orientation must be Portrait or Landscape"))?;
            settings.orientation = Some(match value {
                "Portrait" => "portrait".to_string(),
                "Landscape" => "landscape".to_string(),
                other => {
                    return Err(invalid(format!(
                        "PageLayout.orientation has unsupported value '{other}'"
                    )));
                }
            });
        }
        "paperSize" => {
            let value = value
                .as_str()
                .ok_or_else(|| invalid("PageLayout.paperSize must be a supported paper type"))?;
            settings.paper_size = Some(paper_code(value)?);
        }
        "printComments" => {
            let value = value.as_str().ok_or_else(|| {
                invalid("PageLayout.printComments must be NoComments, EndSheet, or InPlace")
            })?;
            settings.cell_comments = Some(match value {
                "NoComments" => "none".to_string(),
                "EndSheet" => "atEnd".to_string(),
                "InPlace" => "asDisplayed".to_string(),
                other => {
                    return Err(invalid(format!(
                        "PageLayout.printComments has unsupported value '{other}'"
                    )));
                }
            });
        }
        "printErrors" => {
            let value = value.as_str().ok_or_else(|| {
                invalid("PageLayout.printErrors must be AsDisplayed, Blank, Dash, or NotAvailable")
            })?;
            settings.print_errors = Some(match value {
                "AsDisplayed" => "displayed".to_string(),
                "Blank" => "blank".to_string(),
                "Dash" => "dash".to_string(),
                "NotAvailable" => "NA".to_string(),
                other => {
                    return Err(invalid(format!(
                        "PageLayout.printErrors has unsupported value '{other}'"
                    )));
                }
            });
        }
        "printGridlines" => {
            settings.gridlines = bool_value(value, "PageLayout.printGridlines")?;
        }
        "printHeadings" => {
            settings.headings = bool_value(value, "PageLayout.printHeadings")?;
        }
        "printOrder" => {
            let value = value.as_str().ok_or_else(|| {
                invalid("PageLayout.printOrder must be DownThenOver or OverThenDown")
            })?;
            settings.page_order = Some(match value {
                "DownThenOver" => "downThenOver".to_string(),
                "OverThenDown" => "overThenDown".to_string(),
                other => {
                    return Err(invalid(format!(
                        "PageLayout.printOrder has unsupported value '{other}'"
                    )));
                }
            });
        }
        "printQuality" => {
            let values = value.as_array().ok_or_else(|| {
                invalid("PageLayout.printQuality must be a two-element number array")
            })?;
            if values.len() != 2 {
                return Err(invalid(
                    "PageLayout.printQuality must be a two-element number array",
                ));
            }
            settings.horizontal_dpi = Some(required_u32(&values[0], "PageLayout.printQuality[0]")?);
            settings.vertical_dpi = Some(required_u32(&values[1], "PageLayout.printQuality[1]")?);
        }
        "rightMargin" => {
            let value = points_value(value, "PageLayout.rightMargin")?;
            settings
                .margins
                .get_or_insert_with(PageMargins::default)
                .right = points_to_inches(value);
        }
        "topMargin" => {
            let value = points_value(value, "PageLayout.topMargin")?;
            settings
                .margins
                .get_or_insert_with(PageMargins::default)
                .top = points_to_inches(value);
        }
        "zoom" => update_zoom(settings, value)?,
        "headersFooters" => {
            return Err(unsupported(
                "PageLayout.headersFooters is not supported by this Office.js host",
            ));
        }
        "isNullObject" => {
            return Err(invalid("PageLayout.isNullObject is read-only"));
        }
        other => {
            return Err(unsupported(format!(
                "PageLayout.{other} is read-only or unsupported"
            )));
        }
    }
    Ok(())
}

fn update_zoom(settings: &mut PrintSettings, value: &Value) -> Result<(), SheetLayoutError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid("PageLayout.zoom must be an object"))?;
    for key in object.keys() {
        if !matches!(
            key.as_str(),
            "horizontalFitToPages" | "scale" | "verticalFitToPages"
        ) {
            return Err(invalid(format!(
                "Unsupported PageLayout.zoom property '{key}'"
            )));
        }
    }
    if let Some(value) = object.get("horizontalFitToPages") {
        settings.fit_to_width = optional_u32(value, "PageLayout.zoom.horizontalFitToPages")?;
    }
    if let Some(value) = object.get("scale") {
        let scale = optional_u32(value, "PageLayout.zoom.scale")?;
        if let Some(scale) = scale
            && !(10..=400).contains(&scale)
        {
            return Err(invalid("PageLayout.zoom.scale must be between 10 and 400"));
        }
        settings.scale = scale;
    }
    if let Some(value) = object.get("verticalFitToPages") {
        settings.fit_to_height = optional_u32(value, "PageLayout.zoom.verticalFitToPages")?;
    }
    Ok(())
}

fn bool_value(value: &Value, property: &str) -> Result<bool, SheetLayoutError> {
    value
        .as_bool()
        .ok_or_else(|| invalid(format!("{property} must be a boolean")))
}

fn required_u32(value: &Value, property: &str) -> Result<u32, SheetLayoutError> {
    value
        .as_u64()
        .and_then(|number| u32::try_from(number).ok())
        .ok_or_else(|| invalid(format!("{property} must be a non-negative integer")))
}

fn optional_u32(value: &Value, property: &str) -> Result<Option<u32>, SheetLayoutError> {
    if value.is_null() {
        Ok(None)
    } else {
        required_u32(value, property).map(Some)
    }
}

fn points_value(value: &Value, property: &str) -> Result<f64, SheetLayoutError> {
    let number = value
        .as_f64()
        .ok_or_else(|| invalid(format!("{property} must be a finite non-negative number")))?;
    if !number.is_finite() || number < 0.0 {
        return Err(invalid(format!(
            "{property} must be a finite non-negative number"
        )));
    }
    Ok(number)
}

fn inches_to_points(value: f64) -> f64 {
    value * 72.0
}

fn points_to_inches(value: f64) -> f64 {
    value / 72.0
}

fn print_comments_token(value: Option<&str>) -> String {
    match value {
        Some("atEnd") => "EndSheet".to_string(),
        Some("asDisplayed") => "InPlace".to_string(),
        _ => "NoComments".to_string(),
    }
}

fn print_errors_token(value: Option<&str>) -> String {
    match value {
        Some("blank") => "Blank".to_string(),
        Some("dash") => "Dash".to_string(),
        Some("NA") => "NotAvailable".to_string(),
        _ => "AsDisplayed".to_string(),
    }
}

fn print_order_token(value: Option<&str>) -> String {
    match value {
        Some("overThenDown") | Some("OverThenDown") => "OverThenDown".to_string(),
        _ => "DownThenOver".to_string(),
    }
}

fn paper_type(value: u32) -> Result<&'static str, SheetLayoutError> {
    let token = match value {
        1 => "Letter",
        2 => "LetterSmall",
        3 => "Tabloid",
        4 => "Ledger",
        5 => "Legal",
        6 => "Statement",
        7 => "Executive",
        8 => "A3",
        9 => "A4",
        10 => "A4Small",
        11 => "A5",
        12 => "B4",
        13 => "B5",
        14 => "Folio",
        // The pinned Excel.PaperType declaration spells this token Quatro.
        15 => "Quatro",
        16 => "Paper10x14",
        17 => "Paper11x17",
        18 => "Note",
        19 => "Envelope9",
        20 => "Envelope10",
        21 => "Envelope11",
        22 => "Envelope12",
        23 => "Envelope14",
        24 => "Csheet",
        25 => "Dsheet",
        26 => "Esheet",
        27 => "EnvelopeDL",
        28 => "EnvelopeC5",
        29 => "EnvelopeC3",
        30 => "EnvelopeC4",
        31 => "EnvelopeC6",
        32 => "EnvelopeC65",
        33 => "EnvelopeB4",
        34 => "EnvelopeB5",
        35 => "EnvelopeB6",
        36 => "EnvelopeItaly",
        37 => "EnvelopeMonarch",
        39 => "FanfoldUS",
        40 => "FanfoldStdGerman",
        41 => "FanfoldLegalGerman",
        other => {
            return Err(unsupported(format!(
                "PageLayout.paperSize value {other} has no pinned Excel.PaperType token"
            )));
        }
    };
    Ok(token)
}

fn paper_code(value: &str) -> Result<u32, SheetLayoutError> {
    let code = match value {
        "Letter" => 1,
        "LetterSmall" => 2,
        "Tabloid" => 3,
        "Ledger" => 4,
        "Legal" => 5,
        "Statement" => 6,
        "Executive" => 7,
        "A3" => 8,
        "A4" => 9,
        "A4Small" => 10,
        "A5" => 11,
        "B4" => 12,
        "B5" => 13,
        "Folio" => 14,
        "Quatro" => 15,
        "Paper10x14" => 16,
        "Paper11x17" => 17,
        "Note" => 18,
        "Envelope9" => 19,
        "Envelope10" => 20,
        "Envelope11" => 21,
        "Envelope12" => 22,
        "Envelope14" => 23,
        "Csheet" => 24,
        "Dsheet" => 25,
        "Esheet" => 26,
        "EnvelopeDL" => 27,
        "EnvelopeC5" => 28,
        "EnvelopeC3" => 29,
        "EnvelopeC4" => 30,
        "EnvelopeC6" => 31,
        "EnvelopeC65" => 32,
        "EnvelopeB4" => 33,
        "EnvelopeB5" => 34,
        "EnvelopeB6" => 35,
        "EnvelopeItaly" => 36,
        "EnvelopeMonarch" => 37,
        "FanfoldUS" => 39,
        "FanfoldStdGerman" => 40,
        "FanfoldLegalGerman" => 41,
        other => {
            return Err(invalid(format!(
                "PageLayout.paperSize has unsupported value '{other}'"
            )));
        }
    };
    Ok(code)
}

// ---------------------------------------------------------------------------
// Print area/title address translation
// ---------------------------------------------------------------------------

/// Parse one bounded print-area address into the domain's positional range.
/// The persisted compute API currently models one rectangular print area;
/// callers receiving a RangeAreas proxy must reject additional disjoint areas
/// instead of silently dropping them.
pub(crate) fn parse_print_area(
    sheet: &Sheet,
    address: &str,
) -> Result<PrintRange, SheetLayoutError> {
    let parsed = parse_range_address(sheet, address).map_err(navigation)?;
    if parsed.is_whole_sheet() || parsed.is_entire_row() || parsed.is_entire_column() {
        return Err(invalid(
            "PageLayout.setPrintArea requires a bounded rectangular range",
        ));
    }
    let (start_row, start_col, end_row, end_col) = parsed.bounds();
    Ok(PrintRange {
        start_row,
        start_col,
        end_row,
        end_col,
    })
}

pub(crate) fn print_area_address(area: &PrintRange) -> Result<String, SheetLayoutError> {
    validate_print_range(area)?;
    Ok(bounds_to_a1(
        area.start_row,
        area.start_col,
        area.end_row,
        area.end_col,
    ))
}

pub(crate) fn parse_print_title_rows(
    sheet: &Sheet,
    address: &str,
) -> Result<(u32, u32), SheetLayoutError> {
    let parsed = parse_range_address(sheet, address).map_err(navigation)?;
    if !parsed.is_entire_row() {
        return Err(invalid(
            "PageLayout.setPrintTitleRows requires a range spanning entire rows",
        ));
    }
    Ok((parsed.bounds().0, parsed.bounds().2))
}

pub(crate) fn parse_print_title_columns(
    sheet: &Sheet,
    address: &str,
) -> Result<(u32, u32), SheetLayoutError> {
    let parsed = parse_range_address(sheet, address).map_err(navigation)?;
    if !parsed.is_entire_column() {
        return Err(invalid(
            "PageLayout.setPrintTitleColumns requires a range spanning entire columns",
        ));
    }
    Ok((parsed.bounds().1, parsed.bounds().3))
}

pub(crate) fn print_title_rows_address(rows: (u32, u32)) -> Result<String, SheetLayoutError> {
    if rows.0 > rows.1 || rows.1 >= EXCEL_MAX_ROWS {
        return Err(invalid("Print title row bounds exceed the worksheet grid"));
    }
    Ok(format!("{}:{}", rows.0 + 1, rows.1 + 1))
}

pub(crate) fn print_title_columns_address(cols: (u32, u32)) -> Result<String, SheetLayoutError> {
    if cols.0 > cols.1 || cols.1 >= EXCEL_MAX_COLUMNS {
        return Err(invalid(
            "Print title column bounds exceed the worksheet grid",
        ));
    }
    Ok(format!("{}:{}", column_name(cols.0), column_name(cols.1)))
}

fn validate_print_range(area: &PrintRange) -> Result<(), SheetLayoutError> {
    if area.start_row > area.end_row
        || area.start_col > area.end_col
        || area.end_row >= EXCEL_MAX_ROWS
        || area.end_col >= EXCEL_MAX_COLUMNS
    {
        return Err(invalid("Print area bounds exceed the worksheet grid"));
    }
    Ok(())
}

fn bounds_to_a1(start_row: u32, start_col: u32, end_row: u32, end_col: u32) -> String {
    let start = format!("{}{}", column_name(start_col), start_row + 1);
    let end = format!("{}{}", column_name(end_col), end_row + 1);
    if start == end {
        start
    } else {
        format!("{start}:{end}")
    }
}

fn column_name(mut column: u32) -> String {
    let mut name = String::new();
    loop {
        name.insert(0, (b'A' + (column % 26) as u8) as char);
        if column < 26 {
            break;
        }
        column = column / 26 - 1;
    }
    name
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frozen_location_shapes_follow_pane_boundaries() {
        assert_eq!(
            frozen_location_address(&FrozenPanes { rows: 2, cols: 3 }).unwrap(),
            Some("A1:C2".to_string())
        );
        assert_eq!(
            frozen_location_address(&FrozenPanes { rows: 2, cols: 0 }).unwrap(),
            Some("1:2".to_string())
        );
        assert_eq!(
            frozen_location_address(&FrozenPanes { rows: 0, cols: 3 }).unwrap(),
            Some("A:C".to_string())
        );
        assert_eq!(
            frozen_location_address(&FrozenPanes { rows: 0, cols: 0 }).unwrap(),
            None
        );
    }

    #[test]
    fn freeze_at_single_cell_uses_the_split_point() {
        let (workbook, _) = Workbook::blank().unwrap();
        let sheet = workbook.sheet_by_name("Sheet1").unwrap();

        let b3 = parse_range_address(&sheet, "B3").unwrap();
        assert_eq!(freeze_counts(&b3, "B3").unwrap(), (2, 1));
        let a1 = parse_range_address(&sheet, "A1").unwrap();
        assert_eq!(freeze_counts(&a1, "A1").unwrap(), (0, 0));
        let d1 = parse_range_address(&sheet, "D1").unwrap();
        assert_eq!(freeze_counts(&d1, "D1").unwrap(), (0, 3));
        let a5 = parse_range_address(&sheet, "A5").unwrap();
        assert_eq!(freeze_counts(&a5, "A5").unwrap(), (4, 0));
    }

    #[test]
    fn paper_tokens_cover_the_persisted_standard_ids() {
        assert_eq!(paper_type(1).unwrap(), "Letter");
        assert_eq!(paper_type(9).unwrap(), "A4");
        assert_eq!(paper_type(41).unwrap(), "FanfoldLegalGerman");
        assert_eq!(paper_code("A4").unwrap(), 9);
        assert!(paper_code("EnvelopePersonal").is_err());
    }

    #[test]
    fn title_and_print_area_addresses_are_canonical() {
        assert_eq!(print_title_rows_address((0, 2)).unwrap(), "1:3".to_string());
        assert_eq!(
            print_title_columns_address((0, 27)).unwrap(),
            "A:AB".to_string()
        );
        assert_eq!(
            print_area_address(&PrintRange {
                start_row: 1,
                start_col: 2,
                end_row: 3,
                end_col: 4,
            })
            .unwrap(),
            "C2:E4".to_string()
        );
    }
}

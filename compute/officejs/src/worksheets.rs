//! Office.js worksheet lifecycle and collection helpers.
//!
//! The JavaScript Office.js layer owns request-context proxy objects.  This
//! module owns the corresponding host-side references and deliberately
//! resolves metadata from the compute engine on every operation.  In
//! particular, a [`WorksheetRef`] is anchored by the engine's stable
//! [`SheetId`], so a proxy remains valid after a rename or a tab move.

use std::collections::HashMap;

use compute_api::{ComputeApiError, Sheet, SheetId, Workbook};
use serde::Serialize;
use serde_json::{Value, json};

use crate::dispatch::{ExtensionHandler, HostDispatchContext};
use crate::host::BatchError;

/// Error returned by a worksheet host operation.
///
/// `code` contains the Office.js error code expected by the JavaScript
/// request context.  Keeping this conversion at the Office.js boundary lets
/// the compute API continue to expose its richer Rust error type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorksheetError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

/// A worksheet item in the collection hydration wire shape.
///
/// The collection host operation returns these records under
/// `loaded[collectionId].items`.  The JavaScript hydration layer uses `key` to
/// call the normal `WorksheetCollection.getItem` path, then seeds the listed
/// scalar properties on that real proxy.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct WorksheetItem {
    pub(crate) key: String,
    pub(crate) properties: HashMap<String, Value>,
}

/// A host-side worksheet reference anchored to a stable engine sheet ID.
#[derive(Clone)]
pub(crate) struct WorksheetRef {
    workbook: Workbook,
    sheet: Sheet,
}

impl WorksheetRef {
    /// Construct a worksheet reference from a workbook and a sheet handle.
    pub(crate) fn new(workbook: Workbook, sheet: Sheet) -> Self {
        Self { workbook, sheet }
    }

    /// Return the underlying compute-api sheet handle.
    pub(crate) fn sheet(&self) -> Sheet {
        self.sheet.clone()
    }

    /// Return the stable worksheet ID used by Office.js.
    pub(crate) fn stable_id(&self) -> String {
        self.sheet.id().to_uuid_string()
    }

    /// Load supported worksheet scalar properties from the current engine
    /// state.
    pub(crate) fn load(
        &self,
        properties: &[String],
    ) -> Result<HashMap<String, Value>, WorksheetError> {
        let mut result = HashMap::new();
        for property in properties {
            let value = match property.as_str() {
                "id" => Value::String(self.stable_id()),
                "name" => Value::String(self.name()?),
                "position" => json!(self.position()?),
                "visibility" => Value::String(visibility_token(&self.visibility()?).to_string()),
                "tabColor" => self.tab_color()?,
                "showGridlines" => Value::Bool(self.show_gridlines()?),
                "isNullObject" => Value::Bool(false),
                other => {
                    return Err(unsupported_load_property("Worksheet", other));
                }
            };
            result.insert(property.clone(), value);
        }
        Ok(result)
    }

    /// Set one of the supported worksheet scalar properties.
    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<(), WorksheetError> {
        match property {
            "name" => self.set_name(value),
            "position" => self.set_position(value),
            "visibility" => self.set_visibility(value),
            "tabColor" => self.set_tab_color(value),
            "showGridlines" => self.set_show_gridlines(value),
            other => Err(WorksheetError {
                code: "InvalidArgument",
                message: format!("Worksheet.{other} is read-only or unsupported"),
            }),
        }
    }

    /// Persist this worksheet as the active worksheet in workbook view state.
    ///
    /// The active marker is keyed by the stable sheet ID.  The selected-sheet
    /// list is updated as well so persisted workbook view state remains
    /// coherent for consumers that only understand the standard setting.
    pub(crate) fn activate(&self) -> Result<(), WorksheetError> {
        let position = self.position()? as u32;
        let mut settings = self
            .workbook
            .settings()
            .get_workbook_settings()
            .map_err(compute_error)?;
        let id = self.stable_id();
        settings.selected_sheet_ids = Some(vec![id.clone()]);
        settings
            .custom_settings
            .get_or_insert_with(HashMap::new)
            .insert("mog.activeSheetId".to_string(), Value::String(id));
        self.workbook
            .settings()
            .set_workbook_settings(settings)
            .map_err(compute_error)?;
        self.workbook
            .settings()
            .set_workbook_view_active_tab(position)
            .map_err(compute_error)?;
        Ok(())
    }

    /// Delete this worksheet, applying Office's lifecycle restrictions before
    /// dispatching the persisted engine mutation.
    pub(crate) fn delete(&self) -> Result<(), WorksheetError> {
        let count = self.workbook.sheet_count().map_err(compute_error)?;
        if count <= 1 {
            return Err(WorksheetError {
                code: "InvalidOperation",
                message: "Cannot delete the last worksheet.".to_string(),
            });
        }

        let deleted_id = self.stable_id();
        let deleted_position = self.position()?;
        let active_id = active(&self.workbook)
            .ok()
            .map(|worksheet| worksheet.stable_id());

        // Office.js documents that deleting a VeryHidden worksheet fails.
        // The compute engine can represent VeryHidden state but intentionally
        // leaves this host-level rule to the API boundary.
        if self.visibility()? == "veryHidden" {
            return Err(WorksheetError {
                code: "InvalidOperation",
                message: "A VeryHidden worksheet cannot be deleted. Set its visibility to Hidden or Visible before deleting it.".to_string(),
            });
        }

        self.workbook
            .sheets()
            .delete_sheet(self.sheet.id())
            .map_err(compute_error)?;

        if let Some(active_id) = active_id {
            if active_id == deleted_id {
                if let Some(replacement) =
                    visible_replacement(&self.workbook, deleted_position, None)?
                {
                    replacement.activate()?;
                }
            } else if let Some(active_worksheet) = find_by_id(&self.workbook, &active_id)? {
                persist_active_view_position(&active_worksheet)?;
            }
        }
        Ok(())
    }

    /// Return the worksheet following this one in persisted tab order.
    /// Hidden worksheets are skipped when `visible_only` is true.
    pub(crate) fn next(&self, visible_only: bool) -> Result<Option<Self>, WorksheetError> {
        let ordered = ordered(self.workbook.clone(), false)?;
        let index = ordered
            .iter()
            .position(|worksheet| worksheet.same_sheet(self))
            .ok_or_else(|| item_not_found(&self.stable_id()))?;
        if !visible_only {
            return Ok(ordered.get(index + 1).cloned());
        }
        for worksheet in ordered.iter().skip(index + 1) {
            if worksheet.visibility()? == "visible" {
                return Ok(Some(worksheet.clone()));
            }
        }
        Ok(None)
    }

    /// Return the worksheet preceding this one in persisted tab order.
    /// Hidden worksheets are skipped when `visible_only` is true.
    pub(crate) fn previous(&self, visible_only: bool) -> Result<Option<Self>, WorksheetError> {
        let ordered = ordered(self.workbook.clone(), false)?;
        let index = ordered
            .iter()
            .position(|worksheet| worksheet.same_sheet(self))
            .ok_or_else(|| item_not_found(&self.stable_id()))?;
        if !visible_only {
            return Ok(index
                .checked_sub(1)
                .and_then(|previous| ordered.get(previous).cloned()));
        }
        for worksheet in ordered[..index].iter().rev() {
            if worksheet.visibility()? == "visible" {
                return Ok(Some(worksheet.clone()));
            }
        }
        Ok(None)
    }

    fn same_sheet(&self, other: &Self) -> bool {
        self.sheet.id() == other.sheet.id()
    }

    fn name(&self) -> Result<String, WorksheetError> {
        self.sheet.name().map_err(compute_error)
    }

    fn position(&self) -> Result<usize, WorksheetError> {
        let count = self.workbook.sheet_count().map_err(compute_error)?;
        for index in 0..count {
            let sheet = self.workbook.sheet_by_index(index).map_err(compute_error)?;
            if sheet.id() == self.sheet.id() {
                return Ok(index);
            }
        }
        Err(item_not_found(&self.stable_id()))
    }

    fn visibility(&self) -> Result<String, WorksheetError> {
        self.workbook
            .sheets()
            .get_sheet_visibility(self.sheet.id())
            .map_err(compute_error)
    }

    fn set_name(&self, value: &Value) -> Result<(), WorksheetError> {
        let name = required_string(value, "Worksheet.name")?;
        validate_sheet_name(&self.workbook, self.sheet.id(), name)?;
        self.workbook
            .sheets()
            .rename_sheet(self.sheet.id(), name)
            .map_err(compute_error)?;
        Ok(())
    }

    fn set_position(&self, value: &Value) -> Result<(), WorksheetError> {
        let position = required_u32(value, "Worksheet.position")?;
        let active_id = active(&self.workbook)
            .ok()
            .map(|worksheet| worksheet.stable_id());
        self.workbook
            .sheets()
            .move_sheet(self.sheet.id(), position)
            .map_err(compute_error)?;
        if let Some(active_id) = active_id
            && let Some(active_worksheet) = find_by_id(&self.workbook, &active_id)?
        {
            persist_active_view_position(&active_worksheet)?;
        }
        Ok(())
    }

    /// Copy this worksheet. `position` is an Office.js `WorksheetPositionType`
    /// token (`Beginning`, `End`, `Before`, `After`); omitted means End.
    pub(crate) fn copy(&self, position: Option<&str>) -> Result<Self, WorksheetError> {
        let source_name = self.name()?;
        let new_name = unique_copy_name(&self.workbook, &source_name)?;
        self.workbook
            .sheets()
            .copy_sheet(self.sheet.id(), &new_name)
            .map_err(compute_error)?;
        let copied = self
            .workbook
            .sheet_by_name(&new_name)
            .map_err(compute_error)?;
        let copied = Self::new(self.workbook.clone(), copied);
        match position.unwrap_or("End") {
            "Beginning" | "beginning" => {
                copied.set_position(&json!(0))?;
            }
            "Before" | "before" => {
                copied.set_position(&json!(self.position()? as u32))?;
            }
            "After" | "after" => {
                copied.set_position(&json!(self.position()? as u32 + 1))?;
            }
            "End" | "end" => {}
            other => {
                return Err(WorksheetError {
                    code: "InvalidArgument",
                    message: format!("Unsupported WorksheetPositionType '{other}'"),
                });
            }
        }
        Ok(copied)
    }

    fn tab_color(&self) -> Result<Value, WorksheetError> {
        let meta = self
            .workbook
            .sheets()
            .get_sheet_meta(self.sheet.id())
            .map_err(compute_error)?;
        Ok(meta
            .and_then(|meta| meta.tab_color)
            .map(Value::String)
            .unwrap_or(Value::Null))
    }

    fn show_gridlines(&self) -> Result<bool, WorksheetError> {
        Ok(self
            .workbook
            .sheets()
            .get_sheet_settings(self.sheet.id())
            .map_err(compute_error)?
            .show_gridlines)
    }

    fn set_tab_color(&self, value: &Value) -> Result<(), WorksheetError> {
        let color = match value {
            Value::Null => None,
            Value::String(color) if color.is_empty() => None,
            Value::String(color) => Some(color.as_str()),
            _ => {
                return Err(WorksheetError {
                    code: "InvalidArgument",
                    message: "Worksheet.tabColor must be a string or null".to_string(),
                });
            }
        };
        self.workbook
            .sheets()
            .set_tab_color(self.sheet.id(), color)
            .map_err(compute_error)?;
        Ok(())
    }

    fn set_show_gridlines(&self, value: &Value) -> Result<(), WorksheetError> {
        let show = value.as_bool().ok_or_else(|| WorksheetError {
            code: "InvalidArgument",
            message: "Worksheet.showGridlines must be a boolean".to_string(),
        })?;
        self.workbook
            .sheets()
            .set_sheet_setting(self.sheet.id(), "showGridlines", &show.to_string())
            .map_err(compute_error)?;
        Ok(())
    }

    fn set_visibility(&self, value: &Value) -> Result<(), WorksheetError> {
        let state = parse_visibility(value)?;
        let old_visibility = self.visibility()?;
        let self_id = self.stable_id();
        let active_id = active(&self.workbook)
            .ok()
            .map(|worksheet| worksheet.stable_id());
        if state != "visible" && old_visibility == "visible" {
            let visible_count = ordered(self.workbook.clone(), true)?.len();
            if visible_count <= 1 {
                return Err(WorksheetError {
                    code: "InvalidOperation",
                    message: "At least one worksheet must remain visible.".to_string(),
                });
            }
        }
        self.workbook
            .sheets()
            .set_sheet_visibility(self.sheet.id(), state)
            .map_err(compute_error)?;
        if state != "visible"
            && old_visibility == "visible"
            && active_id.as_deref() == Some(self_id.as_str())
            && let Some(replacement) =
                visible_replacement(&self.workbook, self.position()?, Some(self.sheet.id()))?
        {
            replacement.activate()?;
        }
        Ok(())
    }
}

/// Resolve a worksheet by name or stable ID.
pub(crate) fn get_item(workbook: &Workbook, key: &str) -> Result<WorksheetRef, WorksheetError> {
    for index in 0..workbook.sheet_count().map_err(compute_error)? {
        let sheet = workbook.sheet_by_index(index).map_err(compute_error)?;
        if sheet.id().to_uuid_string().eq_ignore_ascii_case(key)
            || sheet
                .name()
                .map_err(compute_error)?
                .eq_ignore_ascii_case(key)
        {
            return Ok(WorksheetRef::new(workbook.clone(), sheet));
        }
    }
    Err(item_not_found(key))
}

/// Resolve a worksheet by name or stable ID, returning `None` for a missing
/// item as required by `getItemOrNullObject`.
pub(crate) fn get_item_or_null(
    workbook: &Workbook,
    key: &str,
) -> Result<Option<WorksheetRef>, WorksheetError> {
    match get_item(workbook, key) {
        Ok(worksheet) => Ok(Some(worksheet)),
        Err(error) if error.code == "ItemNotFound" => Ok(None),
        Err(error) => Err(error),
    }
}

/// Resolve the persisted active worksheet.
///
/// Activation is represented by persisted workbook view state. A new blank
/// workbook has a genuine engine default returned by `get_first_sheet_id`; it
/// is used only when no persisted selection or workbook view exists.
pub(crate) fn active(workbook: &Workbook) -> Result<WorksheetRef, WorksheetError> {
    let settings = workbook
        .settings()
        .get_workbook_settings()
        .map_err(compute_error)?;

    if let Some(id) = settings
        .custom_settings
        .as_ref()
        .and_then(|settings| settings.get("mog.activeSheetId"))
        .and_then(Value::as_str)
        && let Some(worksheet) = find_by_id(workbook, id)?
    {
        return Ok(worksheet);
    }

    if let Some(ids) = settings.selected_sheet_ids.as_ref() {
        for id in ids {
            if let Some(worksheet) = find_by_id(workbook, id)? {
                return Ok(worksheet);
            }
        }
    }

    if let Some(active_tab) = workbook
        .settings()
        .get_workbook_view_active_tab()
        .map_err(compute_error)?
    {
        let sheet = workbook
            .sheet_by_index(active_tab as usize)
            .map_err(compute_error)?;
        return Ok(WorksheetRef::new(workbook.clone(), sheet));
    }

    if let Some(first_id) = workbook
        .sheets()
        .get_first_sheet_id()
        .map_err(compute_error)?
        && let Some(worksheet) = find_by_id(workbook, &first_id)?
    {
        return Ok(worksheet);
    }

    Err(WorksheetError {
        code: "ItemNotFound",
        message: "The workbook contains no worksheet that can be active.".to_string(),
    })
}

/// Resolve every worksheet in persisted tab order, optionally skipping hidden
/// worksheets.
pub(crate) fn ordered(
    workbook: Workbook,
    visible_only: bool,
) -> Result<Vec<WorksheetRef>, WorksheetError> {
    let count = workbook.sheet_count().map_err(compute_error)?;
    let mut worksheets = Vec::with_capacity(count);
    for index in 0..count {
        let sheet = workbook.sheet_by_index(index).map_err(compute_error)?;
        let worksheet = WorksheetRef::new(workbook.clone(), sheet);
        if visible_only && worksheet.visibility()? != "visible" {
            continue;
        }
        worksheets.push(worksheet);
    }
    Ok(worksheets)
}

fn visible_replacement(
    workbook: &Workbook,
    start_position: usize,
    skip_id: Option<&SheetId>,
) -> Result<Option<WorksheetRef>, WorksheetError> {
    let ordered = ordered(workbook.clone(), false)?;
    let start_position = start_position.min(ordered.len());
    for worksheet in ordered.iter().skip(start_position) {
        if skip_id.is_some_and(|id| worksheet.sheet.id() == id) {
            continue;
        }
        if worksheet.visibility()? == "visible" {
            return Ok(Some(worksheet.clone()));
        }
    }
    for worksheet in ordered[..start_position].iter().rev() {
        if skip_id.is_some_and(|id| worksheet.sheet.id() == id) {
            continue;
        }
        if worksheet.visibility()? == "visible" {
            return Ok(Some(worksheet.clone()));
        }
    }
    Ok(None)
}

fn persist_active_view_position(worksheet: &WorksheetRef) -> Result<(), WorksheetError> {
    worksheet
        .workbook
        .settings()
        .set_workbook_view_active_tab(worksheet.position()? as u32)
        .map_err(compute_error)?;
    Ok(())
}

/// Resolve the collection's loaded worksheet item records.
///
/// `properties` are the scalar properties requested for each item.  An empty
/// list uses the worksheet scalar defaults (`id`, `name`, `position`, and
/// `visibility`), matching a collection `$all` request at this narrow host
/// surface.
pub(crate) fn collection_items(
    workbook: &Workbook,
    properties: &[String],
    visible_only: bool,
) -> Result<Vec<WorksheetItem>, WorksheetError> {
    let properties = normalize_collection_properties(properties)?;
    let properties = if properties.is_empty() {
        vec![
            "id".to_string(),
            "name".to_string(),
            "position".to_string(),
            "visibility".to_string(),
        ]
    } else {
        properties
    };
    ordered(workbook.clone(), visible_only)?
        .into_iter()
        .map(|worksheet| {
            let key = worksheet.stable_id();
            let properties = worksheet.load(&properties)?;
            Ok(WorksheetItem { key, properties })
        })
        .collect()
}

fn normalize_collection_properties(properties: &[String]) -> Result<Vec<String>, WorksheetError> {
    let mut normalized = Vec::new();
    for property in properties {
        if property == "items" {
            continue;
        }
        if let Some(item_property) = property.strip_prefix("items/") {
            if item_property.is_empty() || item_property == "$all" {
                continue;
            }
            normalized.push(item_property.to_string());
            continue;
        }
        // Host integrations may already strip the `items/` prefix before
        // calling this helper.  Accept those scalar names while rejecting
        // workbook-collection properties that could otherwise be mistaken for
        // item data.
        if matches!(
            property.as_str(),
            "id" | "name" | "position" | "visibility" | "isNullObject"
        ) {
            normalized.push(property.clone());
            continue;
        }
        return Err(unsupported_load_property("WorksheetCollection", property));
    }
    Ok(normalized)
}

fn find_by_id(workbook: &Workbook, id: &str) -> Result<Option<WorksheetRef>, WorksheetError> {
    for index in 0..workbook.sheet_count().map_err(compute_error)? {
        let sheet = workbook.sheet_by_index(index).map_err(compute_error)?;
        if sheet.id().to_uuid_string().eq_ignore_ascii_case(id) {
            return Ok(Some(WorksheetRef::new(workbook.clone(), sheet)));
        }
    }
    Ok(None)
}

fn unique_copy_name(workbook: &Workbook, source_name: &str) -> Result<String, WorksheetError> {
    let names = workbook.sheet_names().map_err(compute_error)?;
    for index in 2..10_000 {
        let candidate = format!("{source_name} ({index})");
        if !names
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(&candidate))
        {
            return Ok(candidate);
        }
    }
    Err(WorksheetError {
        code: "GeneralException",
        message: "Unable to generate a unique worksheet copy name".to_string(),
    })
}

fn validate_sheet_name(
    workbook: &Workbook,
    sheet_id: &SheetId,
    name: &str,
) -> Result<(), WorksheetError> {
    if name.is_empty() || name.chars().count() > 31 {
        return Err(WorksheetError {
            code: "InvalidArgument",
            message: "Worksheet.name must contain 1 through 31 characters.".to_string(),
        });
    }
    if name.chars().any(|character| ":\\/?*[]".contains(character)) {
        return Err(WorksheetError {
            code: "InvalidArgument",
            message: "Worksheet.name contains a character that is not allowed in a worksheet name."
                .to_string(),
        });
    }

    for index in 0..workbook.sheet_count().map_err(compute_error)? {
        let sheet = workbook.sheet_by_index(index).map_err(compute_error)?;
        if sheet.id() == sheet_id {
            continue;
        }
        if sheet
            .name()
            .map_err(compute_error)?
            .eq_ignore_ascii_case(name)
        {
            return Err(WorksheetError {
                code: "InvalidArgument",
                message: format!("A worksheet named '{name}' already exists."),
            });
        }
    }
    Ok(())
}

fn parse_visibility(value: &Value) -> Result<&'static str, WorksheetError> {
    let token = value.as_str().ok_or_else(|| WorksheetError {
        code: "InvalidArgument",
        message: "Worksheet.visibility must be Visible, Hidden, or VeryHidden.".to_string(),
    })?;
    match token.to_ascii_lowercase().as_str() {
        "visible" => Ok("visible"),
        "hidden" => Ok("hidden"),
        "veryhidden" => Ok("veryHidden"),
        _ => Err(WorksheetError {
            code: "InvalidArgument",
            message: format!(
                "Worksheet.visibility must be Visible, Hidden, or VeryHidden; got '{token}'."
            ),
        }),
    }
}

fn visibility_token(state: &str) -> &'static str {
    match state {
        "hidden" => "Hidden",
        "veryHidden" => "VeryHidden",
        _ => "Visible",
    }
}

fn required_string<'a>(value: &'a Value, property: &str) -> Result<&'a str, WorksheetError> {
    value.as_str().ok_or_else(|| WorksheetError {
        code: "InvalidArgument",
        message: format!("{property} must be a string."),
    })
}

fn required_u32(value: &Value, property: &str) -> Result<u32, WorksheetError> {
    value
        .as_u64()
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| WorksheetError {
            code: "InvalidArgument",
            message: format!("{property} must be a non-negative integer."),
        })
}

fn unsupported_load_property(object: &str, property: &str) -> WorksheetError {
    WorksheetError {
        code: "InvalidArgument",
        message: format!("Unsupported {object} load property '{property}'"),
    }
}

fn item_not_found(key: &str) -> WorksheetError {
    WorksheetError {
        code: "ItemNotFound",
        message: format!("The requested worksheet doesn't exist. Name or ID: {key}"),
    }
}

/// Host adapter for worksheet operations that are not in the core `Op` enum.
pub(crate) struct WorksheetOpsHandler;

impl ExtensionHandler for WorksheetOpsHandler {
    fn can_handle(&self, operation: &str) -> bool {
        operation == "worksheetCopy"
    }

    fn handle(
        &self,
        operation: &Value,
        context: &mut HostDispatchContext<'_>,
    ) -> Result<bool, BatchError> {
        let id = string_field(operation, "id")?;
        let worksheet_id = string_field(operation, "worksheetId")?;
        let position = operation.get("positionType").and_then(Value::as_str);
        let source = context.worksheet(worksheet_id)?;
        let copied = source.copy(position).map_err(|error| BatchError {
            code: error.code,
            message: error.message,
        })?;
        context.bind_worksheet(id, copied);
        Ok(true)
    }
}

fn string_field<'a>(operation: &'a Value, field: &str) -> Result<&'a str, BatchError> {
    operation
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| BatchError {
            code: "InvalidArgument",
            message: format!("worksheetCopy requires {field}"),
        })
}

fn compute_error(error: ComputeApiError) -> WorksheetError {
    let message = error.to_string();
    let code = match error {
        ComputeApiError::SheetNotFound { .. } => "ItemNotFound",
        ComputeApiError::InvalidAddress { .. } | ComputeApiError::InvalidRange { .. } => {
            "InvalidArgument"
        }
        ComputeApiError::InvalidOperation(_) => "InvalidOperation",
        _ => "GeneralException",
    };
    WorksheetError { code, message }
}

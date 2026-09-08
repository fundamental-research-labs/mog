//! Office.js worksheet and workbook protection adapters.
//!
//! The Office.js protection objects are request-context proxies.  This module
//! owns only the host-side references and the translation between the public
//! Office option names and the durable compute-api protection state.  Password
//! strings are converted to Excel's legacy worksheet/workbook hash at the
//! boundary and are never retained on a proxy or in host state.

use std::collections::HashMap;

use compute_api::{ComputeApiError, Sheet, SheetProtectionOptions, Workbook};
use serde_json::{Value, json};

/// Error returned by an Office.js protection host operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProtectionError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

/// Host-side worksheet protection reference.
///
/// The reference is anchored by the engine's stable [`Sheet`] handle.  Every
/// query resolves the current engine state, so a fresh Office.js protection
/// proxy observes protection changes made by another request context.
#[derive(Clone)]
pub(crate) struct WorksheetProtectionRef {
    workbook: Workbook,
    sheet: Sheet,
}

impl WorksheetProtectionRef {
    pub(crate) fn new(workbook: Workbook, sheet: Sheet) -> Self {
        Self { workbook, sheet }
    }

    /// Load scalar properties exposed by the supported Office.js contract.
    pub(crate) fn load(
        &self,
        properties: &[String],
    ) -> Result<HashMap<String, Value>, ProtectionError> {
        let config = self
            .sheet
            .protection()
            .get_config()
            .map_err(compute_error)?;
        let settings = self
            .workbook
            .sheets()
            .get_sheet_settings(self.sheet.id())
            .map_err(compute_error)?;
        let options = settings.protection_options.unwrap_or_default();

        let mut result = HashMap::new();
        for property in properties {
            let value = match property.as_str() {
                // The host may ask for this inherited transport property
                // explicitly; ordinary protection proxies are always real
                // objects (there is no `getOrNullObject` protection API).
                "isNullObject" => Value::Bool(false),
                "protected" => Value::Bool(config.is_protected),
                "isPasswordProtected" => Value::Bool(
                    config
                        .protection_password_hash
                        .as_deref()
                        .is_some_and(|hash| !hash.is_empty()),
                ),
                "options" | "savedOptions" => options_to_json(&options)?,
                // The engine has no session-scoped pause state or edit-range
                // collection.  Keep those members explicit instead of
                // manufacturing values from the durable protection flag.
                "canPauseProtection" | "isPaused" | "allowEditRanges" => {
                    return Err(unsupported(format!(
                        "WorksheetProtection.{property} is unavailable because protection pause and allow-edit ranges are not implemented"
                    )));
                }
                other => return Err(unsupported_load_property("WorksheetProtection", other)),
            };
            result.insert(property.clone(), value);
        }
        Ok(result)
    }

    /// Protect the worksheet, optionally replacing its complete option set.
    pub(crate) fn protect(
        &self,
        options: Option<&Value>,
        password: Option<&str>,
    ) -> Result<(), ProtectionError> {
        let config = self
            .sheet
            .protection()
            .get_config()
            .map_err(compute_error)?;
        if config.is_protected {
            return Err(invalid_operation(
                "WorksheetProtection.protect cannot protect an already protected worksheet",
            ));
        }

        let password_hash = password_hash(password);
        match options {
            Some(value) => {
                let options = options_from_json(value, SheetProtectionOptions::default())?;
                self.sheet
                    .protection()
                    .protect_with_options(password_hash, options)
                    .map_err(compute_error)?;
            }
            None => {
                // The engine's protect_sheet path preserves saved options,
                // matching Office's omitted-options behavior.
                self.sheet
                    .protection()
                    .protect(password_hash)
                    .map_err(compute_error)?;
            }
        }
        Ok(())
    }

    /// Unprotect the worksheet using the engine's password enforcement.
    pub(crate) fn unprotect(&self, password: Option<&str>) -> Result<(), ProtectionError> {
        self.sheet
            .protection()
            .unprotect(password_hash(password))
            .map_err(compute_error)?;
        Ok(())
    }

    /// Check a password without changing worksheet protection state.
    pub(crate) fn check_password(&self, password: Option<&str>) -> Result<bool, ProtectionError> {
        let config = self
            .sheet
            .protection()
            .get_config()
            .map_err(compute_error)?;
        match (
            config
                .protection_password_hash
                .as_deref()
                .filter(|hash| !hash.is_empty()),
            password,
        ) {
            (Some(stored), Some(provided)) => {
                Ok(stored == password_hash(Some(provided)).as_deref().unwrap_or_default())
            }
            (Some(_), None) => Ok(false),
            (None, Some(_)) => Ok(false),
            // With no password required, an omitted password is usable to
            // unlock the worksheet.  A supplied password is explicitly not.
            (None, None) => Ok(true),
        }
    }

    /// Update worksheet protection options while preserving state/password.
    pub(crate) fn update_options(&self, value: &Value) -> Result<(), ProtectionError> {
        let config = self
            .sheet
            .protection()
            .get_config()
            .map_err(compute_error)?;
        if config.is_protected {
            return Err(access_denied(
                "WorksheetProtection.updateOptions requires protection to be disabled or paused",
            ));
        }

        let current = self
            .workbook
            .sheets()
            .get_sheet_settings(self.sheet.id())
            .map_err(compute_error)?
            .protection_options
            .unwrap_or_default();
        let options = options_from_json(value, current)?;
        self.sheet
            .protection()
            .set_options(options)
            .map_err(compute_error)?;
        Ok(())
    }
}

/// Host-side workbook protection reference.
#[derive(Clone)]
pub(crate) struct WorkbookProtectionRef {
    workbook: Workbook,
}

impl WorkbookProtectionRef {
    pub(crate) fn new(workbook: Workbook) -> Self {
        Self { workbook }
    }

    pub(crate) fn load(
        &self,
        properties: &[String],
    ) -> Result<HashMap<String, Value>, ProtectionError> {
        let protected = self
            .workbook
            .protection()
            .is_workbook_protected()
            .map_err(compute_error)?;
        let mut result = HashMap::new();
        for property in properties {
            let value = match property.as_str() {
                "isNullObject" => Value::Bool(false),
                "protected" => Value::Bool(protected),
                other => return Err(unsupported_load_property("WorkbookProtection", other)),
            };
            result.insert(property.clone(), value);
        }
        Ok(result)
    }

    pub(crate) fn protect(&self, password: Option<&str>) -> Result<(), ProtectionError> {
        if self
            .workbook
            .protection()
            .is_workbook_protected()
            .map_err(compute_error)?
        {
            return Err(invalid_operation(
                "WorkbookProtection.protect cannot protect an already protected workbook",
            ));
        }
        self.workbook
            .protection()
            .protect_workbook(password_hash(password))
            .map_err(compute_error)?;
        Ok(())
    }

    pub(crate) fn unprotect(&self, password: Option<&str>) -> Result<(), ProtectionError> {
        let result = self
            .workbook
            .protection()
            .unprotect_workbook(password_hash(password))
            .map_err(compute_error)?;
        // The workbook engine reports a password mismatch as successful
        // dispatch with `MutationResult.data == false` (the sheet engine
        // returns an error directly).  Normalize that engine result to the
        // Office.js InvalidArgument contract without weakening the engine's
        // password check or retaining the supplied password.
        if result.data.as_ref().and_then(Value::as_bool) == Some(false) {
            return Err(invalid_argument("Incorrect password"));
        }
        Ok(())
    }
}

fn options_to_json(options: &SheetProtectionOptions) -> Result<Value, ProtectionError> {
    Ok(json!({
        "allowAutoFilter": options.use_auto_filter,
        "allowDeleteColumns": options.delete_columns,
        "allowDeleteRows": options.delete_rows,
        "allowEditObjects": options.edit_objects,
        "allowEditScenarios": options.edit_scenarios,
        "allowFormatCells": options.format_cells,
        "allowFormatColumns": options.format_columns,
        "allowFormatRows": options.format_rows,
        "allowInsertColumns": options.insert_columns,
        "allowInsertHyperlinks": options.insert_hyperlinks,
        "allowInsertRows": options.insert_rows,
        "allowPivotTables": options.use_pivot_table_reports,
        "allowSort": options.sort,
        "selectionMode": selection_mode(options)?,
    }))
}

fn selection_mode(options: &SheetProtectionOptions) -> Result<&'static str, ProtectionError> {
    match (options.select_locked_cells, options.select_unlocked_cells) {
        (true, true) => Ok("Normal"),
        (false, true) => Ok("Unlocked"),
        (false, false) => Ok("None"),
        (true, false) => Err(unsupported(
            "WorksheetProtection.options contains a selection combination with no Office.js selectionMode equivalent",
        )),
    }
}

fn options_from_json(
    value: &Value,
    mut options: SheetProtectionOptions,
) -> Result<SheetProtectionOptions, ProtectionError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid_argument("WorksheetProtectionOptions must be a plain object"))?;
    for (property, value) in object {
        if value.is_null() {
            return Err(invalid_argument(format!(
                "WorksheetProtectionOptions.{property} cannot be null"
            )));
        }
        match property.as_str() {
            "allowAutoFilter" => options.use_auto_filter = bool_value(value, property)?,
            "allowDeleteColumns" => options.delete_columns = bool_value(value, property)?,
            "allowDeleteRows" => options.delete_rows = bool_value(value, property)?,
            "allowEditObjects" => options.edit_objects = bool_value(value, property)?,
            "allowEditScenarios" => options.edit_scenarios = bool_value(value, property)?,
            "allowFormatCells" => options.format_cells = bool_value(value, property)?,
            "allowFormatColumns" => options.format_columns = bool_value(value, property)?,
            "allowFormatRows" => options.format_rows = bool_value(value, property)?,
            "allowInsertColumns" => options.insert_columns = bool_value(value, property)?,
            "allowInsertHyperlinks" => options.insert_hyperlinks = bool_value(value, property)?,
            "allowInsertRows" => options.insert_rows = bool_value(value, property)?,
            "allowPivotTables" => options.use_pivot_table_reports = bool_value(value, property)?,
            "allowSort" => options.sort = bool_value(value, property)?,
            "selectionMode" => match value.as_str() {
                Some("Normal") => {
                    options.select_locked_cells = true;
                    options.select_unlocked_cells = true;
                }
                Some("Unlocked") => {
                    options.select_locked_cells = false;
                    options.select_unlocked_cells = true;
                }
                Some("None") => {
                    options.select_locked_cells = false;
                    options.select_unlocked_cells = false;
                }
                Some(other) => {
                    return Err(invalid_argument(format!(
                        "Unsupported WorksheetProtectionOptions.selectionMode value '{other}'"
                    )));
                }
                None => {
                    return Err(invalid_argument(
                        "WorksheetProtectionOptions.selectionMode must be a string enum value",
                    ));
                }
            },
            other => {
                return Err(invalid_argument(format!(
                    "Unsupported WorksheetProtectionOptions property '{other}'"
                )));
            }
        }
    }
    Ok(options)
}

fn bool_value(value: &Value, property: &str) -> Result<bool, ProtectionError> {
    value.as_bool().ok_or_else(|| {
        invalid_argument(format!(
            "WorksheetProtectionOptions.{property} must be a boolean"
        ))
    })
}

/// Excel's legacy worksheet/workbook password hash.
///
/// This is the same byte-oriented legacy hash used by the OOXML writer in
/// `file-io/xlsx/parser`.  Protection stores this value in the engine; keeping
/// the adapter's implementation identical is what lets an Office.js password
/// unlock a workbook that is later exported (and vice versa).
fn password_hash(password: Option<&str>) -> Option<String> {
    let password = password.filter(|password| !password.is_empty())?;
    let bytes = password.as_bytes();
    let mut hash: u16 = 0;
    for (index, byte) in bytes.iter().enumerate() {
        let shift = (index + 1) % 15;
        let value = *byte as u16;
        let rotated = if shift == 0 {
            value
        } else {
            ((value << shift) | (value >> (15 - shift))) & 0x7fff
        };
        hash ^= rotated;
    }
    hash ^= bytes.len() as u16;
    hash ^= 0xce4b;
    Some(format!("{hash:04X}"))
}

fn compute_error(error: ComputeApiError) -> ProtectionError {
    let error_message = error.to_string();
    match error {
        ComputeApiError::InvalidOperation(message) => ProtectionError {
            code: "InvalidOperation",
            message,
        },
        ComputeApiError::InvalidAddress { .. } | ComputeApiError::InvalidRange { .. } => {
            ProtectionError {
                code: "InvalidArgument",
                message: error_message,
            }
        }
        ComputeApiError::SheetNotFound { id } => ProtectionError {
            code: "ItemNotFound",
            message: format!("Worksheet '{id}' was not found"),
        },
        ComputeApiError::Compute(value_types::ComputeError::InvalidInput { message }) => {
            let code = if message.to_ascii_lowercase().contains("incorrect password") {
                "InvalidArgument"
            } else {
                "GeneralException"
            };
            ProtectionError { code, message }
        }
        other => ProtectionError {
            code: "GeneralException",
            message: other.to_string(),
        },
    }
}

fn unsupported_load_property(object: &str, property: &str) -> ProtectionError {
    invalid_argument(format!("Unsupported {object} load property '{property}'"))
}

fn unsupported(message: impl Into<String>) -> ProtectionError {
    ProtectionError {
        code: "ApiNotFound",
        message: message.into(),
    }
}

fn invalid_argument(message: impl Into<String>) -> ProtectionError {
    ProtectionError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn invalid_operation(message: impl Into<String>) -> ProtectionError {
    ProtectionError {
        code: "InvalidOperation",
        message: message.into(),
    }
}

fn access_denied(message: impl Into<String>) -> ProtectionError {
    ProtectionError {
        code: "AccessDenied",
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::{options_from_json, password_hash};
    use compute_api::SheetProtectionOptions;
    use serde_json::json;

    #[test]
    fn excel_password_hash_uses_known_legacy_vectors() {
        assert_eq!(password_hash(Some("password")).as_deref(), Some("83AF"));
        assert_eq!(password_hash(Some("test")).as_deref(), Some("CBEB"));
        assert_eq!(password_hash(Some("pass")).as_deref(), Some("CB83"));
        assert_eq!(password_hash(Some("")).as_deref(), None);
    }

    #[test]
    fn office_options_translate_to_engine_options() {
        let options = options_from_json(
            &json!({
                "allowAutoFilter": true,
                "allowDeleteColumns": true,
                "allowDeleteRows": false,
                "allowEditObjects": true,
                "allowEditScenarios": false,
                "allowFormatCells": true,
                "allowFormatColumns": false,
                "allowFormatRows": true,
                "allowInsertColumns": true,
                "allowInsertHyperlinks": false,
                "allowInsertRows": true,
                "allowPivotTables": true,
                "allowSort": true,
                "selectionMode": "Unlocked"
            }),
            SheetProtectionOptions::default(),
        )
        .expect("options should translate");

        assert!(options.use_auto_filter);
        assert!(options.delete_columns);
        assert!(!options.delete_rows);
        assert!(options.edit_objects);
        assert!(options.format_cells);
        assert!(options.format_rows);
        assert!(options.insert_columns);
        assert!(options.insert_rows);
        assert!(options.use_pivot_table_reports);
        assert!(options.sort);
        assert!(!options.select_locked_cells);
        assert!(options.select_unlocked_cells);
    }
}

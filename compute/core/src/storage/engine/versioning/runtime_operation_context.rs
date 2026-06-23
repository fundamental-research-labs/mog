use cell_types::SheetId;
use serde::Serialize;
use serde_json::{Value, json};
use value_types::ComputeError;

use crate::snapshot::{
    RuntimeOperationDiagnostic, VersionOperationContextWire, VersionWriteAdmissionModeWire,
};

const MISSING_CONTEXT_CODE: &str = "versioning.admission.missing-context";
const BLOCKED_WRITE_CODE: &str = "versioning.admission.blocked-write";
const MISSING_CONTEXT_REASON: &str = "missingVersionOperationContext";
const BLOCKED_WRITE_REASON: &str = "writeAdmissionModeBlock";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum VersionRuntimeAdmissionPolicy {
    ObserveOnly,
    RequireOperationContext,
}

impl Default for VersionRuntimeAdmissionPolicy {
    fn default() -> Self {
        Self::ObserveOnly
    }
}

impl VersionRuntimeAdmissionPolicy {
    fn requires_context(self) -> bool {
        matches!(self, Self::RequireOperationContext)
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::ObserveOnly => "observeOnly",
            Self::RequireOperationContext => "requireOperationContext",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct VersionRuntimeDirectEditRange {
    sheet_id: String,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::storage::engine) struct VersionRuntimeAdmissionLocation {
    sheet_id: Option<String>,
    edit_count: usize,
    direct_edit_range: Option<VersionRuntimeDirectEditRange>,
}

impl VersionRuntimeAdmissionLocation {
    pub(in crate::storage::engine) fn from_position_edits(
        edits: impl IntoIterator<Item = (SheetId, u32, u32)>,
    ) -> Self {
        let mut edit_count = 0usize;
        let mut range: Option<VersionRuntimeDirectEditRange> = None;
        let mut mixed_sheets = false;

        for (sheet_id, row, col) in edits {
            edit_count += 1;
            let sheet_id = sheet_id.to_uuid_string();
            match &mut range {
                Some(existing) if existing.sheet_id == sheet_id => {
                    existing.start_row = existing.start_row.min(row);
                    existing.start_col = existing.start_col.min(col);
                    existing.end_row = existing.end_row.max(row);
                    existing.end_col = existing.end_col.max(col);
                }
                Some(_) => {
                    mixed_sheets = true;
                }
                None => {
                    range = Some(VersionRuntimeDirectEditRange {
                        sheet_id,
                        start_row: row,
                        start_col: col,
                        end_row: row,
                        end_col: col,
                    });
                }
            }
        }

        let direct_edit_range = if mixed_sheets { None } else { range };
        let sheet_id = direct_edit_range
            .as_ref()
            .map(|range| range.sheet_id.clone());

        Self {
            sheet_id,
            edit_count,
            direct_edit_range,
        }
    }

    fn diagnostic_sheet_id(&self) -> String {
        self.sheet_id.clone().unwrap_or_default()
    }

    fn to_diagnostic_location(&self) -> Option<Value> {
        if self.edit_count == 0 {
            return None;
        }

        let range = self.direct_edit_range.as_ref().map(|range| {
            json!({
                "sheetId": range.sheet_id,
                "startRow": range.start_row,
                "startCol": range.start_col,
                "endRow": range.end_row,
                "endCol": range.end_col,
            })
        });

        Some(json!({
            "kind": if range.is_some() { "directEditRange" } else { "mixedSheetDirectEdits" },
            "editCount": self.edit_count,
            "range": range,
        }))
    }
}

#[derive(Debug, Default)]
pub(in crate::storage::engine) struct VersionRuntimeOperationContext {
    active_context: Option<VersionOperationContextWire>,
    policy: VersionRuntimeAdmissionPolicy,
}

impl VersionRuntimeOperationContext {
    pub(in crate::storage::engine) fn set_context(&mut self, context: VersionOperationContextWire) {
        self.active_context = Some(context);
    }

    pub(in crate::storage::engine) fn clear_context(
        &mut self,
    ) -> Option<VersionOperationContextWire> {
        self.active_context.take()
    }

    pub(in crate::storage::engine) fn admit(
        &mut self,
        command: &'static str,
        location: VersionRuntimeAdmissionLocation,
        diagnostics: &mut Vec<RuntimeOperationDiagnostic>,
    ) -> Result<(), ComputeError> {
        let Some(context) = self.active_context.take() else {
            diagnostics.push(missing_context_diagnostic(command, &location, self.policy));
            return if self.policy.requires_context() {
                Err(ComputeError::InvalidInput {
                    message: format!(
                        "{MISSING_CONTEXT_CODE}: missing VersionOperationContext for {command}"
                    ),
                })
            } else {
                Ok(())
            };
        };

        if matches!(
            context.write_admission_mode,
            VersionWriteAdmissionModeWire::Block
        ) {
            diagnostics.push(blocked_write_diagnostic(command, &location, &context));
            return Err(ComputeError::InvalidInput {
                message: format!("{BLOCKED_WRITE_CODE}: VersionOperationContext blocked {command}"),
            });
        }

        Ok(())
    }

    #[cfg(test)]
    pub(in crate::storage::engine) fn set_require_context_for_tests(&mut self, required: bool) {
        self.policy = if required {
            VersionRuntimeAdmissionPolicy::RequireOperationContext
        } else {
            VersionRuntimeAdmissionPolicy::ObserveOnly
        };
    }
}

fn missing_context_diagnostic(
    command: &'static str,
    location: &VersionRuntimeAdmissionLocation,
    policy: VersionRuntimeAdmissionPolicy,
) -> RuntimeOperationDiagnostic {
    RuntimeOperationDiagnostic {
        id: "runtime-diagnostic-pending".to_string(),
        sequence: "0".to_string(),
        code: MISSING_CONTEXT_CODE.to_string(),
        severity: if policy.requires_context() {
            "error".to_string()
        } else {
            "warning".to_string()
        },
        recoverability: if policy.requires_context() {
            "blocked_until_context_attached".to_string()
        } else {
            "observed_missing_context".to_string()
        },
        operation: command.to_string(),
        sheet_id: location.diagnostic_sheet_id(),
        filter_id: None,
        filter_kind: None,
        table_id: None,
        reason: Some(MISSING_CONTEXT_REASON.to_string()),
        reasons: vec![MISSING_CONTEXT_REASON.to_string()],
        details: Some(json!({
            "admissionPolicy": policy.as_str(),
            "required": policy.requires_context(),
        })),
        location: location.to_diagnostic_location(),
    }
}

fn blocked_write_diagnostic(
    command: &'static str,
    location: &VersionRuntimeAdmissionLocation,
    context: &VersionOperationContextWire,
) -> RuntimeOperationDiagnostic {
    RuntimeOperationDiagnostic {
        id: "runtime-diagnostic-pending".to_string(),
        sequence: "0".to_string(),
        code: BLOCKED_WRITE_CODE.to_string(),
        severity: "error".to_string(),
        recoverability: "blocked".to_string(),
        operation: command.to_string(),
        sheet_id: location.diagnostic_sheet_id(),
        filter_id: None,
        filter_kind: None,
        table_id: None,
        reason: Some(BLOCKED_WRITE_REASON.to_string()),
        reasons: vec![BLOCKED_WRITE_REASON.to_string()],
        details: Some(json!({
            "operationId": context.operation_id,
            "capturePolicy": enum_json(&context.capture_policy),
            "writeAdmissionMode": enum_json(&context.write_admission_mode),
            "kind": enum_json(&context.kind),
            "domainIds": context.domain_ids,
        })),
        location: location.to_diagnostic_location(),
    }
}

fn enum_json(value: &impl Serialize) -> Value {
    serde_json::to_value(value).unwrap_or(Value::Null)
}

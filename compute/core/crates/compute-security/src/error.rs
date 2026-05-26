use thiserror::Error;
use value_types::ComputeError;

use crate::level::AccessLevel;
use crate::policy::AccessTarget;
use crate::principal::Principal;

#[derive(Debug, Clone, Error, PartialEq, Eq)]
pub enum SecurityError {
    #[error("access denied: principal {principal:?} lacks {required:?} access to {target:?}")]
    Denied {
        principal: Principal,
        target: AccessTarget,
        required: AccessLevel,
        actual: AccessLevel,
        operation: &'static str,
    },

    #[error(
        "attenuation violation: caller cannot grant {requested:?} because caller has only {caller:?}"
    )]
    AttenuationViolation {
        requested: AccessLevel,
        caller: AccessLevel,
    },
}

/// Render an `AccessTarget` as a compact human-readable string for the
/// bridge-boundary `ComputeError::SecurityDenied` payload. The flat-
/// string form is what SDKs see — `AccessTarget` is a compute-security
/// type that value-types cannot name (value-types sits below
/// compute-security in the crate graph).
fn render_target(target: &AccessTarget) -> String {
    match target {
        AccessTarget::Workbook => "workbook".to_string(),
        AccessTarget::Sheet { sheet_id } => format!("sheet:{}", sheet_id.to_uuid_string()),
        AccessTarget::Column { sheet_id, col_id } => format!(
            "column:{}:{}",
            sheet_id.to_uuid_string(),
            col_id.to_uuid_string()
        ),
    }
}

fn render_level(level: AccessLevel) -> &'static str {
    match level {
        AccessLevel::None => "none",
        AccessLevel::Structure => "structure",
        AccessLevel::Read => "read",
        AccessLevel::Write => "write",
        AccessLevel::Admin => "admin",
    }
}

/// Bridge `SecurityError` into the engine's common `ComputeError` type
/// so gated delegate methods that declare `error_type = ComputeError`
/// can surface denials via `?`. The payload is flattened to plain
/// strings because `value-types` (the owner of `ComputeError`) cannot
/// depend on compute-security. SDK bindings re-hydrate the shape into
/// typed structures in `ComputeApiError::SecurityDenied` (R3.3).
impl From<SecurityError> for ComputeError {
    fn from(err: SecurityError) -> Self {
        match err {
            SecurityError::Denied {
                principal,
                target,
                required,
                actual,
                operation,
            } => ComputeError::SecurityDenied {
                principal_tags: principal
                    .tags()
                    .iter()
                    .map(|t| t.as_str().to_string())
                    .collect::<Vec<_>>()
                    .join(","),
                target: render_target(&target),
                required: render_level(required).to_string(),
                actual: render_level(actual).to_string(),
                operation: operation.to_string(),
            },
            SecurityError::AttenuationViolation { requested, caller } => {
                ComputeError::SecurityDenied {
                    principal_tags: String::new(),
                    target: "attenuation".to_string(),
                    required: render_level(requested).to_string(),
                    actual: render_level(caller).to_string(),
                    operation: "attenuation_violation".to_string(),
                }
            }
        }
    }
}

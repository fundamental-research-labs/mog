//! Office.js application and workbook calculation translation.
//!
//! The JavaScript adapter owns request-context proxy identity.  This module
//! owns the corresponding workbook-backed references and translates the
//! calculation operations into compute-api calls.  In particular, calculation
//! is never implemented by a proxy-side flag: `Application.calculate` must
//! reach the engine's recalculate/rebuild paths.

use std::collections::HashMap;
use std::sync::Arc;

use compute_api::{ComputeApiError, Workbook};
use serde_json::{Map, Value};
use value_types::FiniteF64;

use crate::dispatch::{ExtensionHandler, ExtensionObject, HostDispatchContext};
use crate::host::BatchError;

/// Handler for the application/workbook calculation wire operations emitted
/// by `application.js`.
///
/// The operation names intentionally stay outside the core `Op` enum so the
/// family can be integrated by registering this handler without changing the
/// central host decoder:
///
/// * `applicationBind { id }`
/// * `workbookBind { id }`
/// * `iterativeCalculationBind { id, applicationId }`
/// * `applicationCalculate { id, calculationType }`
pub(crate) struct ApplicationHandler;

impl ExtensionHandler for ApplicationHandler {
    fn can_handle(&self, operation: &str) -> bool {
        matches!(
            operation,
            "applicationBind"
                | "workbookBind"
                | "iterativeCalculationBind"
                | "applicationCalculate"
        )
    }

    fn handle(
        &self,
        operation: &Value,
        context: &mut HostDispatchContext<'_>,
    ) -> Result<bool, BatchError> {
        let name = operation
            .get("op")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("application operation is missing its op name"))?;

        match name {
            "applicationBind" => {
                let id = required_string(operation, "id")?;
                context.bind_object(&id, Arc::new(ApplicationRef::new(context.workbook())));
                Ok(true)
            }
            "workbookBind" => {
                let id = required_string(operation, "id")?;
                context.bind_object(&id, Arc::new(WorkbookRef::new(context.workbook())));
                Ok(true)
            }
            "iterativeCalculationBind" => {
                let id = required_string(operation, "id")?;
                let application_id = required_string(operation, "applicationId")?;
                let application = context.extension_object::<ApplicationRef>(&application_id)?;
                context.bind_object(&id, Arc::new(application.iterative_calculation()));
                Ok(true)
            }
            "applicationCalculate" => {
                let id = required_string(operation, "id")?;
                let calculation_type = required_string(operation, "calculationType")?;
                let application = context.extension_object::<ApplicationRef>(&id)?;
                application.calculate(calculation_type)?;
                Ok(true)
            }
            _ => Ok(false),
        }
    }
}

/// A workbook-backed `Excel.Application` reference.
#[derive(Clone)]
pub(crate) struct ApplicationRef {
    workbook: Workbook,
}

/// A workbook-backed `Excel.Workbook` reference for calculation settings.
#[derive(Clone)]
pub(crate) struct WorkbookRef {
    workbook: Workbook,
}

/// A workbook-backed `Excel.IterativeCalculation` reference.
#[derive(Clone)]
pub(crate) struct IterativeCalculationRef {
    workbook: Workbook,
}

impl ApplicationRef {
    pub(crate) fn new(workbook: Workbook) -> Self {
        Self { workbook }
    }

    fn iterative_calculation(&self) -> IterativeCalculationRef {
        IterativeCalculationRef {
            workbook: self.workbook.clone(),
        }
    }

    fn calculation_settings(&self) -> Result<Map<String, Value>, BatchError> {
        let settings = self
            .workbook
            .settings()
            .get_workbook_settings()
            .map_err(compute_error)?;
        let value = serde_json::to_value(settings).map_err(encoding_error)?;
        Ok(value
            .get("calculationSettings")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default())
    }

    fn calculation_mode(&self) -> Result<&'static str, BatchError> {
        let calculation = self.calculation_settings()?;
        Ok(match calculation.get("calcMode").and_then(Value::as_str) {
            Some("manual") => "Manual",
            Some("autoNoTable") => "AutomaticExceptTables",
            Some("auto") | None => "Automatic",
            Some(other) => {
                return Err(engine_error(format!(
                    "The engine returned an unknown calculation mode '{other}'"
                )));
            }
        })
    }

    fn calculation_state(&self) -> Result<String, BatchError> {
        self.workbook.calculation_state().map_err(compute_error)
    }

    fn calculate(&self, calculation_type: &str) -> Result<(), BatchError> {
        if !matches!(calculation_type, "Recalculate" | "Full" | "FullRebuild") {
            return Err(invalid(format!(
                "Application.calculate calculationType '{calculation_type}' is invalid"
            )));
        }
        self.workbook
            .calculate(calculation_type)
            .map(|_| ())
            .map_err(compute_error)
    }
}

impl ExtensionObject for ApplicationRef {
    fn object_type(&self) -> &'static str {
        "Application"
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        let mut result = HashMap::new();
        for property in properties {
            let value = match property.as_str() {
                "calculationMode" => Value::String(self.calculation_mode()?.to_string()),
                "calculationState" => Value::String(self.calculation_state()?),
                "isNullObject" => Value::Bool(false),
                // Navigation is bound and loaded as its own ClientObject by
                // the JavaScript adapter. It must not be hydrated as a scalar.
                "iterativeCalculation" => continue,
                "activeWindow" | "cultureInfo" | "windows" => {
                    return Err(unsupported(format!(
                        "Application.{property} is not supported by this host"
                    )));
                }
                "calculationEngineVersion"
                | "decimalSeparator"
                | "thousandsSeparator"
                | "useSystemSeparators" => {
                    return Err(unsupported(format!(
                        "Application.{property} is not supported by this host"
                    )));
                }
                other => {
                    return Err(unsupported(format!(
                        "Application.{other} is not supported by this host"
                    )));
                }
            };
            result.insert(property.clone(), value);
        }
        Ok(result)
    }

    fn set(&self, property: &str, value: &Value) -> Result<(), BatchError> {
        match property {
            "calculationMode" => {
                let mode = value.as_str().ok_or_else(|| {
                    invalid("Application.calculationMode must be a string".to_string())
                })?;
                let mode = match mode {
                    "Automatic" => "auto",
                    "AutomaticExceptTables" => "autoNoTable",
                    "Manual" => "manual",
                    other => {
                        return Err(invalid(format!(
                            "Application.calculationMode '{other}' is invalid"
                        )));
                    }
                };
                self.workbook
                    .settings()
                    .set_calculation_mode(mode)
                    .map(|_| ())
                    .map_err(compute_error)
            }
            other => Err(unsupported(format!(
                "Application.{other} is read-only or unsupported"
            ))),
        }
    }
}

impl ExtensionObject for WorkbookRef {
    fn object_type(&self) -> &'static str {
        "Workbook"
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        let settings = self
            .workbook
            .settings()
            .get_workbook_settings()
            .map_err(compute_error)?;
        let calculation = settings.calculation_settings.unwrap_or_default();
        let mut result = HashMap::new();
        for property in properties {
            let value = match property.as_str() {
                "usePrecisionAsDisplayed" => Value::Bool(!calculation.full_precision),
                "isNullObject" => Value::Bool(false),
                // The pinned Office.js Workbook declaration has no date1904
                // or date-system property. The engine still retains date1904
                // in WorkbookSettings for formula/date semantics and OOXML
                // round trips; it is deliberately not invented here.
                "date1904" | "dateSystem" | "calculationEngineVersion" => {
                    return Err(unsupported(format!(
                        "Workbook.{property} is not supported by this host"
                    )));
                }
                other => {
                    return Err(unsupported(format!(
                        "Workbook.{other} is not supported by this host"
                    )));
                }
            };
            result.insert(property.clone(), value);
        }
        Ok(result)
    }

    fn set(&self, property: &str, value: &Value) -> Result<(), BatchError> {
        match property {
            "usePrecisionAsDisplayed" => {
                let enabled = value.as_bool().ok_or_else(|| {
                    invalid("Workbook.usePrecisionAsDisplayed must be a boolean".to_string())
                })?;
                let mut settings = self
                    .workbook
                    .settings()
                    .get_workbook_settings()
                    .map_err(compute_error)?;
                let mut calculation = settings.calculation_settings.unwrap_or_default();
                calculation.full_precision = !enabled;
                settings.calculation_settings = Some(calculation);
                self.workbook
                    .settings()
                    .set_workbook_settings(settings)
                    .map(|_| ())
                    .map_err(compute_error)
            }
            other => Err(unsupported(format!(
                "Workbook.{other} is read-only or unsupported"
            ))),
        }
    }
}

impl ExtensionObject for IterativeCalculationRef {
    fn object_type(&self) -> &'static str {
        "IterativeCalculation"
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        let settings = self
            .workbook
            .settings()
            .get_workbook_settings()
            .map_err(compute_error)?;
        let calculation = settings.calculation_settings.unwrap_or_default();
        let mut result = HashMap::new();
        for property in properties {
            let value = match property.as_str() {
                "enabled" => Value::Bool(calculation.enable_iterative_calculation),
                "maxChange" => {
                    serde_json::to_value(calculation.max_change).map_err(encoding_error)?
                }
                "maxIteration" => Value::Number(calculation.max_iterations.into()),
                "isNullObject" => Value::Bool(false),
                other => {
                    return Err(unsupported(format!(
                        "IterativeCalculation.{other} is not supported by this host"
                    )));
                }
            };
            result.insert(property.clone(), value);
        }
        Ok(result)
    }

    fn set(&self, property: &str, value: &Value) -> Result<(), BatchError> {
        match property {
            "enabled" => self
                .workbook
                .settings()
                .set_iterative_calculation(value.as_bool().ok_or_else(|| {
                    invalid("IterativeCalculation.enabled must be a boolean".to_string())
                })?)
                .map(|_| ())
                .map_err(compute_error),
            "maxIteration" => {
                let raw = value.as_u64().ok_or_else(|| {
                    invalid(
                        "IterativeCalculation.maxIteration must be a non-negative integer"
                            .to_string(),
                    )
                })?;
                let value = u32::try_from(raw).map_err(|_| {
                    invalid("IterativeCalculation.maxIteration is out of range".to_string())
                })?;
                self.workbook
                    .settings()
                    .set_max_iterations(value)
                    .map(|_| ())
                    .map_err(compute_error)
            }
            "maxChange" => {
                let value = value.as_f64().ok_or_else(|| {
                    invalid(
                        "IterativeCalculation.maxChange must be a finite non-negative number"
                            .to_string(),
                    )
                })?;
                let value = FiniteF64::new(value)
                    .filter(|value| value.get() >= 0.0)
                    .ok_or_else(|| {
                        invalid(
                            "IterativeCalculation.maxChange must be a finite non-negative number"
                                .to_string(),
                        )
                    })?;
                let mut settings = self
                    .workbook
                    .settings()
                    .get_workbook_settings()
                    .map_err(compute_error)?;
                let mut calculation = settings.calculation_settings.unwrap_or_default();
                calculation.max_change = value;
                settings.calculation_settings = Some(calculation);
                self.workbook
                    .settings()
                    .set_workbook_settings(settings)
                    .map(|_| ())
                    .map_err(compute_error)
            }
            other => Err(unsupported(format!(
                "IterativeCalculation.{other} is read-only or unsupported"
            ))),
        }
    }
}

fn required_string<'a>(operation: &'a Value, field: &str) -> Result<&'a str, BatchError> {
    operation.get(field).and_then(Value::as_str).ok_or_else(|| {
        invalid(format!(
            "application operation field '{field}' must be a string"
        ))
    })
}

fn invalid(message: String) -> BatchError {
    BatchError {
        code: "InvalidArgument",
        message,
    }
}

fn unsupported(message: String) -> BatchError {
    BatchError {
        code: "ApiNotFound",
        message,
    }
}

fn engine_error(message: impl Into<String>) -> BatchError {
    BatchError {
        code: "GeneralException",
        message: message.into(),
    }
}

fn compute_error(error: ComputeApiError) -> BatchError {
    engine_error(error.to_string())
}

fn encoding_error(error: serde_json::Error) -> BatchError {
    engine_error(format!("failed to encode workbook settings: {error}"))
}

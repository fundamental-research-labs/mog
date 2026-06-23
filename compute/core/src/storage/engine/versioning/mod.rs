//! Engine-local version-control admission plumbing.
//!
//! This module owns runtime-only admission state for version-aware mutation
//! boundaries. It intentionally does not persist anything into Yrs; the state
//! is scoped to one engine instance and one admitted operation at a time.

pub mod diagnostics;
pub mod redaction;
mod runtime_operation_context;

use value_types::ComputeError;

use super::YrsComputeEngine;
pub(in crate::storage::engine) use runtime_operation_context::{
    VersionRuntimeAdmissionLocation, VersionRuntimeOperationContext,
};

impl YrsComputeEngine {
    pub(in crate::storage::engine) fn admit_version_runtime_operation(
        &mut self,
        command: &'static str,
        location: VersionRuntimeAdmissionLocation,
    ) -> Result<(), ComputeError> {
        let mut diagnostics = Vec::new();
        let result =
            self.version_runtime_operation_context
                .admit(command, location, &mut diagnostics);
        self.assign_and_record_runtime_diagnostics(&mut diagnostics);
        result
    }

    #[allow(dead_code)] // Bridge-ready: future generated calls will attach this before transport.
    pub(crate) fn set_version_runtime_operation_context(
        &mut self,
        context: crate::snapshot::VersionOperationContextWire,
    ) {
        self.version_runtime_operation_context.set_context(context);
    }

    #[allow(dead_code)] // Bridge-ready: lifecycle teardown can clear a pending admission.
    pub(crate) fn clear_version_runtime_operation_context(
        &mut self,
    ) -> Option<crate::snapshot::VersionOperationContextWire> {
        self.version_runtime_operation_context.clear_context()
    }

    #[cfg(test)]
    pub(crate) fn require_version_runtime_operation_context_for_tests(&mut self, required: bool) {
        self.version_runtime_operation_context
            .set_require_context_for_tests(required);
    }
}

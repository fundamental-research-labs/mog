use super::helpers::*;
use crate::bridge_types::CellInput;
use crate::snapshot::{
    CapturePolicyWire, RuntimeDiagnosticsOptions, VersionActorKindWire, VersionAuthorWire,
    VersionOperationContextWire, VersionOperationKindWire, VersionWriteAdmissionModeWire,
};
use value_types::{CellValue, ComputeError};

fn operation_context(
    operation_id: &str,
    write_admission_mode: VersionWriteAdmissionModeWire,
) -> VersionOperationContextWire {
    VersionOperationContextWire {
        operation_id: operation_id.to_string(),
        kind: VersionOperationKindWire::Mutation,
        author: VersionAuthorWire {
            author_id: "user:test".to_string(),
            actor_kind: VersionActorKindWire::User,
            display_name: None,
            client_id: None,
            session_id: None,
        },
        created_at: "2026-06-22T00:00:00.000Z".to_string(),
        workbook_id: Some("workbook:test".to_string()),
        sheet_ids: vec![sheet_id().to_uuid_string()],
        domain_ids: vec!["cells.values".to_string()],
        group_id: None,
        capture_policy: match write_admission_mode {
            VersionWriteAdmissionModeWire::Block => CapturePolicyWire::Excluded,
            VersionWriteAdmissionModeWire::ShadowOnly => CapturePolicyWire::ShadowOnly,
            VersionWriteAdmissionModeWire::CaptureDisabledNoHistory => CapturePolicyWire::Excluded,
            VersionWriteAdmissionModeWire::CaptureSuspendedWithGap => CapturePolicyWire::HistoryGap,
            VersionWriteAdmissionModeWire::Capture => CapturePolicyWire::CommitEligible,
        },
        write_admission_mode,
        client_request_id: None,
        collaboration: None,
    }
}

#[test]
fn set_cells_by_position_records_missing_context_diagnostic_in_observe_mode() {
    let snap = simple_snapshot();
    let (mut engine, _) = crate::storage::engine::YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .batch_set_cells_by_position(
            vec![(
                sid,
                0,
                2,
                CellInput::Value {
                    value: CellValue::from(42.0),
                },
            )],
            true,
        )
        .unwrap();

    assert_eq!(cell_value_at(&engine, &sid, 0, 2), CellValue::from(42.0));

    let page = engine.get_runtime_diagnostics(RuntimeDiagnosticsOptions::default());
    assert_eq!(page.diagnostics.len(), 1);
    let diagnostic = &page.diagnostics[0];
    assert_eq!(diagnostic.code, "versioning.admission.missing-context");
    assert_eq!(diagnostic.severity, "warning");
    assert_eq!(diagnostic.operation, "compute_batch_set_cells_by_position");
    assert_eq!(diagnostic.sheet_id, sid.to_uuid_string());
    assert_eq!(diagnostic.sequence, "1");
}

#[test]
fn set_cells_by_position_fails_closed_without_context_when_required() {
    let snap = simple_snapshot();
    let (mut engine, _) = crate::storage::engine::YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();
    engine.require_version_runtime_operation_context_for_tests(true);

    let result = engine.batch_set_cells_by_position(
        vec![(
            sid,
            0,
            0,
            CellInput::Value {
                value: CellValue::from(99.0),
            },
        )],
        true,
    );

    assert!(matches!(
        result,
        Err(ComputeError::InvalidInput { ref message })
            if message.contains("versioning.admission.missing-context")
    ));
    assert_eq!(cell_value_at(&engine, &sid, 0, 0), num(10.0));

    let page = engine.get_runtime_diagnostics(RuntimeDiagnosticsOptions::default());
    assert_eq!(page.diagnostics.len(), 1);
    assert_eq!(page.diagnostics[0].severity, "error");
    assert_eq!(
        page.diagnostics[0].reason.as_deref(),
        Some("missingVersionOperationContext")
    );
}

#[test]
fn set_cells_by_position_consumes_admitted_context_once() {
    let snap = simple_snapshot();
    let (mut engine, _) = crate::storage::engine::YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();
    engine.require_version_runtime_operation_context_for_tests(true);
    engine.set_version_runtime_operation_context(operation_context(
        "operation:test:1",
        VersionWriteAdmissionModeWire::Capture,
    ));

    engine
        .batch_set_cells_by_position(
            vec![(
                sid,
                0,
                2,
                CellInput::Value {
                    value: CellValue::from(7.0),
                },
            )],
            true,
        )
        .unwrap();
    assert_eq!(cell_value_at(&engine, &sid, 0, 2), CellValue::from(7.0));

    let second = engine.batch_set_cells_by_position(
        vec![(
            sid,
            0,
            3,
            CellInput::Value {
                value: CellValue::from(8.0),
            },
        )],
        true,
    );

    assert!(matches!(
        second,
        Err(ComputeError::InvalidInput { ref message })
            if message.contains("versioning.admission.missing-context")
    ));
    assert_eq!(cell_value_at(&engine, &sid, 0, 3), CellValue::Null);
}

#[test]
fn set_cells_by_position_rejects_blocked_context() {
    let snap = simple_snapshot();
    let (mut engine, _) = crate::storage::engine::YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();
    engine.set_version_runtime_operation_context(operation_context(
        "operation:test:block",
        VersionWriteAdmissionModeWire::Block,
    ));

    let result = engine.batch_set_cells_by_position(
        vec![(
            sid,
            0,
            2,
            CellInput::Value {
                value: CellValue::from(13.0),
            },
        )],
        true,
    );

    assert!(matches!(
        result,
        Err(ComputeError::InvalidInput { ref message })
            if message.contains("versioning.admission.blocked-write")
    ));
    assert_eq!(cell_value_at(&engine, &sid, 0, 2), CellValue::Null);

    let page = engine.get_runtime_diagnostics(RuntimeDiagnosticsOptions::default());
    assert_eq!(page.diagnostics.len(), 1);
    assert_eq!(
        page.diagnostics[0].code,
        "versioning.admission.blocked-write"
    );
    assert_eq!(
        page.diagnostics[0].reason.as_deref(),
        Some("writeAdmissionModeBlock")
    );
}

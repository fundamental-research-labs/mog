use std::collections::BTreeMap;

use serde_json::Value;
use snapshot_types::versioning::{
    CapturePolicyWire, VersionCaptureDiagnosticsSinkRecordKindWire, VersionCaptureFailureCodeWire,
    VersionCaptureFailureSinkRecordWire, VersionCaptureFailureStageWire,
    VersionDiagnosticSeverityWire, VersionRedactionKeyWire, VersionRedactionPolicyWire,
    VersionWriteAdmissionModeWire,
};

pub const VERSION_CAPTURE_FAILURE_SINK_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug)]
pub struct VersionCaptureFailureSinkRecordInput {
    pub diagnostic_id: String,
    pub observed_at: String,
    pub stage: VersionCaptureFailureStageWire,
    pub code: VersionCaptureFailureCodeWire,
    pub severity: VersionDiagnosticSeverityWire,
    pub message: String,
    pub operation_id: Option<String>,
    pub domain_ids: Vec<String>,
    pub capture_policy: CapturePolicyWire,
    pub write_admission_mode: VersionWriteAdmissionModeWire,
    pub redaction_policy: VersionRedactionPolicyWire,
    pub redaction_keys: Vec<VersionRedactionKeyWire>,
    pub missing_redaction_fields: Vec<String>,
    pub debug: BTreeMap<String, Value>,
}

pub fn capture_failure_sink_record(
    input: VersionCaptureFailureSinkRecordInput,
) -> VersionCaptureFailureSinkRecordWire {
    VersionCaptureFailureSinkRecordWire {
        schema_version: VERSION_CAPTURE_FAILURE_SINK_SCHEMA_VERSION,
        record_kind: VersionCaptureDiagnosticsSinkRecordKindWire::VersionCaptureFailure,
        diagnostic_id: input.diagnostic_id,
        observed_at: input.observed_at,
        stage: input.stage,
        code: input.code,
        severity: input.severity,
        message: input.message,
        operation_id: input.operation_id,
        domain_ids: input.domain_ids,
        capture_policy: input.capture_policy,
        write_admission_mode: input.write_admission_mode,
        redaction_policy: input.redaction_policy,
        redaction_keys: input.redaction_keys,
        missing_redaction_fields: input.missing_redaction_fields,
        debug: input.debug,
    }
}

pub trait VersionCaptureDiagnosticsSink {
    fn record_capture_failure(&mut self, record: VersionCaptureFailureSinkRecordWire);
}

#[derive(Debug, Default)]
pub struct InMemoryVersionCaptureDiagnosticsSink {
    records: Vec<VersionCaptureFailureSinkRecordWire>,
}

impl InMemoryVersionCaptureDiagnosticsSink {
    pub fn records(&self) -> &[VersionCaptureFailureSinkRecordWire] {
        &self.records
    }
}

impl VersionCaptureDiagnosticsSink for InMemoryVersionCaptureDiagnosticsSink {
    fn record_capture_failure(&mut self, record: VersionCaptureFailureSinkRecordWire) {
        self.records.push(record);
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::storage::engine::versioning::redaction::{
        author_id_redaction_key, provider_id_redaction_key,
    };

    #[test]
    fn sink_records_admission_failures_with_redaction_keys() {
        let mut debug = BTreeMap::new();
        debug.insert("boundary".to_string(), json!("sync-admission"));
        let record = capture_failure_sink_record(VersionCaptureFailureSinkRecordInput {
            diagnostic_id: "diagnostic:vc02-admission".to_string(),
            observed_at: "2026-06-22T00:00:00.000Z".to_string(),
            stage: VersionCaptureFailureStageWire::Admission,
            code: VersionCaptureFailureCodeWire::MissingRedactionKey,
            severity: VersionDiagnosticSeverityWire::Warning,
            message: "capture admission requires redaction keys for sensitive provenance"
                .to_string(),
            operation_id: Some("operation:vc02-admission".to_string()),
            domain_ids: vec!["runtime-diagnostics.sync-provider-admission".to_string()],
            capture_policy: CapturePolicyWire::ShadowOnly,
            write_admission_mode: VersionWriteAdmissionModeWire::ShadowOnly,
            redaction_policy: VersionRedactionPolicyWire::MetadataOnly,
            redaction_keys: vec![
                author_id_redaction_key("ada@example.com"),
                provider_id_redaction_key("indexeddb-primary"),
            ],
            missing_redaction_fields: vec!["operation.author.sessionId".to_string()],
            debug,
        });

        let json = serde_json::to_value(&record).expect("sink record serializes");
        assert_eq!(json["schemaVersion"], 1);
        assert_eq!(json["recordKind"], "version-capture-failure");
        assert_eq!(json["stage"], "admission");
        assert_eq!(json["code"], "missing_redaction_key");
        assert_eq!(
            json["missingRedactionFields"],
            json!(["operation.author.sessionId"])
        );
        assert_eq!(record.redaction_keys.len(), 2);

        let mut sink = InMemoryVersionCaptureDiagnosticsSink::default();
        sink.record_capture_failure(record.clone());

        assert_eq!(sink.records(), std::slice::from_ref(&record));
    }

    #[test]
    fn sink_records_capture_failures_without_mutation_boundary_wiring() {
        let record = capture_failure_sink_record(VersionCaptureFailureSinkRecordInput {
            diagnostic_id: "diagnostic:vc02-capture".to_string(),
            observed_at: "2026-06-22T00:01:00.000Z".to_string(),
            stage: VersionCaptureFailureStageWire::Capture,
            code: VersionCaptureFailureCodeWire::CaptureSerializationFailed,
            severity: VersionDiagnosticSeverityWire::Error,
            message: "capture serialization failed before durable history write".to_string(),
            operation_id: Some("operation:vc02-capture".to_string()),
            domain_ids: vec!["cells.values".to_string()],
            capture_policy: CapturePolicyWire::CommitEligible,
            write_admission_mode: VersionWriteAdmissionModeWire::Capture,
            redaction_policy: VersionRedactionPolicyWire::ContentRedacted,
            redaction_keys: Vec::new(),
            missing_redaction_fields: Vec::new(),
            debug: BTreeMap::new(),
        });

        let json = serde_json::to_value(&record).expect("sink record serializes");
        assert_eq!(json["recordKind"], "version-capture-failure");
        assert_eq!(json["stage"], "capture");
        assert_eq!(json["code"], "capture_serialization_failed");
        assert!(json.get("debug").is_none());
    }
}

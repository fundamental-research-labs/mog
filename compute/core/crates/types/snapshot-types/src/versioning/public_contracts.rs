use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    ObjectDigest, VersionActorKindWire, VersionDiagnosticSeverityWire,
    VersionDomainCapabilityState, VersionDomainClass, VersionOperationContextWire,
    VersionOperationKindWire, VersionRedactionPolicyWire,
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionMetadataDiagnosticWire {
    pub severity: VersionDiagnosticSeverityWire,
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain_id: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub data: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionRuntimeOperationActorSummaryWire {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor_kind: Option<VersionActorKindWire>,
    pub redacted_author_class: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionRuntimeOperationContextWire {
    pub runtime_context_id: String,
    pub operation_context: VersionOperationContextWire,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub entrypoint_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_kind: Option<String>,
    pub redaction_policy: VersionRedactionPolicyWire,
    pub actor: VersionRuntimeOperationActorSummaryWire,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<VersionMetadataDiagnosticWire>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpaqueDomainAttachmentWire {
    pub attachment_id: String,
    pub domain_id: String,
    pub media_type: String,
    pub digest: ObjectDigest,
    pub redaction_policy: VersionRedactionPolicyWire,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage_ref: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionMutationSegmentWire {
    pub segment_id: String,
    pub domain_id: String,
    pub domain_class: VersionDomainClass,
    pub capability_state: VersionDomainCapabilityState,
    pub operation_kind: VersionOperationKindWire,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub object_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before_digest: Option<ObjectDigest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after_digest: Option<ObjectDigest>,
    pub redaction_policy: VersionRedactionPolicyWire,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachment: Option<OpaqueDomainAttachmentWire>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::versioning::{CapturePolicyWire, VersionAuthorWire, VersionWriteAdmissionModeWire};

    const FORBIDDEN_PUBLIC_CONTRACT_FIELDS: &[&str] = &[
        "principal",
        "principalId",
        "principalIds",
        "principalRef",
        "principalScope",
        "principalTag",
        "principalTags",
        "principal_tags",
        "rawPayload",
        "raw_payload",
        "rawPayloadBytes",
        "raw_payload_bytes",
        "payload",
        "payloadBytes",
        "payload_bytes",
        "providerPayload",
        "provider_payload",
        "rawWorkbookBytes",
        "raw_workbook_bytes",
        "workbookBytes",
        "workbook_bytes",
        "credential",
        "credentials",
        "accessToken",
        "access_token",
        "secret",
        "secrets",
    ];

    fn digest() -> ObjectDigest {
        ObjectDigest {
            algorithm: crate::versioning::VersionObjectDigestAlgorithm::Sha256,
            value: "0".repeat(64),
            byte_length: None,
        }
    }

    fn operation_context() -> VersionOperationContextWire {
        VersionOperationContextWire {
            operation_id: "operation:vc02-public-wire".to_string(),
            kind: VersionOperationKindWire::Mutation,
            author: VersionAuthorWire {
                author_id: "author:sha256:vc02-public-wire".to_string(),
                actor_kind: VersionActorKindWire::Automation,
                display_name: Some("VC02 public wire fixture".to_string()),
                client_id: None,
                session_id: None,
            },
            created_at: "2026-06-22T00:00:00.000Z".to_string(),
            workbook_id: Some("workbook:vc02-public-wire".to_string()),
            sheet_ids: vec!["sheet:vc02-public-wire".to_string()],
            domain_ids: vec!["cells.values".to_string()],
            group_id: None,
            capture_policy: CapturePolicyWire::CommitEligible,
            write_admission_mode: VersionWriteAdmissionModeWire::Capture,
            client_request_id: Some("client-request:vc02-public-wire".to_string()),
            collaboration: None,
        }
    }

    fn count_forbidden_keys(value: &Value) -> usize {
        match value {
            Value::Array(items) => items.iter().map(count_forbidden_keys).sum(),
            Value::Object(object) => object
                .iter()
                .map(|(key, item)| {
                    usize::from(FORBIDDEN_PUBLIC_CONTRACT_FIELDS.contains(&key.as_str()))
                        + count_forbidden_keys(item)
                })
                .sum(),
            _ => 0,
        }
    }

    fn object_keys(value: &Value) -> Vec<String> {
        let object = value.as_object().expect("fixture serializes as object");
        let mut keys: Vec<_> = object.keys().cloned().collect();
        keys.sort();
        keys
    }

    #[test]
    fn runtime_operation_context_wire_serializes_public_safe_keys() {
        let fixture = VersionRuntimeOperationContextWire {
            runtime_context_id: "runtime-context:vc02-public-wire".to_string(),
            operation_context: operation_context(),
            entrypoint_ids: vec!["compute_batch_set_cells_by_position".to_string()],
            command: Some("compute_batch_set_cells_by_position".to_string()),
            runtime_kind: Some("node".to_string()),
            redaction_policy: VersionRedactionPolicyWire::MetadataOnly,
            actor: VersionRuntimeOperationActorSummaryWire {
                actor_kind: Some(VersionActorKindWire::Automation),
                redacted_author_class: "automation".to_string(),
            },
            diagnostics: vec![VersionMetadataDiagnosticWire {
                severity: VersionDiagnosticSeverityWire::Info,
                code: "VERSION_RUNTIME_CONTEXT_PUBLIC_WIRE".to_string(),
                message: "Public runtime context wire fixture.".to_string(),
                domain_id: Some("cells.values".to_string()),
                data: BTreeMap::new(),
            }],
        };
        let json = serde_json::to_value(fixture).expect("runtime context serializes");

        assert_eq!(
            object_keys(&json),
            vec![
                "actor",
                "command",
                "diagnostics",
                "entrypointIds",
                "operationContext",
                "redactionPolicy",
                "runtimeContextId",
                "runtimeKind",
            ]
        );
        assert_eq!(count_forbidden_keys(&json), 0);
    }

    #[test]
    fn mutation_segment_wire_serializes_public_safe_keys() {
        let fixture = VersionMutationSegmentWire {
            segment_id: "mutation-segment:vc02-public-wire".to_string(),
            domain_id: "cells.values".to_string(),
            domain_class: VersionDomainClass::Authored,
            capability_state: VersionDomainCapabilityState::Contracted,
            operation_kind: VersionOperationKindWire::Mutation,
            object_ids: vec!["cell:sheet-vc02-public-wire:A1".to_string()],
            before_digest: Some(digest()),
            after_digest: Some(digest()),
            redaction_policy: VersionRedactionPolicyWire::MetadataOnly,
            attachment: None,
        };
        let json = serde_json::to_value(fixture).expect("mutation segment serializes");

        assert_eq!(
            object_keys(&json),
            vec![
                "afterDigest",
                "beforeDigest",
                "capabilityState",
                "domainClass",
                "domainId",
                "objectIds",
                "operationKind",
                "redactionPolicy",
                "segmentId",
            ]
        );
        assert_eq!(count_forbidden_keys(&json), 0);
    }
}

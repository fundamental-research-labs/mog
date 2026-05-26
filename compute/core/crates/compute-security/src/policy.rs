use std::sync::Arc;

use cell_types::{ColId, SheetId};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::level::AccessLevel;
use crate::tag_match::TagMatcher;

/// Discriminated union persisted into the Yrs `security.policies` map.
///
/// The wire shape is pinned to the legacy TS types the pre-R6 kernel
/// serialized (`contracts/src/security/types.ts` in `59aa74b0`):
///
/// ```json
/// { "kind": "workbook" }
/// { "kind": "sheet",  "sheetId": "<uuid>" }
/// { "kind": "column", "sheetId": "<uuid>", "colId": "<uuid>" }
/// ```
///
/// Variant discriminants are lowercase (matching legacy's `'workbook' |
/// 'sheet' | 'column'`); inner field names are camelCase via explicit
/// `#[serde(rename = "...")]` so the outer `rename_all = "camelCase"` on
/// the enum doesn't double-convert already-idiomatic names.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AccessTarget {
    Workbook,
    Sheet {
        #[serde(rename = "sheetId")]
        sheet_id: SheetId,
    },
    Column {
        #[serde(rename = "sheetId")]
        sheet_id: SheetId,
        #[serde(rename = "colId")]
        col_id: ColId,
    },
}

/// Policy identifier. `transparent` serde so the wire format is a bare
/// UUID string, matching the legacy on-wire representation that
/// `SecurityStore` (R2.1) rewrites in place without migration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PolicyId(Uuid);

impl PolicyId {
    #[must_use]
    pub fn new_v4() -> Self {
        Self(Uuid::new_v4())
    }

    #[must_use]
    pub fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }

    #[must_use]
    pub fn as_uuid(&self) -> Uuid {
        self.0
    }
}

impl std::fmt::Display for PolicyId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

/// Provenance and authoring metadata attached to every policy. Stored in
/// Yrs alongside the policy itself (R2.1) and surfaced in explain output.
///
/// Wire shape matches legacy `AccessPolicyMetadata` (camelCase
/// `createdBy` / `createdAt` / `templateId`). The Rust `created_at_millis`
/// field is the same i64 the TS `createdAt: number` carried (epoch ms)
/// — we keep the `_millis` suffix in Rust for local readability and
/// rename on the wire to preserve byte-identity with legacy docs.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyMetadata {
    pub created_by: Arc<str>,
    #[serde(rename = "createdAt")]
    pub created_at_millis: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_id: Option<Arc<str>>,
}

/// Top-level policy record persisted in Yrs.
///
/// Wire shape matches legacy `AccessPolicy` (camelCase `principalTag`).
/// The outer `rename_all = "camelCase"` converts `principal_tag` →
/// `principalTag`; all other field names are already single-word and
/// unaffected.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessPolicy {
    pub id: PolicyId,
    pub principal_tag: TagMatcher,
    pub target: AccessTarget,
    pub level: AccessLevel,
    pub priority: i32,
    pub enabled: bool,
    pub metadata: PolicyMetadata,
}

/// Partial update shape for `wb_security_update_policy`. Every field is
/// `Option<_>`; fields left as `None` preserve the existing value on the
/// policy. The wire shape uses camelCase-style `skip_serializing_if` so
/// the SDK-facing JSON only carries the fields the caller actually meant
/// to change.
///
/// `id` is not patchable: once a policy is created the ID is the Yrs-map
/// key used for LWW and must not move. Callers that want to re-key
/// should `remove_policy` + `add_policy`.
///
/// Mutating `target` is supported even though the target carries a
/// discriminant — a patch swap from `Sheet` to `Column` is a single
/// replacement of the whole target, not a field-level merge.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessPolicyPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub principal_tag: Option<TagMatcher>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<AccessTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<AccessLevel>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
}

impl AccessPolicyPatch {
    /// Apply the patch to `policy` in place. Fields whose `Option` is
    /// `Some` overwrite; `None` leaves the field untouched.
    pub fn apply(&self, policy: &mut AccessPolicy) {
        if let Some(ref pt) = self.principal_tag {
            policy.principal_tag = pt.clone();
        }
        if let Some(ref t) = self.target {
            policy.target = t.clone();
        }
        if let Some(l) = self.level {
            policy.level = l;
        }
        if let Some(p) = self.priority {
            policy.priority = p;
        }
        if let Some(e) = self.enabled {
            policy.enabled = e;
        }
    }

    /// True when every field is `None` — a no-op patch. Callers that
    /// want to reject these before writing can check here.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.principal_tag.is_none()
            && self.target.is_none()
            && self.level.is_none()
            && self.priority.is_none()
            && self.enabled.is_none()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_target_serde_round_trip() {
        let sheet_id = SheetId::from_raw(0x1111_1111_1111_1111_1111_1111_1111_1111);
        let col_id = ColId::from_raw(0x2222_2222_2222_2222_2222_2222_2222_2222);

        let cases = [
            AccessTarget::Workbook,
            AccessTarget::Sheet { sheet_id },
            AccessTarget::Column { sheet_id, col_id },
        ];

        for target in cases {
            let json = serde_json::to_string(&target).expect("serialize");
            let decoded: AccessTarget = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(target, decoded, "round-trip mismatch for {target:?}");
        }
    }

    #[test]
    fn access_policy_serde_round_trip() {
        let policy = AccessPolicy {
            id: PolicyId::new_v4(),
            principal_tag: TagMatcher::parse("agent:*"),
            target: AccessTarget::Workbook,
            level: AccessLevel::Read,
            priority: 7,
            enabled: true,
            metadata: PolicyMetadata {
                created_by: Arc::from("test"),
                created_at_millis: 123_456_789,
                template_id: None,
            },
        };
        let json = serde_json::to_string(&policy).expect("serialize");
        let decoded: AccessPolicy = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(policy, decoded);
    }

    /// Pins the camelCase wire keys on each struct so a future rename
    /// doesn't silently break legacy doc compatibility. The field names
    /// here match the legacy TS types exactly (see `contracts/src/
    /// security/types.ts` in commit `59aa74b0`).
    #[test]
    fn access_policy_wire_keys_are_camel_case() {
        let sheet_id = SheetId::from_uuid_str("11111111-1111-1111-1111-111111111111").unwrap();
        let col_id = ColId::from_uuid_str("22222222-2222-2222-2222-222222222222").unwrap();

        let policy = AccessPolicy {
            id: PolicyId::from_uuid(
                uuid::Uuid::parse_str("33333333-3333-3333-3333-333333333333").unwrap(),
            ),
            principal_tag: TagMatcher::parse("agent:*"),
            target: AccessTarget::Column { sheet_id, col_id },
            level: AccessLevel::Read,
            priority: 7,
            enabled: true,
            metadata: PolicyMetadata {
                created_by: Arc::from("alice"),
                created_at_millis: 1_700_000_000_000,
                template_id: Some(Arc::from("protect-workbook")),
            },
        };
        let value: serde_json::Value = serde_json::to_value(&policy).expect("to_value");
        let obj = value.as_object().expect("policy serializes as object");
        // Outer struct keys — legacy TS `AccessPolicy`.
        for key in [
            "id",
            "principalTag",
            "target",
            "level",
            "priority",
            "enabled",
            "metadata",
        ] {
            assert!(obj.contains_key(key), "missing policy key `{key}` on wire");
        }
        // Snake-case must NOT leak through.
        assert!(!obj.contains_key("principal_tag"));

        // Target — legacy tagged union with `kind` + camelCase ids.
        let target_obj = obj["target"].as_object().unwrap();
        assert_eq!(target_obj["kind"], "column");
        assert!(target_obj.contains_key("sheetId"));
        assert!(target_obj.contains_key("colId"));
        assert!(!target_obj.contains_key("sheet_id"));
        assert!(!target_obj.contains_key("col_id"));

        // Metadata — legacy TS `AccessPolicyMetadata`.
        let meta_obj = obj["metadata"].as_object().unwrap();
        for key in ["createdBy", "createdAt", "templateId"] {
            assert!(
                meta_obj.contains_key(key),
                "missing metadata key `{key}` on wire"
            );
        }
        assert!(!meta_obj.contains_key("created_by"));
        assert!(!meta_obj.contains_key("created_at_millis"));
        assert!(!meta_obj.contains_key("template_id"));
    }
}

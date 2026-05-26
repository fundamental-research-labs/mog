//! Policy templates — named bundles of policies that users apply via
//! `wb.security.applyTemplate(...)`. Each variant emits a fixed list of
//! `AccessPolicy` values in the template priority band [100, 199].
//!
//! Priority-band invariant: every policy emitted by a template falls in
//! `PRIORITY_TEMPLATE_MIN..=PRIORITY_TEMPLATE_MAX`. App policies (added
//! via direct `add_policy` calls) live below; system-authored policies
//! live above.

use std::sync::Arc;

use cell_types::SheetId;
use serde::{Deserialize, Serialize};

use crate::level::AccessLevel;
use crate::policy::{AccessPolicy, AccessTarget, PolicyId, PolicyMetadata};
use crate::principal::NON_OWNER_TAG;
use crate::tag_match::TagMatcher;

/// App-layer policies (direct `wb.security.add_policy` calls).
pub const PRIORITY_APP_MIN: i32 = 0;
pub const PRIORITY_APP_MAX: i32 = 99;
/// Template-emitted policies.
pub const PRIORITY_TEMPLATE_MIN: i32 = 100;
pub const PRIORITY_TEMPLATE_MAX: i32 = 199;
/// System/owner-authored policies (e.g. admin hard-locks).
pub const PRIORITY_SYSTEM_MIN: i32 = 200;

/// Creator tag stamped into `PolicyMetadata::created_by` for every
/// template-emitted policy.
const TEMPLATE_CREATOR: &str = "mog:system";

/// Caller-owned context for materializing policy templates.
///
/// Template expansion creates persisted policy IDs and provenance timestamps,
/// so hosted callers must provide both facts instead of letting this lower
/// layer read a platform clock or entropy source.
pub struct PolicyTemplateContext<F>
where
    F: FnMut() -> PolicyId,
{
    pub created_at_millis: i64,
    pub id_allocator: F,
}

/// Named template bundles. Parameters live in the variant because the
/// `generate()` output depends on them (e.g. which sheet to protect).
///
/// Serde shape is tagged-enum with `kind` discriminator so SDKs send
/// `{ "kind": "protect_workbook" }` / `{ "kind": "protect_sheet",
/// "sheet_id": "..." }` — matches how B.2's tagged-enum codegen
/// consumes payloads across NAPI and PyO3.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Template {
    /// Lock one sheet to read-only for any non-owner principal.
    ProtectSheet { sheet_id: SheetId },
    /// Lock the whole workbook to read-only for any non-owner principal.
    ProtectWorkbook,
    /// Agents get structure-only access at the workbook level; owners and
    /// explicit principals are unaffected. `tag_pattern` defaults to
    /// `agent:*` when `None`.
    AgentStructure { tag_pattern: Option<Arc<str>> },
}

impl Template {
    #[must_use]
    pub fn id(&self) -> &'static str {
        match self {
            Self::ProtectSheet { .. } => "protect-sheet",
            Self::ProtectWorkbook => "protect-workbook",
            Self::AgentStructure { .. } => "agent-structure",
        }
    }

    /// Generate the fixed policy list. Fresh UUIDs on every call —
    /// callers typically hand the result to `SecurityStore::add_policy`
    /// which re-uses the IDs as Yrs map keys.
    #[must_use]
    pub fn generate(&self) -> Vec<AccessPolicy> {
        self.generate_with_context(PolicyTemplateContext {
            created_at_millis: standalone_current_millis(),
            id_allocator: PolicyId::new_v4,
        })
    }

    /// Generate the fixed policy list using caller-owned timestamps and IDs.
    #[must_use]
    pub fn generate_with_context<F>(&self, mut ctx: PolicyTemplateContext<F>) -> Vec<AccessPolicy>
    where
        F: FnMut() -> PolicyId,
    {
        let now_millis = ctx.created_at_millis;
        let metadata = |template_id: &'static str| PolicyMetadata {
            created_by: Arc::from(TEMPLATE_CREATOR),
            created_at_millis: now_millis,
            template_id: Some(Arc::from(template_id)),
        };

        match self {
            Self::ProtectSheet { sheet_id } => vec![AccessPolicy {
                id: (ctx.id_allocator)(),
                principal_tag: TagMatcher::parse(NON_OWNER_TAG),
                target: AccessTarget::Sheet {
                    sheet_id: *sheet_id,
                },
                level: AccessLevel::Read,
                priority: PRIORITY_TEMPLATE_MIN,
                enabled: true,
                metadata: metadata("protect-sheet"),
            }],
            Self::ProtectWorkbook => vec![AccessPolicy {
                id: (ctx.id_allocator)(),
                principal_tag: TagMatcher::parse(NON_OWNER_TAG),
                target: AccessTarget::Workbook,
                level: AccessLevel::Read,
                priority: PRIORITY_TEMPLATE_MIN,
                enabled: true,
                metadata: metadata("protect-workbook"),
            }],
            Self::AgentStructure { tag_pattern } => {
                let pattern = tag_pattern.as_deref().unwrap_or("agent:*");
                vec![AccessPolicy {
                    id: (ctx.id_allocator)(),
                    principal_tag: TagMatcher::parse(pattern),
                    target: AccessTarget::Workbook,
                    level: AccessLevel::Structure,
                    priority: PRIORITY_TEMPLATE_MIN,
                    enabled: true,
                    metadata: metadata("agent-structure"),
                }]
            }
        }
    }
}

/// Native standalone helper for direct Rust library use.
///
/// Hosted browser/server paths should call `generate_with_context` so policy
/// provenance is supplied by the security API caller / host boundary.
fn standalone_current_millis() -> i64 {
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or(0)
    }
    #[cfg(target_arch = "wasm32")]
    {
        0
    }
}

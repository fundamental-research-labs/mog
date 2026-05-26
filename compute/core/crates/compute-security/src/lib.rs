//! Pure policy types and access-control engine.
//!
//! This crate holds the caller-identity, policy, and level types, the
//! tag-pattern matcher, the resolution engine, the sheet access matrix,
//! and the built-in template bundles. It has no knowledge of Yrs or
//! `compute-core`; the matrix cache and `SecurityState` wiring land in
//! later phases (R2+).

pub mod engine;
pub mod error;
pub mod events;
pub mod filters;
pub mod level;
pub mod matrix;
pub mod policy;
pub mod principal;
pub mod tag_match;
pub mod templates;

pub use engine::{AccessExplanation, EvalResult, ExplainReason, PolicyEngine};
pub use error::SecurityError;
pub use events::{AmbiguityWarning, SecurityEvent};
pub use filters::{RedactMaybe, filter_range_values, redact_scalar};
pub use level::AccessLevel;
pub use matrix::{ColumnIndex, SheetAccessMatrix};
pub use policy::{AccessPolicy, AccessPolicyPatch, AccessTarget, PolicyId, PolicyMetadata};
pub use principal::{
    EffectiveTags, NON_OWNER_TAG, OWNER_TAG, Principal, PrincipalIdentity, PrincipalPool,
    PrincipalTag, SortedTagList,
};
pub use tag_match::{TagMatcher, TagSpecificity};
pub use templates::{
    PRIORITY_APP_MAX, PRIORITY_APP_MIN, PRIORITY_SYSTEM_MIN, PRIORITY_TEMPLATE_MAX,
    PRIORITY_TEMPLATE_MIN, Template,
};

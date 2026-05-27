//! Rust-native end-to-end security scenarios.
//!
//! Each test drives `ComputeService` (the bridged delegate surface — same
//! code path every SDK binding calls) to verify that the gated-delegate
//! plumbing composes correctly with the engine's policy store, matrix
//! cache, and filter hooks.
//!
//! Scenario families live in sibling modules so the audit trail stays
//! discoverable without concentrating every security contract in one file.

#[path = "security_e2e/fixtures.rs"]
mod fixtures;

#[path = "security_e2e/adversarial_bypass_runtime.rs"]
mod adversarial_bypass_runtime;
#[path = "security_e2e/adversarial_core.rs"]
mod adversarial_core;
#[path = "security_e2e/adversarial_disposition.rs"]
mod adversarial_disposition;
#[path = "security_e2e/bootstrap.rs"]
mod bootstrap;
#[path = "security_e2e/composition.rs"]
mod composition;
#[path = "security_e2e/enforcement.rs"]
mod enforcement;
#[path = "security_e2e/events_access_denied.rs"]
mod events_access_denied;
#[path = "security_e2e/events_ambiguity.rs"]
mod events_ambiguity;
#[path = "security_e2e/principal_identity.rs"]
mod principal_identity;

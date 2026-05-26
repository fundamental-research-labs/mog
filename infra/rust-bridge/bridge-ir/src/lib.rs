//! Target-neutral descriptor IR consumed by downstream bridge target crates
//! (bridge-napi-macros, bridge-cli-macros, ...).
//!
//! Upstream, `bridge-core`'s `#[bridge::api]` proc macro emits a
//! `__bridge_descriptor_*!` declarative macro containing the target-neutral
//! shape for one `impl` block. Downstream target crates are themselves proc
//! macros (`#[proc_macro] __expand`) that receive those tokens and emit
//! per-target bindings. Every one of them needs to parse the same DSL into
//! the same IR. That parsing + IR lives here.
//!
//! This crate is intentionally NOT a proc-macro crate: its types are named
//! in public APIs of downstream proc-macro crates (via
//! `bridge_ir::ApiDescriptor`), so it must compile as a regular library that
//! a proc-macro crate can depend on.

pub mod classify;
pub mod ir;
pub mod param_struct;
pub mod parse;

pub use ir::{
    AccessLevel, ApiDescriptor, LifecycleKind, MethodDescriptor, Param, ParamTag, ServiceMeta,
    TaggedEnumSchema, VariantField, VariantSchema,
};
pub use param_struct::{ParamStructDescriptor, ParamStructField};

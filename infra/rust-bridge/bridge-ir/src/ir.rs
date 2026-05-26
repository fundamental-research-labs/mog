//! Target-neutral descriptor IR types.
//!
//! These mirror `bridge-core`'s upstream descriptor shape (see
//! `bridge-core/src/descriptor.rs`), but live here so that downstream target
//! crates (bridge-napi-macros, bridge-cli-macros) — which consume the
//! `__bridge_descriptor_*!` declarative-macro DSL, not the Rust impl block —
//! can share a single IR instead of each maintaining their own parallel
//! copy. bridge-core itself continues to build its own IR from the
//! upstream Rust source and stays target-neutral there.
//!
//! Target-specific classification (e.g. bridge-napi's `ReturnInfo` with
//! `is_bytes_tuple` / `is_self_tuple`, or bridge-cli's `CliView`
//! projection) is layered on as a per-target extension trait over these
//! types rather than living inside the IR itself.

use std::collections::BTreeMap;

use syn::{Ident, Type};

/// The full parsed API for one `#[bridge::api]` impl block, as delivered by
/// the declarative-macro DSL.
#[derive(Debug)]
pub struct ApiDescriptor {
    /// The Rust type the impl block is attached to. For stateless APIs the
    /// DSL emits `type_name = <ident>;`; for stateful APIs the same value
    /// comes in on `service = <ident>;`.
    pub type_name: Ident,
    /// `Some(..)` when the impl block is `#[bridge::api(service = "...", key = "...")]`,
    /// `None` for pure stateless APIs.
    pub service: Option<ServiceMeta>,
    /// Group name from `#[bridge::api(group = "...")]`, consumed by bridge-tauri
    /// for module scoping and by bridge-delegate for descriptor naming.
    pub group_name: Option<String>,
    /// Optional function-name prefix override. When `Some(p)` with non-empty
    /// `p`, generated function names use `{p}_{method_name}`; `Some("")`
    /// disables prefixing entirely; `None` means "fall back to
    /// `to_snake_case(type_name)`".
    pub fn_prefix: Option<String>,
    /// Optional `crate::` → `<path>` rewrite hint preserved from upstream;
    /// currently informational at this layer (rewrites happen in bridge-core).
    pub crate_path: Option<String>,
    pub methods: Vec<MethodDescriptor>,
    /// Target-neutral metadata bag. `bridge-core`'s attribute parser drops any
    /// unrecognized `key = "value"` pair here verbatim; downstream targets
    /// layer an extension trait over this IR to read the keys they care
    /// about (e.g. `bridge-cli` reads `cli_group`; `bridge-napi` ignores
    /// every key). `BTreeMap` rather than `HashMap` so the emitted DSL is
    /// deterministic across compilations.
    pub extras: BTreeMap<String, String>,
}

#[derive(Debug)]
pub struct ServiceMeta {
    pub name: Ident,
    pub key_type: String,
    pub key_param: String,
}

/// How a method accesses state.
///
/// The variants line up with `bridge-core::AccessLevel`. Downstream targets
/// may collapse equivalent variants at codegen time (e.g. bridge-napi treats
/// `Structural` like `Write` and `Session` like `Read` at the FFI shape
/// level) — that collapse is a per-target concern and does not affect the
/// shared IR.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AccessLevel {
    Pure,
    Read,
    Write,
    Structural,
    Session,
    Lifecycle(LifecycleKind),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LifecycleKind {
    Create,
    CreateFrom { name: String },
}

#[derive(Debug)]
pub struct MethodDescriptor {
    pub name: Ident,
    pub access: AccessLevel,
    pub is_async: bool,
    pub params: Vec<Param>,
    pub return_type: Option<Type>,
    pub error_type: Option<Type>,
    pub is_fallible: bool,
    pub skip_targets: Vec<String>,
    /// Security scope declared on `#[bridge::read/write/structural(scope = "...")]`.
    /// Validated and consumed by bridge-delegate under `gated = true`.
    /// Downstream targets typically do not see this (bridge-delegate strips
    /// it when re-emitting), but the DSL preserves it so the IR is lossless.
    pub scope: Option<String>,
    /// Set by `#[bridge::write(needs_principal)]`. Marks methods whose
    /// engine-side signature takes a trailing `caller: &Principal` that the
    /// delegate macro supplies — downstream codegens see the public (stripped)
    /// signature.
    pub needs_principal: bool,
}

#[derive(Debug, Clone)]
pub struct Param {
    pub name: Ident,
    pub ty: Type,
    pub tag: ParamTag,
}

/// Classification of a parameter's wire type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParamTag {
    Str,
    Prim,
    Bytes,
    Serde,
    Parse,
    TaggedEnum(TaggedEnumSchema),
}

/// Schema for a serde-tagged enum used as a param. Field/type information is
/// stringified (matching `bridge-core`'s upstream representation) so the IR
/// stays plain-data and the DSL round-trips losslessly.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaggedEnumSchema {
    pub type_name: String,
    pub tag: String,
    pub content: Option<String>,
    pub variants: Vec<VariantSchema>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VariantSchema {
    pub rust_name: String,
    pub wire_name: String,
    pub fields: Vec<VariantField>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VariantField {
    pub rust_name: String,
    pub wire_name: String,
    /// Inner field classification — mirrors the outer `ParamTag` taxonomy.
    /// Nested `TaggedEnum` fields are represented as `Serde` here (matching
    /// bridge-core's emit-side fallback), so this is `Box<ParamTag>` for
    /// API symmetry with the upstream descriptor.
    pub tag: Box<ParamTag>,
}

//! Internal representation of a parsed bridge API.

use std::collections::BTreeMap;

/// Metadata from `#[bridge::api(service = "Foo", key = "bar")]`.
#[derive(Debug)]
pub(crate) struct ServiceMeta {
    pub name: syn::Ident,
    #[allow(dead_code)] // Parsed from attribute but not yet consumed by codegen
    pub module_path: Option<String>,
    pub key_type: String,
    pub key_param: String,
}

/// How a method accesses state.
///
/// `Structural` is a sibling of `Write` added for Phase B (privacy). It is
/// a marker only at this IR level — B.1 interprets it downstream as "require
/// `AccessLevel::Admin` instead of `AccessLevel::Write` at the gate". The parser
/// accepts optional passthrough args on `#[bridge::structural(...)]` (e.g.
/// `scope = "..."`) without validating them; B.1 adds the validation layer.
///
/// `Session` is a sibling of `Read` for privacy-sensitive session state.
/// Semantically it covers methods that **mutate session-scoped state via
/// interior mutability** (e.g. `ArcSwap`) and therefore take `&self` rather
/// than `&mut self`. Downstream codegens (napi/pyo3/tauri/wasm) emit a
/// `&self` wrapper identical to `Read` — the two differ only in intent, not
/// FFI shape. This kind exists so `set_active_principal` (R2.4) does not
/// get promoted to `&mut self` by the napi codegen, which would defeat the
/// `ArcSwap` design ("SDKs expect to reset the principal at any point in a
/// session without coordinating with in-flight calls"; see
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AccessLevel {
    Pure,
    Read,
    Write,
    Structural,
    Session,
    Lifecycle(LifecycleKind),
}

/// The kind of lifecycle operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LifecycleKind {
    Create,
    CreateFrom { name: String },
}

/// Classification of a parameter's wire type.
///
/// `TaggedEnum` carries a full schema for serde-tagged enums (e.g.
/// `#[serde(tag = "kind", rename_all = "snake_case")] enum AccessTarget { .. }`).
/// This is a Phase B.2 extension: NAPI/PyO3 codegens consume the schema to emit
/// discriminated-union wire encoding. The IR shape here is what B.2 destructures.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ParamTag {
    Str,
    Prim,
    Bytes,
    Serde,
    Parse,
    TaggedEnum(TaggedEnumSchema),
}

/// Schema for a serde-tagged enum used as a bridge param or return type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TaggedEnumSchema {
    /// Name of the Rust enum type (e.g. `"AccessTarget"`).
    pub type_name: String,
    /// The serde tag discriminator (from `#[serde(tag = "kind")]`).
    pub tag: String,
    /// Optional content key (from `#[serde(tag = "t", content = "c")]`). When
    /// absent, serde uses the internal-tag representation; when present, adjacent.
    pub content: Option<String>,
    pub variants: Vec<VariantSchema>,
}

/// One variant inside a `TaggedEnumSchema`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct VariantSchema {
    /// Variant name as declared in Rust (e.g. `"Sheet"`). Serde rename rules are
    /// recorded in `wire_name` separately so codegens can pick the right one.
    pub rust_name: String,
    /// Wire name after applying `#[serde(rename = "...")]` and container
    /// `rename_all`. Falls back to `rust_name` when no rules apply.
    pub wire_name: String,
    pub fields: Vec<VariantField>,
}

/// A single field inside a struct-form variant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct VariantField {
    /// Rust field identifier.
    pub rust_name: String,
    /// Wire-side field name after applying serde renames.
    pub wire_name: String,
    /// The Rust type token (stringified so the IR stays plain-data).
    pub ty: String,
    /// Downstream classification of the field type — mirrors the outer
    /// `ParamTag` taxonomy so codegens can dispatch per-field.
    pub tag: Box<ParamTag>,
}

/// A single method parameter (excluding `self`).
#[derive(Debug)]
pub(crate) struct Param {
    pub name: syn::Ident,
    pub ty: syn::Type,
    pub tag: ParamTag,
}

/// A fully-parsed bridge method.
#[derive(Debug)]
pub(crate) struct MethodDescriptor {
    pub access: AccessLevel,
    pub name: syn::Ident,
    pub params: Vec<Param>,
    pub return_type: Option<syn::Type>,
    pub error_type: Option<syn::Type>,
    pub is_fallible: bool,
    pub is_async: bool,
    pub skip_targets: Vec<String>,
    /// Security scope declared on `#[bridge::read/write/structural(scope = "...")]`.
    /// Unvalidated at this layer — bridge-delegate validates under `gated = true`
    /// (Phase B.1). Stored as the raw literal so it round-trips through the
    /// descriptor DSL into the delegate macro without loss.
    pub scope: Option<String>,
    /// Set by `#[bridge::write(needs_principal)]`. Engine-side signature has a
    /// trailing `caller: &Principal` that the delegate macro supplies. Stripped
    /// from re-emitted descriptors (downstream codegens never see it).
    pub needs_principal: bool,
}

/// The full parsed API for one `#[bridge::api]` impl block.
#[derive(Debug)]
pub(crate) struct ApiDescriptor {
    pub service: Option<ServiceMeta>,
    pub methods: Vec<MethodDescriptor>,
    pub type_name: syn::Ident,
    pub group_name: Option<String>,
    /// Optional function name prefix override. When set, generated function names
    /// use `{fn_prefix}_{method_name}` instead of `{to_snake_case(type_name)}_{method_name}`.
    /// An empty string means no prefix (just method name).
    pub fn_prefix: Option<String>,
    /// When set, `crate::` paths in type tokens are rewritten to this path.
    /// Makes descriptors self-contained — types resolve in any downstream crate.
    pub crate_path: Option<String>,
    /// Target-neutral metadata bag. Any unrecognized `key = "value"` pair on
    /// `#[bridge::api(...)]` flows here verbatim. Downstream targets layer an
    /// extension trait over this IR to read the keys they care about
    /// (`bridge-cli` reads `cli_group`; other targets ignore it). The map keeps
    /// `bridge-core` target-neutral — adding a new target never requires
    /// modifying `bridge-core` to teach the parser a new key.
    ///
    /// `BTreeMap` (not `HashMap`) so the emitted descriptor DSL is
    /// deterministic across compilations — downstream macro hashing and
    /// golden-file diffs rely on stable ordering.
    pub extras: BTreeMap<String, String>,
}

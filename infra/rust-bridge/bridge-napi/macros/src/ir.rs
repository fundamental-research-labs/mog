//! napi-local IR adapter + napi-specific classification extension.
//!
//! Historical note: before PR2 pass 1 this file owned a napi-local
//! `NapiDescriptor`/`NapiMethod`/... IR that duplicated the target-neutral
//! descriptor shape. The target-neutral parts now live in `bridge_ir`
//! (see that crate's `ir.rs`); this file keeps only:
//!
//! 1. **Re-exports of `bridge_ir` types** under their canonical names so
//!    forward-looking code can consume `ir::ApiDescriptor` directly
//!    (and pass 2 of the bridge-cli round can layer its own extension
//!    trait on the same types).
//!
//! 2. **napi-local adapter types** (`NapiDescriptor`, `NapiMethod`,
//!    `NapiParam`, `NapiServiceMeta`, `NapiAccess`, `NapiParamTag`,
//!    `NapiTaggedEnumSpec`, `NapiVariantSpec`, `NapiVariantField`,
//!    `NapiFieldTag`) with their historical `String`-based shape. These
//!    are built from the `bridge_ir` IR via the `From` impls below so
//!    existing codegen in `expand_fn.rs` / `expand_class.rs` — which
//!    operates on stringified type/name info heavily (e.g.
//!    `param.ty.starts_with('&')`) — keeps working unchanged. A future
//!    round can migrate those call sites onto the bridge-ir types
//!    directly and delete this adapter.
//!
//! 3. **napi-specific classification**: [`ReturnInfo`] (with
//!    `is_bytes_tuple` / `is_self_tuple` flags that only napi cares
//!    about) and the [`NapiMethodExt`] extension trait that computes a
//!    `ReturnInfo` from a `bridge_ir::MethodDescriptor`. Targets other
//!    than napi never look at this.

use quote::ToTokens;

// Re-exports of the target-neutral shared IR.
#[allow(unused_imports)]
pub(crate) use bridge_ir::{
    AccessLevel, ApiDescriptor, LifecycleKind, MethodDescriptor, Param, ParamTag, ServiceMeta,
    TaggedEnumSchema, VariantField, VariantSchema,
};

// ---------------------------------------------------------------------------
// napi-local adapter types (historical shape, String-based)
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub(crate) struct NapiDescriptor {
    pub type_name: String,
    pub fn_prefix: Option<String>,
    pub service: Option<NapiServiceMeta>,
    pub methods: Vec<NapiMethod>,
}

#[derive(Debug)]
pub(crate) struct NapiServiceMeta {
    pub key_param: String,
}

#[derive(Debug)]
pub(crate) struct NapiMethod {
    pub access: NapiAccess,
    pub name: String,
    pub params: Vec<NapiParam>,
    pub return_type: Option<ReturnInfo>,
    #[allow(dead_code)]
    pub error_type: Option<String>,
    pub is_fallible: bool,
    pub is_async: bool,
    pub skip_targets: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum NapiAccess {
    Pure,
    Read,
    Write,
    LifecycleCreate,
    LifecycleCreateFrom { variant_name: String },
}

#[derive(Debug, Clone)]
pub(crate) struct NapiParam {
    pub name: String,
    pub ty: String,
    pub tag: NapiParamTag,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum NapiParamTag {
    Str,
    Prim,
    Bytes,
    Serde,
    Parse,
    /// Serde-tagged enum (from `#[bridge::tagged_enum(...)]`). The wire form on
    /// the napi boundary is still a JSON string (like `Serde`), but the schema
    /// lets the generated code emit explicit discriminator-based decode/validation
    /// and drives future TS type generation of the union shape.
    TaggedEnum(NapiTaggedEnumSpec),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NapiTaggedEnumSpec {
    pub type_name: String,
    pub tag: String,
    pub content: Option<String>,
    pub variants: Vec<NapiVariantSpec>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NapiVariantSpec {
    pub rust_name: String,
    pub wire_name: String,
    pub fields: Vec<NapiVariantField>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NapiVariantField {
    pub rust_name: String,
    pub wire_name: String,
    /// Inner field classification — mirrors the outer `NapiParamTag` taxonomy.
    /// `TaggedEnum` is intentionally excluded (nested tagged enums fall back
    /// to `Serde` in bridge-core's emit path).
    pub field_tag: NapiFieldTag,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NapiFieldTag {
    Str,
    Prim,
    Bytes,
    Serde,
    Parse,
}

// ---------------------------------------------------------------------------
// napi-specific classification
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub(crate) struct ReturnInfo {
    pub ty: String,
    pub is_string: bool,
    pub is_prim: bool,
    pub is_bytes: bool,
    pub is_unit: bool,
    /// True when the return type is a tuple `(Vec<u8>, T)` — bytes pass through
    /// as Buffer (no serde), T gets serde-serialized to JSON string.
    pub is_bytes_tuple: bool,
    /// When `is_bytes_tuple` is true, this holds the serde-serialized inner type.
    #[allow(dead_code)]
    pub serde_inner_ty: Option<String>,
    /// True when the return type is a tuple `(Self, T)` — used for lifecycle
    /// create methods that return auxiliary data alongside the new instance.
    pub is_self_tuple: bool,
    /// When `is_self_tuple` is true, this holds the second element type string.
    #[allow(dead_code)]
    pub self_tuple_inner_ty: Option<String>,
}

/// Per-target extension over `bridge_ir::MethodDescriptor` that materializes
/// napi-specific return classification on demand. Kept as a trait (rather
/// than stored on the IR) so the IR stays target-neutral and other targets
/// never pay for napi-only analysis.
pub(crate) trait NapiMethodExt {
    /// Classify the method's return type per napi semantics. Returns `None`
    /// for unit returns so downstream code can `.map` over the presence of
    /// a "real" return, matching the legacy behavior.
    fn return_info(&self) -> Option<ReturnInfo>;

    /// True iff the method returns `(Vec<u8>, T)` — the bytes-tuple shape.
    #[allow(dead_code)]
    fn is_bytes_tuple(&self) -> bool {
        self.return_info()
            .map(|r| r.is_bytes_tuple)
            .unwrap_or(false)
    }

    /// True iff the method returns `(Self, T)` — a lifecycle-create shape
    /// that stashes the auxiliary T alongside the new Self instance.
    #[allow(dead_code)]
    fn is_self_tuple(&self) -> bool {
        self.return_info().map(|r| r.is_self_tuple).unwrap_or(false)
    }
}

impl NapiMethodExt for MethodDescriptor {
    fn return_info(&self) -> Option<ReturnInfo> {
        self.return_type.as_ref().map(|ty| {
            let ty_str = ty.to_token_stream().to_string();
            crate::classify::classify_return(&ty_str)
        })
    }
}

// ---------------------------------------------------------------------------
// bridge_ir → napi adapter conversions
// ---------------------------------------------------------------------------

impl From<ApiDescriptor> for NapiDescriptor {
    fn from(desc: ApiDescriptor) -> Self {
        NapiDescriptor {
            type_name: desc.type_name.to_string(),
            fn_prefix: desc.fn_prefix,
            service: desc.service.map(|s| NapiServiceMeta {
                key_param: s.key_param,
            }),
            methods: desc.methods.into_iter().map(NapiMethod::from).collect(),
        }
    }
}

impl From<MethodDescriptor> for NapiMethod {
    fn from(m: MethodDescriptor) -> Self {
        // Compute napi classification up front while `m` is still whole — the
        // trait impl borrows `return_type`, and any subsequent partial move
        // would break that borrow. Destructure only after.
        let return_type = m.return_info();

        let MethodDescriptor {
            name,
            access,
            is_async,
            params,
            return_type: _,
            error_type,
            is_fallible,
            skip_targets,
            scope: _,
            needs_principal: _,
        } = m;

        let napi_access = match access {
            AccessLevel::Pure => NapiAccess::Pure,
            AccessLevel::Read => NapiAccess::Read,
            AccessLevel::Write => NapiAccess::Write,
            // At the napi FFI layer, structural is indistinguishable from write
            // (same `&mut self`, same serde wire). Collapse at the adapter
            // boundary so downstream codegen does not need to know about it.
            AccessLevel::Structural => NapiAccess::Write,
            // R2.4: session is interior-mutable `&self`; FFI shape is identical
            // to read. Collapse so codegen emits `&self`, avoiding the
            // `&mut self` promotion that write would impose.
            AccessLevel::Session => NapiAccess::Read,
            AccessLevel::Lifecycle(LifecycleKind::Create) => NapiAccess::LifecycleCreate,
            AccessLevel::Lifecycle(LifecycleKind::CreateFrom { name }) => {
                NapiAccess::LifecycleCreateFrom { variant_name: name }
            }
        };

        let error_type = error_type.as_ref().map(|t| t.to_token_stream().to_string());

        NapiMethod {
            access: napi_access,
            name: name.to_string(),
            params: params.into_iter().map(NapiParam::from).collect(),
            return_type,
            error_type,
            is_fallible,
            is_async,
            skip_targets,
        }
    }
}

impl From<Param> for NapiParam {
    fn from(p: Param) -> Self {
        let ty = type_to_napi_string(&p.ty);
        NapiParam {
            name: p.name.to_string(),
            ty,
            tag: NapiParamTag::from(p.tag),
        }
    }
}

impl From<ParamTag> for NapiParamTag {
    fn from(t: ParamTag) -> Self {
        match t {
            ParamTag::Str => NapiParamTag::Str,
            ParamTag::Prim => NapiParamTag::Prim,
            ParamTag::Bytes => NapiParamTag::Bytes,
            ParamTag::Serde => NapiParamTag::Serde,
            ParamTag::Parse => NapiParamTag::Parse,
            ParamTag::TaggedEnum(s) => NapiParamTag::TaggedEnum(NapiTaggedEnumSpec::from(s)),
        }
    }
}

impl From<TaggedEnumSchema> for NapiTaggedEnumSpec {
    fn from(s: TaggedEnumSchema) -> Self {
        NapiTaggedEnumSpec {
            type_name: s.type_name,
            tag: s.tag,
            content: s.content,
            variants: s.variants.into_iter().map(NapiVariantSpec::from).collect(),
        }
    }
}

impl From<VariantSchema> for NapiVariantSpec {
    fn from(v: VariantSchema) -> Self {
        NapiVariantSpec {
            rust_name: v.rust_name,
            wire_name: v.wire_name,
            fields: v.fields.into_iter().map(NapiVariantField::from).collect(),
        }
    }
}

impl From<VariantField> for NapiVariantField {
    fn from(f: VariantField) -> Self {
        let field_tag = match *f.tag {
            ParamTag::Str => NapiFieldTag::Str,
            ParamTag::Prim => NapiFieldTag::Prim,
            ParamTag::Bytes => NapiFieldTag::Bytes,
            ParamTag::Serde => NapiFieldTag::Serde,
            ParamTag::Parse => NapiFieldTag::Parse,
            // Nested tagged enums fall back to Serde at this layer
            // (bridge-core does the same in emit.rs).
            ParamTag::TaggedEnum(_) => NapiFieldTag::Serde,
        };
        NapiVariantField {
            rust_name: f.rust_name,
            wire_name: f.wire_name,
            field_tag,
        }
    }
}

/// Render a `syn::Type` into the normalized string form the napi codegen
/// expects. Historically the parser built these strings by walking the
/// token stream and joining with tight spacing around `&`, `<>`, and `::`;
/// we reproduce that shape here so downstream predicates like
/// `param.ty.starts_with('&')`, `param.ty.trim_start_matches('&')`, and
/// `Option<&str>` detection continue to match the same way.
fn type_to_napi_string(ty: &syn::Type) -> String {
    // `ToTokens::to_token_stream().to_string()` already uses the canonical
    // rustc tokenizer spacing (`&` and `::` adjacent, space around `,`, no
    // space inside `<>`), which matches what the legacy hand-rolled
    // `join_type_tokens` produced for every input we've observed in the
    // regression corpus. Keep as a single helper so the contract is explicit.
    let mut s = ty.to_token_stream().to_string();
    // Collapse the `& mut ident` → `&mut ident` spacing — `ToTokens` emits
    // a space after `&`, but downstream predicates check for `&` prefix
    // without a space.
    // Note: we do NOT collapse `& ` → `&` unconditionally because that
    // would break things like `& 'a Foo` (unused here but cheap to be safe).
    if let Some(stripped) = s.strip_prefix("& ") {
        s = format!("&{}", stripped);
    }
    s
}

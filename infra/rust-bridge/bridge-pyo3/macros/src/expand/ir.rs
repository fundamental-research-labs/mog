// ---------------------------------------------------------------------------
// Intermediate representation
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub(crate) struct PyO3Descriptor {
    pub type_name: String,
    pub fn_prefix: Option<String>,
    /// Parsed from descriptor DSL but not used in free-function mode.
    /// Retained for parity with bridge-napi and potential future use.
    #[allow(dead_code)]
    pub service: Option<PyO3ServiceMeta>,
    pub methods: Vec<PyO3Method>,
}

#[derive(Debug)]
pub(crate) struct PyO3ServiceMeta {
    /// Parsed from descriptor DSL for parity with bridge-napi.
    #[allow(dead_code)]
    pub key_param: String,
}

#[derive(Debug)]
pub(crate) struct PyO3Method {
    pub access: PyO3Access,
    pub name: String,
    pub params: Vec<PyO3Param>,
    pub return_type: Option<ReturnInfo>,
    #[allow(dead_code)]
    pub error_type: Option<String>,
    pub is_fallible: bool,
    /// Parsed from descriptor DSL but not used — PyO3 bindings are sync-only.
    #[allow(dead_code)]
    pub is_async: bool,
    pub skip_targets: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PyO3Access {
    Pure,
    Read,
    Write,
    LifecycleCreate,
    LifecycleCreateFrom { variant_name: String },
}

#[derive(Debug, Clone)]
pub(crate) struct PyO3Param {
    pub name: String,
    pub ty: String,
    pub tag: PyO3ParamTag,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PyO3ParamTag {
    Str,
    Prim,
    Bytes,
    Serde,
    Parse,
    /// Serde-tagged enum (from `#[bridge::tagged_enum(...)]`). The FFI wire
    /// form on the PyO3 boundary is still a JSON string; the Python caller
    /// sends `json.dumps(dict)`. The generated code uses the schema to emit
    /// explicit discriminator-branch decode, which matches the B.2 plan's
    /// "Option A" (dict-discriminator helper) — chosen for speed-to-ship over
    /// Option B's pydantic-style sibling classes, which can be layered on top
    /// later without changing the FFI surface.
    TaggedEnum(PyO3TaggedEnumSpec),
}

/// PyO3-side mirror of `bridge_core::descriptor::TaggedEnumSchema`. Kept in
/// this crate to avoid a dependency on `bridge-core`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PyO3TaggedEnumSpec {
    pub type_name: String,
    pub tag: String,
    pub content: Option<String>,
    pub variants: Vec<PyO3VariantSpec>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PyO3VariantSpec {
    pub rust_name: String,
    pub wire_name: String,
    pub fields: Vec<PyO3VariantField>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PyO3VariantField {
    pub rust_name: String,
    pub wire_name: String,
    pub field_tag: PyO3FieldTag,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PyO3FieldTag {
    Str,
    Prim,
    Bytes,
    Serde,
    Parse,
}

#[derive(Debug)]
pub(crate) struct ReturnInfo {
    pub ty: String,
    pub is_string: bool,
    pub is_prim: bool,
    pub is_bytes: bool,
    pub is_unit: bool,
    /// True when the return type is a tuple `(Vec<u8>, T)` -- bytes + serde value.
    pub is_bytes_tuple: bool,
    /// When `is_bytes_tuple` is true, this holds the serde-serialized inner type.
    #[allow(dead_code)]
    pub serde_inner_ty: Option<String>,
    /// True when the return type is a tuple `(Self, T)` -- lifecycle create with aux data.
    pub is_self_tuple: bool,
    /// When `is_self_tuple` is true, this holds the second element type string.
    #[allow(dead_code)]
    pub self_tuple_inner_ty: Option<String>,
}

// ---------------------------------------------------------------------------
// snake_case helper
// ---------------------------------------------------------------------------

//! Descriptor IR for WASM macro expansion.

#[derive(Debug)]
pub(super) struct WasmDescriptor {
    pub type_name: String,
    pub fn_prefix: Option<String>,
    pub service: Option<WasmServiceMeta>,
    pub methods: Vec<WasmMethod>,
}

#[derive(Debug)]
pub(super) struct WasmServiceMeta {
    pub key_param: String,
}

#[derive(Debug)]
pub(super) struct WasmMethod {
    pub access: WasmAccess,
    pub name: String,
    pub params: Vec<WasmParam>,
    pub return_type: Option<ReturnInfo>,
    #[allow(dead_code)]
    pub error_type: Option<String>,
    pub is_fallible: bool,
    pub is_async: bool,
    pub skip_targets: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum WasmAccess {
    Pure,
    Read,
    Write,
    LifecycleCreate,
    LifecycleCreateFrom { variant_name: String },
}

#[derive(Debug)]
pub(super) struct WasmParam {
    pub name: String,
    pub ty: String,
    pub tag: WasmParamTag,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum WasmParamTag {
    Str,
    Prim,
    Bytes,
    Serde,
    Parse,
}

#[derive(Debug)]
pub(super) struct ReturnInfo {
    pub ty: String,
    pub is_string: bool,
    pub is_prim: bool,
    pub is_bytes: bool,
    pub is_unit: bool,
    /// True when the return type is a tuple `(Vec<u8>, T)` — bytes pass through
    /// as Uint8Array (no serde), T gets serde-serialized.
    pub is_bytes_tuple: bool,
    /// When `is_bytes_tuple` is true, this holds the serde-serialized inner type
    /// (the second element of the tuple). Used for introspection and testing.
    #[allow(dead_code)]
    pub serde_inner_ty: Option<String>,
}

use super::*;

// ---------------------------------------------------------------------------
// Intermediate representation
// ---------------------------------------------------------------------------

pub(crate) struct TauriDescriptor {
    pub group: Ident,
    pub fn_prefix: Option<String>,
    pub type_name: Ident,
    pub service: Option<TauriServiceMeta>,
    pub methods: Vec<TauriMethod>,
    /// Optional security level (e.g., `Sensitive`, `Critical`).
    /// When set, each generated command gets extra params for
    /// `verify_request` (timestamp, nonce, signature, window, app).
    pub security_level: Option<Ident>,
}

pub(crate) struct TauriServiceMeta {
    pub key_param: String,
}

pub(crate) struct TauriMethod {
    pub access: TauriAccess,
    pub name: Ident,
    pub params: Vec<TauriParam>,
    pub return_info: ReturnInfo,
    pub is_fallible: bool,
    pub is_async: bool,
    pub skip_targets: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TauriAccess {
    Pure,
    Read,
    Write,
    LifecycleCreate,
    LifecycleCreateFrom { variant_name: String },
}

pub(crate) struct TauriParam {
    pub name: Ident,
    pub original_ty: Type,
    pub tag: TauriParamTag,
    pub is_ref: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TauriParamTag {
    Str,
    Prim,
    Bytes,
    Serde,
    Parse,
}

pub(crate) struct ReturnInfo {
    pub ty: Option<Type>,
    /// True when the return type is plain `Vec<u8>`. For Tauri, we return
    /// `tauri::ipc::Response` to send raw bytes over IPC instead of JSON.
    pub is_bytes: bool,
    /// True when the return type is a tuple `(Vec<u8>, T)`.
    pub is_bytes_tuple: bool,
    /// When `is_bytes_tuple` is true, this holds the serde-serializable inner
    /// type (the second element of the tuple).
    #[allow(dead_code)]
    pub serde_inner_ty: Option<Type>,
    /// True when the return type is a tuple `(Self, T)` — used for lifecycle
    /// create methods that return auxiliary data alongside the new instance.
    pub is_self_tuple: bool,
    /// When `is_self_tuple` is true, this holds the second element type.
    pub self_tuple_inner_ty: Option<Type>,
}

// ---------------------------------------------------------------------------
// Parsing

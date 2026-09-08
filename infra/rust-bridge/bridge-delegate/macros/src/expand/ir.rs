#[derive(Debug)]
pub(super) struct DelegateDescriptor {
    /// Target type that will receive the delegate methods (e.g., "ComputeService")
    pub(super) target_type: String,
    /// Field on the target type that provides dispatch (e.g., "dispatch")
    pub(super) dispatch_field: String,
    /// When true, suppress the default `use compute_core::...` imports in the
    /// generated module. Tests use this to avoid a compute-core dev-dep; the
    /// production path (compute-api) keeps imports on (the default).
    pub(super) skip_default_imports: bool,
    /// Original source type name (e.g., "YrsComputeEngine"). Kept in the IR
    /// for debugging / future use; downstream re-emission uses target_type.
    #[allow(dead_code)]
    pub(super) source_type: String,
    /// Group name from the descriptor
    pub(super) group: String,
    /// Function prefix from the descriptor
    pub(super) fn_prefix: Option<String>,
    /// Whether this is a service (stateful) or stateless descriptor
    pub(super) service: Option<ServiceMeta>,
    /// All methods from the descriptor
    pub(super) methods: Vec<Method>,
}

#[derive(Debug)]
pub(super) struct ServiceMeta {
    pub(super) key_param: String,
}

#[derive(Debug)]
pub(super) struct Method {
    pub(super) access: Access,
    pub(super) name: String,
    pub(super) params: Vec<Param>,
    pub(super) return_type: Option<ReturnInfo>,
    pub(super) error_type: Option<String>,
    pub(super) is_fallible: bool,
    pub(super) is_async: bool,
    pub(super) skip_targets: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Access {
    Pure,
    Read,
    Write,
    Structural,
    /// Interior-mutable session state; preserves the `&self` receiver.
    Session,
    LifecycleCreate,
}

#[derive(Debug)]
pub(super) struct Param {
    pub(super) name: String,
    pub(super) ty: String,
    pub(super) tag: ParamTag,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ParamTag {
    Str,
    Prim,
    Bytes,
    Serde,
    Parse,
}

#[derive(Debug)]
pub(super) struct ReturnInfo {
    pub(super) ty: String,
    #[allow(dead_code)]
    pub(super) is_bytes_tuple: bool,
    /// The inner serde type when is_bytes_tuple is true
    #[allow(dead_code)]
    pub(super) serde_inner_ty: Option<String>,
}

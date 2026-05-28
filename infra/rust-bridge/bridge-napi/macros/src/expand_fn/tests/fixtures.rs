use super::super::*;
use crate::ir::{NapiAccess, NapiDescriptor, NapiMethod, NapiParam, NapiServiceMeta, ReturnInfo};

pub(super) fn parse_descriptor(tokens: &str) -> syn::Result<NapiDescriptor> {
    syn::parse_str::<NapiDescriptor>(tokens)
}

pub(super) fn code_for(desc: &NapiDescriptor) -> String {
    expand(desc).to_string()
}

pub(super) fn pure_method_desc(
    type_name: &str,
    method_name: &str,
    params: Vec<NapiParam>,
    return_type: Option<ReturnInfo>,
) -> NapiDescriptor {
    NapiDescriptor {
        type_name: type_name.to_string(),
        fn_prefix: None,
        service: None,
        methods: vec![NapiMethod {
            access: NapiAccess::Pure,
            name: method_name.to_string(),
            params,
            return_type,
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    }
}

pub(super) fn service_desc(
    type_name: &str,
    key_param: &str,
    methods: Vec<NapiMethod>,
) -> NapiDescriptor {
    NapiDescriptor {
        type_name: type_name.to_string(),
        fn_prefix: None,
        service: Some(NapiServiceMeta {
            key_param: key_param.to_string(),
        }),
        methods,
    }
}

pub(super) fn lifecycle_create(name: &str, return_type: Option<ReturnInfo>) -> NapiMethod {
    NapiMethod {
        access: NapiAccess::LifecycleCreate,
        name: name.to_string(),
        params: vec![],
        return_type,
        error_type: None,
        is_fallible: false,
        is_async: false,
        skip_targets: Vec::new(),
    }
}

pub(super) fn return_string() -> ReturnInfo {
    ReturnInfo {
        ty: "String".to_string(),
        is_string: true,
        is_prim: false,
        is_bytes: false,
        is_unit: false,
        is_bytes_tuple: false,
        serde_inner_ty: None,
        is_self_tuple: false,
        self_tuple_inner_ty: None,
    }
}

pub(super) fn return_prim(ty: &str) -> ReturnInfo {
    ReturnInfo {
        ty: ty.to_string(),
        is_string: false,
        is_prim: true,
        is_bytes: false,
        is_unit: false,
        is_bytes_tuple: false,
        serde_inner_ty: None,
        is_self_tuple: false,
        self_tuple_inner_ty: None,
    }
}

pub(super) fn return_bytes() -> ReturnInfo {
    ReturnInfo {
        ty: "Vec<u8>".to_string(),
        is_string: false,
        is_prim: false,
        is_bytes: true,
        is_unit: false,
        is_bytes_tuple: false,
        serde_inner_ty: None,
        is_self_tuple: false,
        self_tuple_inner_ty: None,
    }
}

pub(super) fn return_serde(ty: &str) -> ReturnInfo {
    ReturnInfo {
        ty: ty.to_string(),
        is_string: false,
        is_prim: false,
        is_bytes: false,
        is_unit: false,
        is_bytes_tuple: false,
        serde_inner_ty: None,
        is_self_tuple: false,
        self_tuple_inner_ty: None,
    }
}

pub(super) fn return_bytes_tuple(inner: &str) -> ReturnInfo {
    ReturnInfo {
        ty: format!("(Vec<u8>, {inner})"),
        is_string: false,
        is_prim: false,
        is_bytes: false,
        is_unit: false,
        is_bytes_tuple: true,
        serde_inner_ty: Some(inner.to_string()),
        is_self_tuple: false,
        self_tuple_inner_ty: None,
    }
}

pub(super) fn return_self_tuple(inner: &str) -> ReturnInfo {
    ReturnInfo {
        ty: format!("(Self, {inner})"),
        is_string: false,
        is_prim: false,
        is_bytes: false,
        is_unit: false,
        is_bytes_tuple: false,
        serde_inner_ty: None,
        is_self_tuple: true,
        self_tuple_inner_ty: Some(inner.to_string()),
    }
}

pub(super) fn assert_contains(code: &str, needle: &str) {
    assert!(
        code.contains(needle),
        "expected `{needle}` in output: {code}"
    );
}

pub(super) fn assert_not_contains(code: &str, needle: &str) {
    assert!(
        !code.contains(needle),
        "did not expect `{needle}` in output: {code}"
    );
}

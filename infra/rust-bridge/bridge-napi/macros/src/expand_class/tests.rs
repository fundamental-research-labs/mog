use quote::quote;

use super::class_decl::{GenerateClassInput, generate_class_impl};
use super::generate::expand_class;
use crate::ir::{
    NapiAccess, NapiDescriptor, NapiMethod, NapiParam, NapiParamTag, NapiServiceMeta, ReturnInfo,
};

#[test]
fn expand_class_produces_impl_block() {
    let desc = NapiDescriptor {
        type_name: "KvStore".to_string(),
        fn_prefix: None,
        service: Some(NapiServiceMeta {
            key_param: "store_id".to_string(),
        }),
        methods: vec![NapiMethod {
            access: NapiAccess::Read,
            name: "get".to_string(),
            params: vec![NapiParam {
                name: "key".to_string(),
                ty: "&str".to_string(),
                tag: NapiParamTag::Str,
            }],
            return_type: Some(ReturnInfo {
                ty: "String".to_string(),
                is_string: true,
                is_prim: false,
                is_bytes: false,
                is_unit: false,
                is_bytes_tuple: false,
                serde_inner_ty: None,
                is_self_tuple: false,
                self_tuple_inner_ty: None,
            }),
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand_class("MyEngine", &desc);
    let code = tokens.to_string();
    assert!(
        code.contains("impl MyEngine"),
        "expected impl block in output: {}",
        code
    );
    assert!(
        code.contains("& self"),
        "expected &self in output: {}",
        code
    );
}

#[test]
fn expand_class_lifecycle_creates_constructor() {
    let desc = NapiDescriptor {
        type_name: "KvStore".to_string(),
        fn_prefix: None,
        service: Some(NapiServiceMeta {
            key_param: "store_id".to_string(),
        }),
        methods: vec![NapiMethod {
            access: NapiAccess::LifecycleCreate,
            name: "new".to_string(),
            params: vec![NapiParam {
                name: "config".to_string(),
                ty: "KvConfig".to_string(),
                tag: NapiParamTag::Serde,
            }],
            return_type: None,
            error_type: Some("KvError".to_string()),
            is_fallible: true,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand_class("MyEngine", &desc);
    let code = tokens.to_string();
    assert!(
        code.contains("constructor"),
        "expected constructor attribute in output: {}",
        code
    );
    assert!(
        code.contains("Self"),
        "expected Self in constructor return: {}",
        code
    );
    assert!(
        code.contains("inner"),
        "expected inner field assignment: {}",
        code
    );
}

#[test]
fn expand_class_read_uses_self_ref() {
    let desc = NapiDescriptor {
        type_name: "KvStore".to_string(),
        fn_prefix: None,
        service: Some(NapiServiceMeta {
            key_param: "store_id".to_string(),
        }),
        methods: vec![NapiMethod {
            access: NapiAccess::Read,
            name: "get".to_string(),
            params: vec![],
            return_type: Some(ReturnInfo {
                ty: "String".to_string(),
                is_string: true,
                is_prim: false,
                is_bytes: false,
                is_unit: false,
                is_bytes_tuple: false,
                serde_inner_ty: None,
                is_self_tuple: false,
                self_tuple_inner_ty: None,
            }),
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand_class("MyEngine", &desc);
    let code = tokens.to_string();
    assert!(
        code.contains("& self"),
        "expected &self for read method: {}",
        code
    );
    assert!(
        !code.contains("& mut self"),
        "read method should not have &mut self: {}",
        code
    );
}

#[test]
fn expand_class_write_uses_mut_self() {
    let desc = NapiDescriptor {
        type_name: "KvStore".to_string(),
        fn_prefix: None,
        service: Some(NapiServiceMeta {
            key_param: "store_id".to_string(),
        }),
        methods: vec![NapiMethod {
            access: NapiAccess::Write,
            name: "set".to_string(),
            params: vec![NapiParam {
                name: "key".to_string(),
                ty: "&str".to_string(),
                tag: NapiParamTag::Str,
            }],
            return_type: None,
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand_class("MyEngine", &desc);
    let code = tokens.to_string();
    assert!(
        code.contains("& mut self"),
        "expected &mut self for write method: {}",
        code
    );
}

#[test]
fn expand_class_pure_stays_free_function() {
    let desc = NapiDescriptor {
        type_name: "KvUtils".to_string(),
        fn_prefix: None,
        service: None,
        methods: vec![
            NapiMethod {
                access: NapiAccess::Read,
                name: "get".to_string(),
                params: vec![],
                return_type: Some(ReturnInfo {
                    ty: "String".to_string(),
                    is_string: true,
                    is_prim: false,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                    is_self_tuple: false,
                    self_tuple_inner_ty: None,
                }),
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            },
            NapiMethod {
                access: NapiAccess::Pure,
                name: "hash_key".to_string(),
                params: vec![NapiParam {
                    name: "key".to_string(),
                    ty: "&str".to_string(),
                    tag: NapiParamTag::Str,
                }],
                return_type: Some(ReturnInfo {
                    ty: "u64".to_string(),
                    is_string: false,
                    is_prim: true,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                    is_self_tuple: false,
                    self_tuple_inner_ty: None,
                }),
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            },
        ],
    };
    let tokens = expand_class("MyEngine", &desc);
    let code = tokens.to_string();
    assert!(
        code.contains("kv_utils_hash_key"),
        "expected free function name in output: {}",
        code
    );
    assert!(
        code.contains("impl MyEngine"),
        "expected impl block for read method: {}",
        code
    );
}

#[test]
fn expand_class_no_registry() {
    let desc = NapiDescriptor {
        type_name: "KvStore".to_string(),
        fn_prefix: None,
        service: Some(NapiServiceMeta {
            key_param: "store_id".to_string(),
        }),
        methods: vec![
            NapiMethod {
                access: NapiAccess::LifecycleCreate,
                name: "new".to_string(),
                params: vec![],
                return_type: None,
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            },
            NapiMethod {
                access: NapiAccess::Read,
                name: "get".to_string(),
                params: vec![],
                return_type: Some(ReturnInfo {
                    ty: "String".to_string(),
                    is_string: true,
                    is_prim: false,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                    is_self_tuple: false,
                    self_tuple_inner_ty: None,
                }),
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            },
        ],
    };
    let tokens = expand_class("MyEngine", &desc);
    let code = tokens.to_string();
    assert!(
        !code.contains("DashMap"),
        "should not contain DashMap: {}",
        code
    );
    assert!(
        !code.contains("LazyLock"),
        "should not contain LazyLock: {}",
        code
    );
    assert!(
        !code.contains("__REGISTRY"),
        "should not contain registry: {}",
        code
    );
}

#[test]
fn expand_class_no_destroy() {
    let desc = NapiDescriptor {
        type_name: "KvStore".to_string(),
        fn_prefix: None,
        service: Some(NapiServiceMeta {
            key_param: "store_id".to_string(),
        }),
        methods: vec![NapiMethod {
            access: NapiAccess::LifecycleCreate,
            name: "new".to_string(),
            params: vec![],
            return_type: None,
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand_class("MyEngine", &desc);
    let code = tokens.to_string();
    assert!(
        !code.contains("destroy"),
        "should not contain destroy: {}",
        code
    );
}

#[test]
fn expand_class_js_name_attribute() {
    let desc = NapiDescriptor {
        type_name: "KvStore".to_string(),
        fn_prefix: None,
        service: Some(NapiServiceMeta {
            key_param: "store_id".to_string(),
        }),
        methods: vec![NapiMethod {
            access: NapiAccess::Read,
            name: "get_value".to_string(),
            params: vec![],
            return_type: Some(ReturnInfo {
                ty: "String".to_string(),
                is_string: true,
                is_prim: false,
                is_bytes: false,
                is_unit: false,
                is_bytes_tuple: false,
                serde_inner_ty: None,
                is_self_tuple: false,
                self_tuple_inner_ty: None,
            }),
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand_class("MyEngine", &desc);
    let code = tokens.to_string();
    assert!(
        code.contains("kv_store_get_value"),
        "expected js_name with prefixed name: {}",
        code
    );
    assert!(
        code.contains("js_name"),
        "expected js_name attribute: {}",
        code
    );
}

#[test]
fn expand_class_skip_napi_method() {
    let desc = NapiDescriptor {
        type_name: "KvStore".to_string(),
        fn_prefix: None,
        service: Some(NapiServiceMeta {
            key_param: "store_id".to_string(),
        }),
        methods: vec![
            NapiMethod {
                access: NapiAccess::LifecycleCreate,
                name: "new".to_string(),
                params: vec![],
                return_type: None,
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: vec!["napi".to_string()],
            },
            NapiMethod {
                access: NapiAccess::Read,
                name: "get".to_string(),
                params: vec![],
                return_type: Some(ReturnInfo {
                    ty: "String".to_string(),
                    is_string: true,
                    is_prim: false,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                    is_self_tuple: false,
                    self_tuple_inner_ty: None,
                }),
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            },
        ],
    };
    let tokens = expand_class("MyEngine", &desc);
    let code = tokens.to_string();
    assert!(
        !code.contains("constructor"),
        "skipped lifecycle should not emit constructor: {}",
        code
    );
    assert!(
        code.contains("get"),
        "read method should still be present: {}",
        code
    );
    assert!(
        code.contains("& self"),
        "read method should use &self: {}",
        code
    );
}

#[test]
fn expand_class_serde_params_work() {
    let desc = NapiDescriptor {
        type_name: "Svc".to_string(),
        fn_prefix: None,
        service: Some(NapiServiceMeta {
            key_param: "id".to_string(),
        }),
        methods: vec![NapiMethod {
            access: NapiAccess::Write,
            name: "update".to_string(),
            params: vec![NapiParam {
                name: "config".to_string(),
                ty: "MyConfig".to_string(),
                tag: NapiParamTag::Serde,
            }],
            return_type: None,
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand_class("MyEngine", &desc);
    let code = tokens.to_string();
    assert!(
        code.contains("serde_json :: from_str"),
        "expected serde_json::from_str in class method: {}",
        code
    );
    assert!(
        code.contains("config : String"),
        "expected String param for serde in class method: {}",
        code
    );
}

#[test]
fn expand_class_custom_prefix() {
    let desc = NapiDescriptor {
        type_name: "KvStore".to_string(),
        fn_prefix: Some("compute".to_string()),
        service: Some(NapiServiceMeta {
            key_param: "id".to_string(),
        }),
        methods: vec![NapiMethod {
            access: NapiAccess::Read,
            name: "get_value".to_string(),
            params: vec![],
            return_type: Some(ReturnInfo {
                ty: "String".to_string(),
                is_string: true,
                is_prim: false,
                is_bytes: false,
                is_unit: false,
                is_bytes_tuple: false,
                serde_inner_ty: None,
                is_self_tuple: false,
                self_tuple_inner_ty: None,
            }),
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand_class("MyEngine", &desc);
    let code = tokens.to_string();
    assert!(
        code.contains("compute_get_value"),
        "expected custom prefix in js_name: {}",
        code
    );
}

#[test]
fn expand_class_serde_return() {
    let desc = NapiDescriptor {
        type_name: "Engine".to_string(),
        fn_prefix: None,
        service: Some(NapiServiceMeta {
            key_param: "id".to_string(),
        }),
        methods: vec![NapiMethod {
            access: NapiAccess::Read,
            name: "get_stats".to_string(),
            params: vec![],
            return_type: Some(ReturnInfo {
                ty: "EngineStats".to_string(),
                is_string: false,
                is_prim: false,
                is_bytes: false,
                is_unit: false,
                is_bytes_tuple: false,
                serde_inner_ty: None,
                is_self_tuple: false,
                self_tuple_inner_ty: None,
            }),
            error_type: None,
            is_fallible: false,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand_class("MyEngine", &desc);
    let code = tokens.to_string();
    assert!(
        code.contains("serde_json :: to_string"),
        "expected serde_json::to_string in class method: {}",
        code
    );
    assert!(
        code.contains("self . inner"),
        "expected self.inner access: {}",
        code
    );
}

#[test]
fn expand_class_bytes_tuple_return() {
    let desc = NapiDescriptor {
        type_name: "Engine".to_string(),
        fn_prefix: None,
        service: Some(NapiServiceMeta {
            key_param: "id".to_string(),
        }),
        methods: vec![NapiMethod {
            access: NapiAccess::Write,
            name: "apply".to_string(),
            params: vec![],
            return_type: Some(ReturnInfo {
                ty: "(Vec<u8>, MutationMeta)".to_string(),
                is_string: false,
                is_prim: false,
                is_bytes: false,
                is_unit: false,
                is_bytes_tuple: true,
                serde_inner_ty: Some("MutationMeta".to_string()),
                is_self_tuple: false,
                self_tuple_inner_ty: None,
            }),
            error_type: None,
            is_fallible: true,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand_class("MyEngine", &desc);
    let code = tokens.to_string();
    assert!(
        code.contains("Buffer"),
        "expected Buffer in bytes-tuple return: {}",
        code
    );
    assert!(
        code.contains("& mut self"),
        "expected &mut self for write: {}",
        code
    );
}

#[test]
fn generate_class_input_parses() {
    let input: proc_macro2::TokenStream = quote! {
        struct ComputeEngine(some::path::Inner);
        some::path::descriptor_a,
        some::path::descriptor_b,
    };
    let parsed: GenerateClassInput = syn::parse2(input).unwrap();
    assert_eq!(parsed.class_name.to_string(), "ComputeEngine");
    assert_eq!(parsed.descriptors.len(), 2);
}

#[test]
fn generate_class_impl_emits_struct_and_macro() {
    let input: proc_macro2::TokenStream = quote! {
        struct MyEngine(path::to::Inner);
        path::to::desc_a,
    };
    let tokens = generate_class_impl(input).unwrap();
    let code = tokens.to_string();
    assert!(
        code.contains("pub struct MyEngine"),
        "expected struct definition: {}",
        code
    );
    assert!(
        code.contains("pub (crate) inner"),
        "expected pub(crate) inner field: {}",
        code
    );
    assert!(
        code.contains("__napi_class_expand_MyEngine"),
        "expected callback macro: {}",
        code
    );
    assert!(
        code.contains("desc_a"),
        "expected descriptor invocation: {}",
        code
    );
}

#[test]
fn async_class_method_emits_async_fn() {
    let desc = NapiDescriptor {
        type_name: "DbDriver".to_string(),
        fn_prefix: None,
        service: Some(NapiServiceMeta {
            key_param: "id".to_string(),
        }),
        methods: vec![NapiMethod {
            access: NapiAccess::Read,
            name: "query".to_string(),
            params: vec![NapiParam {
                name: "sql".to_string(),
                ty: "String".to_string(),
                tag: NapiParamTag::Str,
            }],
            return_type: Some(ReturnInfo {
                ty: "String".to_string(),
                is_string: true,
                is_prim: false,
                is_bytes: false,
                is_unit: false,
                is_bytes_tuple: false,
                serde_inner_ty: None,
                is_self_tuple: false,
                self_tuple_inner_ty: None,
            }),
            error_type: Some("DbError".to_string()),
            is_fallible: true,
            is_async: true,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand_class("MyDbDriver", &desc);
    let code = tokens.to_string();
    assert!(
        code.contains("pub async fn query"),
        "expected pub async fn in class method: {}",
        code
    );
    assert!(
        code.contains(". await"),
        "expected .await in class async method: {}",
        code
    );
    assert!(
        code.contains("& self"),
        "expected &self for read method: {}",
        code
    );
}

#[test]
fn class_lifecycle_create_self_tuple_stashes_result() {
    let desc = NapiDescriptor {
        type_name: "Engine".to_string(),
        fn_prefix: None,
        service: Some(NapiServiceMeta {
            key_param: "engine_id".to_string(),
        }),
        methods: vec![NapiMethod {
            access: NapiAccess::LifecycleCreate,
            name: "new".to_string(),
            params: vec![],
            return_type: Some(ReturnInfo {
                ty: "(Self, InitData)".to_string(),
                is_string: false,
                is_prim: false,
                is_bytes: false,
                is_unit: false,
                is_bytes_tuple: false,
                serde_inner_ty: None,
                is_self_tuple: true,
                self_tuple_inner_ty: Some("InitData".to_string()),
            }),
            error_type: None,
            is_fallible: true,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand_class("MyEngine", &desc);
    let code = tokens.to_string();
    assert!(
        code.contains("constructor"),
        "expected constructor attribute: {}",
        code
    );
    assert!(
        code.contains("__lifecycle_result"),
        "expected __lifecycle_result field assignment: {}",
        code
    );
    assert!(
        code.contains("__inner"),
        "expected __inner destructure: {}",
        code
    );
    assert!(
        code.contains("__data"),
        "expected __data destructure: {}",
        code
    );
    assert!(
        code.contains("serde_json :: to_string"),
        "expected serde_json serialization: {}",
        code
    );
    assert!(
        code.contains("take_lifecycle_result"),
        "expected take_lifecycle_result method: {}",
        code
    );
}

#[test]
fn class_plain_lifecycle_has_no_take_lifecycle_result() {
    let desc = NapiDescriptor {
        type_name: "KvStore".to_string(),
        fn_prefix: None,
        service: Some(NapiServiceMeta {
            key_param: "store_id".to_string(),
        }),
        methods: vec![NapiMethod {
            access: NapiAccess::LifecycleCreate,
            name: "new".to_string(),
            params: vec![],
            return_type: None,
            error_type: None,
            is_fallible: true,
            is_async: false,
            skip_targets: Vec::new(),
        }],
    };
    let tokens = expand_class("MyKvStore", &desc);
    let code = tokens.to_string();
    assert!(
        !code.contains("take_lifecycle_result"),
        "plain constructor should not emit take_lifecycle_result: {}",
        code
    );
}

#[test]
fn generate_class_struct_includes_lifecycle_result_field() {
    let input: proc_macro2::TokenStream = quote! {
        struct MyEngine(path::to::Inner);
        path::to::desc_a,
    };
    let tokens = generate_class_impl(input).unwrap();
    let code = tokens.to_string();
    assert!(
        code.contains("__lifecycle_result"),
        "expected __lifecycle_result field in struct: {}",
        code
    );
    assert!(
        code.contains("pub (crate) inner"),
        "expected inner field: {}",
        code
    );
}

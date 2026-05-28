use super::fixtures::*;
use crate::ir::{NapiAccess, NapiMethod, NapiParam, NapiParamTag};

#[test]
fn bytes_tuple_service_method_codegen() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = Engine;
            key_type = str;
            key_param = "engine_id";
            lifecycle create new {
                params {}
                return_type = Self;
            }
            method write apply_mutations {
                params {}
                return_type = (Vec<u8>, MutationMeta);
                error_type = EngineError;
                fallible;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    let method = &desc.methods[1];
    assert!(method.return_type.is_some());
    assert!(
        method.return_type.as_ref().unwrap().is_bytes_tuple,
        "expected bytes_tuple return for service method"
    );

    let code = code_for(&desc);
    assert_contains(&code, "engine_apply_mutations");
    assert_contains(&code, "Buffer");
}

#[test]
fn registry_uses_lazy_lock_dashmap() {
    let desc = service_desc("KvStore", "store_id", vec![lifecycle_create("new", None)]);
    let code = code_for(&desc);
    assert_contains(&code, "LazyLock");
    assert_contains(&code, "DashMap");
    assert_not_contains(&code, "thread_local");
}

#[test]
fn destroy_takes_string_param() {
    let desc = service_desc("KvStore", "store_id", vec![lifecycle_create("new", None)]);
    let code = code_for(&desc);
    assert_contains(&code, "id : String");
    assert_contains(&code, "remove (& id)");
}

#[test]
fn service_key_param_is_string() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "store_id";
            lifecycle create new {
                params {}
                return_type = Self;
            }
            method read get {
                params { [str] key: &str, }
                return_type = String;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    let code = code_for(&desc);
    assert_contains(&code, "store_id : String");
}

#[test]
fn registry_lifecycle_create_self_tuple_returns_string() {
    let mut create = lifecycle_create("new", Some(return_self_tuple("InitData")));
    create.is_fallible = true;
    let desc = service_desc("Engine", "engine_id", vec![create]);
    let code = code_for(&desc);
    assert_contains(&code, "napi :: Result < String >");
    assert_contains(&code, "__instance");
    assert_contains(&code, "__data");
    assert_contains(&code, "serde_json :: to_string");
    assert_contains(&code, "insert (engine_id . to_string () , __instance)");
}

#[test]
fn plain_lifecycle_create_returns_unit_and_stores_instance() {
    let desc = service_desc("Engine", "engine_id", vec![lifecycle_create("new", None)]);
    let code = code_for(&desc);
    assert_contains(&code, "pub fn engine_new");
    assert_contains(&code, "napi :: Result < () >");
    assert_contains(&code, "insert (engine_id . to_string () , instance)");
    assert_contains(&code, "Ok (())");
}

#[test]
fn registry_helpers_report_missing_instance_with_napi_error() {
    let desc = service_desc("KvStore", "store_id", vec![lifecycle_create("new", None)]);
    let code = code_for(&desc);
    assert_contains(&code, "fn __with_read_kv_store");
    assert_contains(&code, "fn __with_write_kv_store");
    assert_contains(&code, "napi :: Result < R >");
    assert_contains(&code, "napi :: Error :: from_reason");
    assert_contains(&code, "format ! (\"instance not found: {}\" , id)");
}

#[test]
fn service_method_signature_prepends_key_param() {
    let desc = service_desc(
        "KvStore",
        "store_id",
        vec![
            lifecycle_create("new", None),
            NapiMethod {
                access: NapiAccess::Read,
                name: "get".to_string(),
                params: vec![NapiParam {
                    name: "key".to_string(),
                    ty: "&str".to_string(),
                    tag: NapiParamTag::Str,
                }],
                return_type: Some(return_string()),
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            },
        ],
    );
    let code = code_for(&desc);
    assert_contains(
        &code,
        "pub fn kv_store_get (store_id : String , key : String)",
    );
}

use super::fixtures::*;
use crate::ir::{NapiAccess, NapiMethod, NapiParam, NapiParamTag};

#[test]
fn error_type_uses_napi_error() {
    let desc = service_desc(
        "Svc",
        "id",
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
                error_type: Some("SvcError".to_string()),
                is_fallible: true,
                is_async: false,
                skip_targets: Vec::new(),
            },
        ],
    );
    let code = code_for(&desc);
    assert_contains(&code, "napi :: Error :: from_reason");
    assert_contains(&code, "napi :: Result");
    assert_not_contains(&code, "JsError");
}

#[test]
fn sync_read_method_uses_read_helper() {
    let desc = service_desc(
        "Svc",
        "id",
        vec![
            lifecycle_create("new", None),
            NapiMethod {
                access: NapiAccess::Read,
                name: "get".to_string(),
                params: vec![],
                return_type: Some(return_string()),
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            },
        ],
    );
    let code = code_for(&desc);
    assert_contains(&code, "__with_read_svc (& id , | instance |");
    assert_contains(&code, "instance . get ()");
}

#[test]
fn sync_write_method_uses_write_helper() {
    let desc = service_desc(
        "Svc",
        "id",
        vec![
            lifecycle_create("new", None),
            NapiMethod {
                access: NapiAccess::Write,
                name: "set".to_string(),
                params: vec![],
                return_type: None,
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            },
        ],
    );
    let code = code_for(&desc);
    assert_contains(&code, "__with_write_svc (& id , | instance |");
    assert_contains(&code, "instance . set ()");
}

#[test]
fn sync_write_method_passes_mut_instance() {
    let desc = service_desc("Svc", "id", vec![lifecycle_create("new", None)]);
    let code = code_for(&desc);
    assert_contains(&code, "F : FnOnce (& mut Svc) -> napi :: Result < R >");
    assert_contains(&code, "f (entry . value_mut ())");
}

#[test]
fn pure_fallible_method_maps_bridge_error() {
    let mut desc = pure_method_desc("Svc", "load", vec![], Some(return_string()));
    desc.methods[0].error_type = Some("SvcError".to_string());
    desc.methods[0].is_fallible = true;
    let code = code_for(&desc);
    assert_contains(&code, "Svc :: load () . map_err");
    assert_contains(&code, "napi :: Error :: from_reason");
    assert_contains(&code, "bridge_types :: bridge_format_err ! (e)");
}

#[test]
fn pure_nonfallible_method_calls_associated_function_directly() {
    let desc = pure_method_desc("Svc", "load", vec![], Some(return_string()));
    let code = code_for(&desc);
    assert_contains(&code, "let result = Svc :: load () ;");
    assert_not_contains(&code, "map_err");
    assert_contains(&code, "napi_derive :: napi");
}

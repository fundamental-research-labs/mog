use super::fixtures::*;
use crate::ir::{NapiAccess, NapiMethod, NapiParam, NapiParamTag};

#[test]
fn async_pure_method_emits_async_fn_and_await() {
    let mut desc = pure_method_desc(
        "DbService",
        "validate",
        vec![NapiParam {
            name: "sql".to_string(),
            ty: "String".to_string(),
            tag: NapiParamTag::Str,
        }],
        Some(return_prim("bool")),
    );
    desc.methods[0].is_async = true;
    let code = code_for(&desc);
    assert_contains(&code, "pub async fn db_service_validate");
    assert_contains(&code, ". await");
}

#[test]
fn async_pure_method_fallible_emits_await_before_map_err() {
    let mut desc = pure_method_desc(
        "DbService",
        "query",
        vec![NapiParam {
            name: "sql".to_string(),
            ty: "String".to_string(),
            tag: NapiParamTag::Str,
        }],
        Some(return_string()),
    );
    desc.methods[0].error_type = Some("DbError".to_string());
    desc.methods[0].is_fallible = true;
    desc.methods[0].is_async = true;
    let code = code_for(&desc);
    assert_contains(&code, "pub async fn");
    assert_contains(&code, ". await");
    let await_pos = code.find(". await").unwrap();
    let map_err_pos = code.find("map_err").unwrap();
    assert!(await_pos < map_err_pos, "expected .await before .map_err");
}

#[test]
fn sync_pure_method_unchanged_when_is_async_false() {
    let desc = pure_method_desc("DbService", "version", vec![], Some(return_string()));
    let code = code_for(&desc);
    assert_not_contains(&code, "async");
    assert_not_contains(&code, ".await");
}

#[test]
fn async_service_method_clones_from_registry() {
    let desc = service_desc(
        "DbDriver",
        "connection_id",
        vec![
            lifecycle_create("new", None),
            NapiMethod {
                access: NapiAccess::Read,
                name: "query".to_string(),
                params: vec![NapiParam {
                    name: "sql".to_string(),
                    ty: "String".to_string(),
                    tag: NapiParamTag::Str,
                }],
                return_type: Some(return_string()),
                error_type: Some("DbError".to_string()),
                is_fallible: true,
                is_async: true,
                skip_targets: Vec::new(),
            },
        ],
    );
    let code = code_for(&desc);
    assert_contains(&code, "pub async fn db_driver_query");
    assert_contains(&code, ". clone ()");
    assert_contains(&code, ". await");
    assert_contains(&code, "pub fn db_driver_new");
}

#[test]
fn async_service_write_method_clones_mut() {
    let desc = service_desc(
        "DbDriver",
        "connection_id",
        vec![
            lifecycle_create("new", None),
            NapiMethod {
                access: NapiAccess::Write,
                name: "execute".to_string(),
                params: vec![NapiParam {
                    name: "sql".to_string(),
                    ty: "String".to_string(),
                    tag: NapiParamTag::Str,
                }],
                return_type: None,
                error_type: Some("DbError".to_string()),
                is_fallible: true,
                is_async: true,
                skip_targets: Vec::new(),
            },
        ],
    );
    let code = code_for(&desc);
    assert_contains(&code, "pub async fn db_driver_execute");
    assert_contains(&code, "let mut svc");
    assert_contains(&code, ". await");
}

#[test]
fn async_flag_parsed_from_descriptor() {
    let input = r#"
            bridge_version = 1;
            group = ops;
            service = DbDriver;
            key_type = str;
            key_param = "connection_id";
            lifecycle create new {
                params {}
                return_type = Self;
            }
            method read query {
                params { [str] sql: String, }
                return_type = String;
                error_type = DbError;
                fallible;
                async;
            }
        "#;
    let desc = parse_descriptor(input).unwrap();
    assert_eq!(desc.methods.len(), 2);
    assert!(
        !desc.methods[0].is_async,
        "lifecycle create should not be async"
    );
    assert!(desc.methods[1].is_async, "query method should be async");
}

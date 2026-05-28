use super::fixtures::*;

#[test]
fn serde_return_uses_serde_json() {
    let desc = pure_method_desc(
        "MyService",
        "get_stats",
        vec![],
        Some(return_serde("StoreStats")),
    );
    let code = code_for(&desc);
    assert_contains(&code, "serde_json :: to_string");
    assert_not_contains(&code, "serde_wasm_bindgen");
}

#[test]
fn bytes_return_emits_buffer() {
    let desc = pure_method_desc("Enc", "encode", vec![], Some(return_bytes()));
    let code = code_for(&desc);
    assert_contains(&code, "Buffer");
    assert_contains(&code, "Buffer :: from");
}

#[test]
fn bytes_tuple_pure_method_codegen() {
    let desc = pure_method_desc(
        "Engine",
        "get_data",
        vec![],
        Some(return_bytes_tuple("MutationMeta")),
    );
    let code = code_for(&desc);
    assert_contains(&code, "engine_get_data");
    assert_contains(&code, "Buffer");
    assert_contains(&code, "serde_json");
    assert_contains(&code, "to_le_bytes");
    assert_contains(&code, "extend_from_slice (& bytes)");
}

#[test]
fn unit_return_emits_napi_result_unit() {
    let desc = pure_method_desc("Svc", "clear", vec![], None);
    let code = code_for(&desc);
    assert_contains(&code, "napi :: Result < () >");
    assert_contains(&code, "Ok (())");
}

#[test]
fn string_return_emits_napi_result_string() {
    let desc = pure_method_desc("Svc", "name", vec![], Some(return_string()));
    let code = code_for(&desc);
    assert_contains(&code, "napi :: Result < String >");
    assert_contains(&code, "Ok (result)");
}

#[test]
fn primitive_return_emits_napi_result_primitive() {
    let desc = pure_method_desc("Svc", "count", vec![], Some(return_prim("u64")));
    let code = code_for(&desc);
    assert_contains(&code, "napi :: Result < u64 >");
    assert_contains(&code, "Ok (result)");
}

use bridge_ts::emit::*;
use bridge_ts::types::*;

#[test]
fn classify_pure_method() {
    let method = TsMethod {
        rust_name: "validate".into(),
        access: MethodAccess::Pure,
        params: vec![],
        return_type: TsType::Boolean,
        is_fallible: false,
        skip_platforms: vec![],
    };
    assert_eq!(classify_bridge_pattern(&method), BridgePattern::Pure);
}

#[test]
fn classify_read_method() {
    let method = TsMethod {
        rust_name: "get_settings".into(),
        access: MethodAccess::Read,
        params: vec![],
        return_type: TsType::Named("Settings".into()),
        is_fallible: false,
        skip_platforms: vec![],
    };
    assert_eq!(classify_bridge_pattern(&method), BridgePattern::Query);
}

#[test]
fn classify_write_with_binary_mutation() {
    let method = TsMethod {
        rust_name: "set_cell".into(),
        access: MethodAccess::Write,
        params: vec![],
        return_type: TsType::Tuple(vec![
            TsType::Uint8Array,
            TsType::Named("MutationResult".into()),
        ]),
        is_fallible: false,
        skip_platforms: vec![],
    };
    assert_eq!(classify_bridge_pattern(&method), BridgePattern::Mutate);
}

#[test]
fn classify_system_write_with_binary_mutation() {
    let method = TsMethod {
        rust_name: "complete_deferred_hydration".into(),
        access: MethodAccess::Write,
        params: vec![],
        return_type: TsType::Tuple(vec![
            TsType::Uint8Array,
            TsType::Named("MutationResult".into()),
        ]),
        is_fallible: false,
        skip_platforms: vec![],
    };
    assert_eq!(
        classify_bridge_pattern(&method),
        BridgePattern::SystemMutate
    );
}

#[test]
fn classify_system_write_with_sync_apply_metadata_as_binary_mutation() {
    let method = TsMethod {
        rust_name: "apply_sync_update".into(),
        access: MethodAccess::Write,
        params: vec![],
        return_type: TsType::Tuple(vec![
            TsType::Uint8Array,
            TsType::Named("SyncApplyMutationMetadataWire".into()),
        ]),
        is_fallible: false,
        skip_platforms: vec![],
    };
    assert_eq!(
        classify_bridge_pattern(&method),
        BridgePattern::SystemMutate
    );
}

#[test]
fn classify_ui_state_format_write_as_system_mutation() {
    let method = TsMethod {
        rust_name: "set_format_for_ranges_ui_state".into(),
        access: MethodAccess::Write,
        params: vec![],
        return_type: TsType::Tuple(vec![
            TsType::Uint8Array,
            TsType::Named("MutationResult".into()),
        ]),
        is_fallible: false,
        skip_platforms: vec![],
    };
    assert_eq!(
        classify_bridge_pattern(&method),
        BridgePattern::SystemMutate
    );
}

#[test]
fn classify_write_without_binary_tuple_uses_query() {
    // Write methods returning bare MutationResult (not wrapped in a binary tuple)
    // are classified as write-as-query. They do not enter mutation admission
    // until their Rust return shape changes to (Vec<u8>, MutationResult).
    let method = TsMethod {
        rust_name: "set_name".into(),
        access: MethodAccess::Write,
        params: vec![],
        return_type: TsType::Named("MutationResult".into()),
        is_fallible: false,
        skip_platforms: vec![],
    };
    assert_eq!(classify_bridge_pattern(&method), BridgePattern::Query);
}

#[test]
fn classify_write_void_return() {
    let method = TsMethod {
        rust_name: "clear".into(),
        access: MethodAccess::Write,
        params: vec![],
        return_type: TsType::Void,
        is_fallible: false,
        skip_platforms: vec![],
    };
    assert_eq!(classify_bridge_pattern(&method), BridgePattern::Query);
}

#[test]
fn classify_write_non_mutation_result_uses_query() {
    // Write methods that return a concrete type other than MutationResult
    // (e.g. IdentityFormula, Uint8Array) use write-as-query to preserve the type.
    let method = TsMethod {
        rust_name: "to_identity_formula".into(),
        access: MethodAccess::Write,
        params: vec![],
        return_type: TsType::Named("IdentityFormula".into()),
        is_fallible: false,
        skip_platforms: vec![],
    };
    assert_eq!(classify_bridge_pattern(&method), BridgePattern::Query);
}

#[test]
fn classify_write_uint8array_return_uses_query() {
    // Write methods returning Uint8Array (e.g. get_viewport_binary) should use Query.
    let method = TsMethod {
        rust_name: "get_viewport_binary".into(),
        access: MethodAccess::Write,
        params: vec![],
        return_type: TsType::Uint8Array,
        is_fallible: false,
        skip_platforms: vec![],
    };
    assert_eq!(classify_bridge_pattern(&method), BridgePattern::Query);
}

#[test]
fn classify_lifecycle_create_skipped() {
    let method = TsMethod {
        rust_name: "new".into(),
        access: MethodAccess::LifecycleCreate,
        params: vec![],
        return_type: TsType::Void,
        is_fallible: false,
        skip_platforms: vec![],
    };
    assert_eq!(classify_bridge_pattern(&method), BridgePattern::Skip);
}

#[test]
fn classify_skip_ts_bridge() {
    let method = TsMethod {
        rust_name: "internal_op".into(),
        access: MethodAccess::Write,
        params: vec![],
        return_type: TsType::Void,
        is_fallible: false,
        skip_platforms: vec!["ts_bridge".into()],
    };
    assert_eq!(classify_bridge_pattern(&method), BridgePattern::Skip);
}

#[test]
fn classify_skip_ts_bridge_among_others() {
    let method = TsMethod {
        rust_name: "internal_op".into(),
        access: MethodAccess::Read,
        params: vec![],
        return_type: TsType::String,
        is_fallible: false,
        skip_platforms: vec!["wasm".into(), "ts_bridge".into()],
    };
    assert_eq!(classify_bridge_pattern(&method), BridgePattern::Skip);
}

#[test]
fn is_binary_mutation_return_true_mutation_result() {
    let ty = TsType::Tuple(vec![
        TsType::Uint8Array,
        TsType::Named("MutationResult".into()),
    ]);
    assert!(is_binary_mutation_return(&ty));
}

#[test]
fn is_binary_mutation_return_false_mutation_metadata() {
    // MutationMetadata has been removed; only MutationResult is recognized.
    let ty = TsType::Tuple(vec![
        TsType::Uint8Array,
        TsType::Named("MutationMetadata".into()),
    ]);
    assert!(!is_binary_mutation_return(&ty));
}

#[test]
fn is_binary_mutation_return_true_sync_apply_metadata() {
    let ty = TsType::Tuple(vec![
        TsType::Uint8Array,
        TsType::Named("SyncApplyMutationMetadataWire".into()),
    ]);
    assert!(is_binary_mutation_return(&ty));
}

#[test]
fn is_binary_mutation_return_false_wrong_second() {
    let ty = TsType::Tuple(vec![TsType::Uint8Array, TsType::Named("OtherType".into())]);
    assert!(!is_binary_mutation_return(&ty));
}

#[test]
fn is_binary_mutation_return_false_wrong_first() {
    let ty = TsType::Tuple(vec![TsType::String, TsType::Named("MutationResult".into())]);
    assert!(!is_binary_mutation_return(&ty));
}

#[test]
fn is_binary_mutation_return_false_single() {
    let ty = TsType::Named("MutationResult".into());
    assert!(!is_binary_mutation_return(&ty));
}

#[test]
fn is_binary_mutation_return_false_three_elements() {
    let ty = TsType::Tuple(vec![
        TsType::Uint8Array,
        TsType::Named("MutationResult".into()),
        TsType::Number,
    ]);
    assert!(!is_binary_mutation_return(&ty));
}

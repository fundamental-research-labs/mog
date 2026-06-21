use bridge_ts::emit::*;
use bridge_ts::types::*;

#[test]
fn factory_method_pure_has_typed_params_and_return() {
    let svc = TsService {
        rust_name: "BridgePure".into(),
        fn_prefix: Some("".into()),
        key: None,
        methods: vec![],
    };
    let method = TsMethod {
        rust_name: "validate".into(),
        access: MethodAccess::Pure,
        params: vec![TsParam {
            rust_name: "input".into(),
            ts_type: TsType::String,
            is_parse: false,
        }],
        return_type: TsType::Boolean,
        is_fallible: false,
        skip_platforms: vec![],
    };
    let output = emit_bridge_class_method(&svc, &method, "", BridgePattern::Pure);
    assert!(
        output.contains("input: string"),
        "should have typed param, got: {}",
        output
    );
    assert!(
        output.contains("): Promise<boolean>"),
        "should have return type, got: {}",
        output
    );
    assert!(
        output.contains("this.core.transport.call<boolean>"),
        "should have <T> on call, got: {}",
        output
    );
}

#[test]
fn factory_method_mutate_has_wire_type_on_call() {
    let svc = TsService {
        rust_name: "ComputeEngine".into(),
        fn_prefix: Some("compute".into()),
        key: Some(ServiceKey {
            param_name: "doc_id".into(),
        }),
        methods: vec![],
    };
    let method = TsMethod {
        rust_name: "set_cell".into(),
        access: MethodAccess::Write,
        params: vec![
            TsParam {
                rust_name: "sheet_id".into(),
                ts_type: TsType::Named("SheetId".into()),
                is_parse: false,
            },
            TsParam {
                rust_name: "input".into(),
                ts_type: TsType::String,
                is_parse: false,
            },
        ],
        return_type: TsType::Tuple(vec![
            TsType::Uint8Array,
            TsType::Named("MutationResult".into()),
        ]),
        is_fallible: false,
        skip_platforms: vec![],
    };
    let output = emit_bridge_class_method(&svc, &method, "compute", BridgePattern::Mutate);
    // Params should be typed
    assert!(
        output.contains("sheetId: SheetId"),
        "should have typed param, got: {}",
        output
    );
    assert!(
        output.contains("input: string"),
        "should have typed param, got: {}",
        output
    );
    assert!(
        output.contains("admissionOptions?: MutationAdmissionOptions"),
        "should accept admission options, got: {}",
        output
    );
    // Return type should be unwrapped (MutationResult, not the tuple)
    assert!(
        output.contains("): Promise<MutationResult>"),
        "should have unwrapped return type, got: {}",
        output
    );
    // transport.call<T> should use the RAW wire type (full tuple)
    assert!(
        output.contains("this.core.transport.call<[Uint8Array, MutationResult]>"),
        "should have wire type on call, got: {}",
        output
    );
    assert!(
        output.contains(", undefined, admissionOptions)"),
        "should pass admission options as fourth mutatePublic arg, got: {}",
        output
    );
}

#[test]
fn factory_method_mutate_options_param_does_not_collide_with_admission_options() {
    let svc = TsService {
        rust_name: "ComputeEngine".into(),
        fn_prefix: Some("compute".into()),
        key: Some(ServiceKey {
            param_name: "doc_id".into(),
        }),
        methods: vec![],
    };
    let method = TsMethod {
        rust_name: "import_from_csv_bytes".into(),
        access: MethodAccess::Write,
        params: vec![
            TsParam {
                rust_name: "csv_data".into(),
                ts_type: TsType::Uint8Array,
                is_parse: false,
            },
            TsParam {
                rust_name: "options".into(),
                ts_type: TsType::Named("CsvImportOptions".into()),
                is_parse: false,
            },
        ],
        return_type: TsType::Tuple(vec![
            TsType::Uint8Array,
            TsType::Named("MutationResult".into()),
        ]),
        is_fallible: false,
        skip_platforms: vec![],
    };
    let pattern = classify_bridge_pattern(&method);
    let output = emit_bridge_class_method(&svc, &method, "compute", pattern);

    assert_eq!(pattern, BridgePattern::SystemMutate);
    assert!(
        output.contains(
            "importFromCsvBytes(csvData: Uint8Array, options: CsvImportOptions, admissionOptions?: MutationAdmissionOptions)"
        ),
        "should keep domain options and append admission options, got: {}",
        output
    );
    assert!(
        output.contains("this.core.mutateSystem('compute_import_from_csv_bytes'"),
        "should keep import as system mutation, got: {}",
        output
    );
    assert!(
        output.contains(", undefined, admissionOptions)"),
        "should pass admission options through, got: {}",
        output
    );
}

#[test]
fn factory_method_write_as_query_does_not_accept_admission_options() {
    let svc = TsService {
        rust_name: "ComputeEngine".into(),
        fn_prefix: Some("compute".into()),
        key: Some(ServiceKey {
            param_name: "doc_id".into(),
        }),
        methods: vec![],
    };
    let method = TsMethod {
        rust_name: "set_cells_batch".into(),
        access: MethodAccess::Write,
        params: vec![TsParam {
            rust_name: "cells".into(),
            ts_type: TsType::Array(Box::new(TsType::Named("BatchCellInput".into()))),
            is_parse: false,
        }],
        return_type: TsType::Named("SetCellsBatchResult".into()),
        is_fallible: false,
        skip_platforms: vec![],
    };
    let pattern = classify_bridge_pattern(&method);
    let output = emit_bridge_class_method(&svc, &method, "compute", pattern);

    assert_eq!(pattern, BridgePattern::Query);
    assert!(
        output.contains("setCellsBatch(cells: BatchCellInput[]): Promise<SetCellsBatchResult>"),
        "should not add admission options to write-as-query signature, got: {}",
        output
    );
    assert!(
        output.contains("this.core.query("),
        "should preserve query wrapper, got: {}",
        output
    );
    assert!(
        !output.contains("admissionOptions"),
        "write-as-query must not accept admission options, got: {}",
        output
    );
    assert!(
        !output.contains("mutatePublic"),
        "write-as-query must not use mutatePublic, got: {}",
        output
    );
}

#[test]
fn factory_method_query_has_typed_output() {
    let svc = TsService {
        rust_name: "ComputeEngine".into(),
        fn_prefix: Some("compute".into()),
        key: Some(ServiceKey {
            param_name: "doc_id".into(),
        }),
        methods: vec![],
    };
    let method = TsMethod {
        rust_name: "get_settings".into(),
        access: MethodAccess::Read,
        params: vec![],
        return_type: TsType::Named("Settings".into()),
        is_fallible: false,
        skip_platforms: vec![],
    };
    let output = emit_bridge_class_method(&svc, &method, "compute", BridgePattern::Query);
    assert!(
        output.contains("): Promise<Settings>"),
        "should have return type, got: {}",
        output
    );
    assert!(
        output.contains("this.core.transport.call<Settings>"),
        "should have <T> on call, got: {}",
        output
    );
    assert!(
        output.contains("this.core.query("),
        "should use this.core.query wrapper, got: {}",
        output
    );
}

use std::path::{Path, PathBuf};

use syn::{ImplItem, Item, Type};

const ROOT_MAX_LINES: usize = 1_200;
const FOCUSED_MODULE_MAX_LINES: usize = 1_000;
const LARGE_NON_BRIDGE_IMPL_MAX_LINES: usize = 80;

const FOCUSED_MODULES: &[&str] = &[
    "grid_indexing.rs",
    "recalc_postprocess.rs",
    "format_inference.rs",
    "pivot_materialization.rs",
    "recalc.rs",
    "sync_pipeline.rs",
    "mutation_dispatch.rs",
];

#[test]
fn engine_root_module_shape_stays_small_and_delegated() {
    let engine_dir = manifest_dir().join("src/storage/engine");
    let root = engine_dir.join("mod.rs");
    let source = read_source(&root);

    assert_line_budget(&root, &source, ROOT_MAX_LINES);
    assert_no_large_non_bridge_impl_methods(&root, &source);

    for module in FOCUSED_MODULES {
        let path = engine_dir.join(module);
        let source = read_source(&path);
        assert_line_budget(&path, &source, FOCUSED_MODULE_MAX_LINES);
    }
}

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn read_source(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|err| {
        panic!("failed to read {}: {err}", path.display());
    })
}

fn assert_line_budget(path: &Path, source: &str, max_lines: usize) {
    let lines = source.lines().count();
    assert!(
        lines <= max_lines,
        "{} has {lines} lines; budget is {max_lines}",
        display_repo_path(path)
    );
}

fn assert_no_large_non_bridge_impl_methods(path: &Path, source: &str) {
    let syntax = syn::parse_file(source).unwrap_or_else(|err| {
        panic!("failed to parse {} with syn: {err}", path.display());
    });

    let mut offenders = Vec::new();
    for item in syntax.items {
        let Item::Impl(item_impl) = item else {
            continue;
        };
        if !is_engine_impl(&item_impl.self_ty) {
            continue;
        }

        for item in item_impl.items {
            let ImplItem::Fn(method) = item else {
                continue;
            };
            if has_bridge_attr(&method.attrs) {
                continue;
            }

            let start = method.sig.ident.span().start().line;
            let end = method.block.brace_token.span.close().end().line;
            let lines = end.saturating_sub(start).saturating_add(1);
            if lines > LARGE_NON_BRIDGE_IMPL_MAX_LINES {
                offenders.push(format!(
                    "{}::{name} has {lines} lines",
                    display_repo_path(path),
                    name = method.sig.ident
                ));
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "large non-bridge impl methods belong in focused engine modules:\n{}",
        offenders.join("\n")
    );
}

fn is_engine_impl(ty: &Type) -> bool {
    let Type::Path(type_path) = ty else {
        return false;
    };
    type_path
        .path
        .segments
        .last()
        .is_some_and(|segment| segment.ident == "YrsComputeEngine")
}

fn has_bridge_attr(attrs: &[syn::Attribute]) -> bool {
    attrs.iter().any(|attr| {
        attr.path()
            .segments
            .first()
            .is_some_and(|segment| segment.ident == "bridge")
    })
}

fn display_repo_path(path: &Path) -> String {
    path.strip_prefix(manifest_dir().parent().unwrap().parent().unwrap())
        .unwrap_or(path)
        .display()
        .to_string()
}

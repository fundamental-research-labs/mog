use std::fs;
use std::path::{Path, PathBuf};

#[test]
fn table_catalog_legacy_path_guardrails() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .and_then(Path::parent)
        .expect("compute/core has a repo root parent");
    let scan_roots = [
        "compute/core/src",
        "compute/core/crates/compute-document/src",
        "domain-types/src",
        "file-io/xlsx/parser/src",
    ];
    let denied_patterns = [
        "from_binding_json_standalone",
        "from_binding_to_table",
        "legacy_full_table_from_workbook_binding_json",
        "legacy_full_table_from_attachment_entry",
        "table_to_binding_json",
        "table_spec_to_table",
        "table_spec_to_table_with_ids",
        "table_to_table_spec",
        "TableBinding",
        "table_range_id",
        "table_name_from_range_id",
        "table_id_from_range_id",
    ];

    let mut violations = Vec::new();
    for scan_root in scan_roots {
        let root = repo_root.join(scan_root);
        collect_rust_files(&root, &mut |path| {
            let rel = path.strip_prefix(repo_root).expect("path under repo root");
            let rel_text = rel.to_string_lossy().replace('\\', "/");
            if is_test_or_fixture_path(rel) {
                return;
            }
            let Ok(source) = fs::read_to_string(path) else {
                return;
            };
            for pattern in denied_patterns {
                if source.contains(pattern) {
                    violations.push(format!("{rel_text}: contains `{pattern}`"));
                }
            }
        });
    }

    violations.sort();
    violations.dedup();
    assert!(
        violations.is_empty(),
        "legacy table-binding APIs are not allowed in production Rust:\n{}",
        violations.join("\n")
    );
}

fn collect_rust_files(path: &Path, visit: &mut impl FnMut(&Path)) {
    if path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name == "target" || name.starts_with("target-"))
    {
        return;
    }

    let Ok(metadata) = fs::metadata(path) else {
        return;
    };
    if metadata.is_file() {
        if path.extension().and_then(|ext| ext.to_str()) == Some("rs") {
            visit(path);
        }
        return;
    }
    if !metadata.is_dir() {
        return;
    }

    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        collect_rust_files(&entry.path(), visit);
    }
}

fn is_test_or_fixture_path(path: &Path) -> bool {
    path.components().any(|component| {
        let text = component.as_os_str().to_string_lossy();
        text == "tests"
            || text == "test_support"
            || text.ends_with("_tests.rs")
            || text == "tests.rs"
            || text == "fixtures.rs"
    })
}

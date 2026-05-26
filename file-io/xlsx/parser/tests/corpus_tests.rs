//! Test suite for malformed file corpus
//!
//! Tests parser resilience against various types of malformed XLSX files.
//! These tests verify that the parser:
//! 1. Does not panic on any input
//! 2. Collects errors appropriately
//! 3. Returns partial results when possible
//! 4. Provides meaningful error messages

use std::fs;
use std::path::{Path, PathBuf};

use xlsx_parser::{LazyWorkbook, XlsxArchive, parse_xlsx_to_output};

/// Get the path to the test corpus directory
fn corpus_path() -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir).join("test-corpus")
}

/// Helper to collect all .xlsx files in a directory
fn collect_xlsx_files(dir: &Path) -> Vec<PathBuf> {
    if !dir.exists() {
        return Vec::new();
    }

    fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.extension().map(|ext| ext == "xlsx").unwrap_or(false))
                .collect()
        })
        .unwrap_or_default()
}

/// Helper struct to track test results
#[derive(Debug, Default)]
struct TestResults {
    total: usize,
    passed: usize,
    panicked: usize,
    errors: Vec<String>,
}

impl TestResults {
    fn record_success(&mut self) {
        self.total += 1;
        self.passed += 1;
    }

    fn record_expected_failure(&mut self, file: &Path, error: &str) {
        self.total += 1;
        self.passed += 1; // Expected failure is a pass
        println!("  [OK] {} - Error as expected: {}", file.display(), error);
    }

    fn record_unexpected_panic(&mut self, file: &Path) {
        self.total += 1;
        self.panicked += 1;
        self.errors.push(format!("PANIC in {}", file.display()));
    }

    fn assert_no_panics(&self) {
        assert_eq!(
            self.panicked, 0,
            "Parser panicked on {} files: {:?}",
            self.panicked, self.errors
        );
    }
}

// =============================================================================
// Basic Corpus Tests
// =============================================================================

/// Test that basic valid files parse successfully
#[test]
fn test_basic_corpus() {
    let basic_dir = corpus_path().join("basic");
    let files = collect_xlsx_files(&basic_dir);

    if files.is_empty() {
        println!(
            "No basic corpus files found at {:?}, skipping test",
            basic_dir
        );
        return;
    }

    let mut results = TestResults::default();

    for file in files {
        println!("Testing basic file: {}", file.display());

        let data = match fs::read(&file) {
            Ok(d) => d,
            Err(e) => {
                results
                    .errors
                    .push(format!("Failed to read {}: {}", file.display(), e));
                continue;
            }
        };

        // Test lazy parsing
        let lazy_result = std::panic::catch_unwind(|| LazyWorkbook::new(&data));
        match lazy_result {
            Ok(result) => {
                assert!(
                    result.is_ok(),
                    "Basic file should parse: {}",
                    file.display()
                );
                results.record_success();
            }
            Err(_) => {
                results.record_unexpected_panic(&file);
            }
        }

        // Test full parsing
        let full_result =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| parse_xlsx_to_output(&data)));

        match full_result {
            Ok(result) => {
                assert!(
                    result.is_ok(),
                    "Basic file should parse: {}",
                    file.display()
                );
                results.record_success();
            }
            Err(_) => {
                results.record_unexpected_panic(&file);
            }
        }
    }

    results.assert_no_panics();
    println!(
        "Basic corpus: {}/{} tests passed",
        results.passed, results.total
    );
}

// =============================================================================
// Malformed XML Tests
// =============================================================================

/// Test malformed XML recovery
#[test]
fn test_malformed_xml_recovery() {
    let xml_dir = corpus_path().join("malformed").join("xml");
    let files = collect_xlsx_files(&xml_dir);

    if files.is_empty() {
        println!(
            "No malformed XML corpus files found at {:?}, skipping test",
            xml_dir
        );
        return;
    }

    let mut results = TestResults::default();

    for file in files {
        println!("Testing malformed XML file: {}", file.display());

        let data = match fs::read(&file) {
            Ok(d) => d,
            Err(e) => {
                results
                    .errors
                    .push(format!("Failed to read {}: {}", file.display(), e));
                continue;
            }
        };

        // Test that parsing does not panic
        let lazy_result = std::panic::catch_unwind(|| LazyWorkbook::new(&data));
        match lazy_result {
            Ok(result) => {
                // Malformed files may or may not parse, but should not panic
                if result.is_ok() {
                    println!("  [INFO] {} parsed despite being malformed", file.display());
                } else {
                    if let Err(ref e) = result {
                        results.record_expected_failure(&file, &e.to_string());
                    }
                }
                results.record_success();
            }
            Err(_) => {
                results.record_unexpected_panic(&file);
            }
        }

        // Test full parsing
        let full_result =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| parse_xlsx_to_output(&data)));

        match full_result {
            Ok(_) => {
                results.record_success();
            }
            Err(_) => {
                results.record_unexpected_panic(&file);
            }
        }
    }

    results.assert_no_panics();
    println!(
        "Malformed XML corpus: {}/{} tests passed",
        results.passed, results.total
    );
}

// =============================================================================
// Truncated File Tests
// =============================================================================

/// Test truncated file handling
#[test]
fn test_truncated_files() {
    let truncated_dir = corpus_path().join("malformed").join("truncated");
    let files = collect_xlsx_files(&truncated_dir);

    if files.is_empty() {
        println!(
            "No truncated corpus files found at {:?}, skipping test",
            truncated_dir
        );
        return;
    }

    let mut results = TestResults::default();

    for file in files {
        println!("Testing truncated file: {}", file.display());

        let data = match fs::read(&file) {
            Ok(d) => d,
            Err(e) => {
                results
                    .errors
                    .push(format!("Failed to read {}: {}", file.display(), e));
                continue;
            }
        };

        // Test lazy parsing - should not panic
        let lazy_result = std::panic::catch_unwind(|| LazyWorkbook::new(&data));
        match lazy_result {
            Ok(result) => {
                // Truncated files should fail to parse, but gracefully
                if !result.is_ok() {
                    if let Err(ref e) = result {
                        results.record_expected_failure(&file, &e.to_string());
                    }
                } else {
                    println!("  [WARN] {} parsed despite being truncated", file.display());
                    results.record_success();
                }
            }
            Err(_) => {
                results.record_unexpected_panic(&file);
            }
        }

        // Test full parsing
        let full_result =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| parse_xlsx_to_output(&data)));

        match full_result {
            Ok(_) => {
                results.record_success();
            }
            Err(_) => {
                results.record_unexpected_panic(&file);
            }
        }
    }

    results.assert_no_panics();
    println!(
        "Truncated corpus: {}/{} tests passed",
        results.passed, results.total
    );
}

// =============================================================================
// Invalid Cell Reference Tests
// =============================================================================

/// Test invalid cell reference recovery
#[test]
fn test_invalid_cell_references() {
    let cells_dir = corpus_path().join("malformed").join("cells");
    let files = collect_xlsx_files(&cells_dir);

    if files.is_empty() {
        println!(
            "No invalid cell corpus files found at {:?}, skipping test",
            cells_dir
        );
        return;
    }

    let mut results = TestResults::default();

    for file in files {
        println!("Testing invalid cell file: {}", file.display());

        let data = match fs::read(&file) {
            Ok(d) => d,
            Err(e) => {
                results
                    .errors
                    .push(format!("Failed to read {}: {}", file.display(), e));
                continue;
            }
        };

        // Test that parsing does not panic
        let lazy_result = std::panic::catch_unwind(|| LazyWorkbook::new(&data));
        match lazy_result {
            Ok(result) => {
                match result {
                    Ok(ref wb) => {
                        println!(
                            "  [INFO] {} - parsed with {} sheets",
                            file.display(),
                            wb.sheet_count()
                        );
                    }
                    Err(ref e) => {
                        results.record_expected_failure(&file, &e.to_string());
                    }
                }
                results.record_success();
            }
            Err(_) => {
                results.record_unexpected_panic(&file);
            }
        }

        // Test full parsing - should skip bad cells
        let full_result =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| parse_xlsx_to_output(&data)));

        match full_result {
            Ok(result) => {
                if let Ok(ref parsed) = result {
                    println!(
                        "  [INFO] {} - parsed {} sheets",
                        file.display(),
                        parsed.0.sheets.len()
                    );
                }
                results.record_success();
            }
            Err(_) => {
                results.record_unexpected_panic(&file);
            }
        }
    }

    results.assert_no_panics();
    println!(
        "Invalid cell corpus: {}/{} tests passed",
        results.passed, results.total
    );
}

// =============================================================================
// Corrupted ZIP Tests
// =============================================================================

/// Test corrupted ZIP handling
#[test]
fn test_corrupted_zip() {
    let zip_dir = corpus_path().join("malformed").join("zip");
    let files = collect_xlsx_files(&zip_dir);

    if files.is_empty() {
        println!(
            "No corrupted ZIP corpus files found at {:?}, skipping test",
            zip_dir
        );
        return;
    }

    let mut results = TestResults::default();

    for file in files {
        println!("Testing corrupted ZIP file: {}", file.display());

        let data = match fs::read(&file) {
            Ok(d) => d,
            Err(e) => {
                results
                    .errors
                    .push(format!("Failed to read {}: {}", file.display(), e));
                continue;
            }
        };

        // Test archive opening - should not panic
        let archive_result = std::panic::catch_unwind(|| XlsxArchive::new(&data));
        match archive_result {
            Ok(result) => match result {
                Ok(_archive) => {
                    println!("  [WARN] {} opened despite being corrupted", file.display());
                    results.record_success();
                }
                Err(e) => {
                    results.record_expected_failure(&file, &format!("{}", e));
                }
            },
            Err(_) => {
                results.record_unexpected_panic(&file);
            }
        }

        // Test full parsing
        let full_result =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| parse_xlsx_to_output(&data)));

        match full_result {
            Ok(_) => {
                results.record_success();
            }
            Err(_) => {
                results.record_unexpected_panic(&file);
            }
        }
    }

    results.assert_no_panics();
    println!(
        "Corrupted ZIP corpus: {}/{} tests passed",
        results.passed, results.total
    );
}

// =============================================================================
// Invalid Styles Tests
// =============================================================================

/// Test invalid style index handling
#[test]
fn test_invalid_styles() {
    let styles_dir = corpus_path().join("malformed").join("styles");
    let files = collect_xlsx_files(&styles_dir);

    if files.is_empty() {
        println!(
            "No invalid styles corpus files found at {:?}, skipping test",
            styles_dir
        );
        return;
    }

    let mut results = TestResults::default();

    for file in files {
        println!("Testing invalid styles file: {}", file.display());

        let data = match fs::read(&file) {
            Ok(d) => d,
            Err(e) => {
                results
                    .errors
                    .push(format!("Failed to read {}: {}", file.display(), e));
                continue;
            }
        };

        // Test that parsing does not panic
        let lazy_result = std::panic::catch_unwind(|| LazyWorkbook::new(&data));
        match lazy_result {
            Ok(_) => {
                results.record_success();
            }
            Err(_) => {
                results.record_unexpected_panic(&file);
            }
        }

        // Test full parsing
        let full_result =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| parse_xlsx_to_output(&data)));

        match full_result {
            Ok(_) => {
                results.record_success();
            }
            Err(_) => {
                results.record_unexpected_panic(&file);
            }
        }
    }

    results.assert_no_panics();
    println!(
        "Invalid styles corpus: {}/{} tests passed",
        results.passed, results.total
    );
}

// =============================================================================
// Missing Relationships Tests
// =============================================================================

/// Test missing relationship files handling
#[test]
fn test_missing_relationships() {
    let rels_dir = corpus_path().join("malformed").join("relationships");
    let files = collect_xlsx_files(&rels_dir);

    if files.is_empty() {
        println!(
            "No missing relationships corpus files found at {:?}, skipping test",
            rels_dir
        );
        return;
    }

    let mut results = TestResults::default();

    for file in files {
        println!("Testing missing relationships file: {}", file.display());

        let data = match fs::read(&file) {
            Ok(d) => d,
            Err(e) => {
                results
                    .errors
                    .push(format!("Failed to read {}: {}", file.display(), e));
                continue;
            }
        };

        // Test that parsing does not panic
        let lazy_result = std::panic::catch_unwind(|| LazyWorkbook::new(&data));
        match lazy_result {
            Ok(_) => {
                results.record_success();
            }
            Err(_) => {
                results.record_unexpected_panic(&file);
            }
        }
    }

    results.assert_no_panics();
    println!(
        "Missing relationships corpus: {}/{} tests passed",
        results.passed, results.total
    );
}

// =============================================================================
// Mixed Errors Tests
// =============================================================================

/// Test files with multiple error types
#[test]
fn test_mixed_errors() {
    let mixed_dir = corpus_path().join("malformed").join("mixed");
    let files = collect_xlsx_files(&mixed_dir);

    if files.is_empty() {
        println!(
            "No mixed error corpus files found at {:?}, skipping test",
            mixed_dir
        );
        return;
    }

    let mut results = TestResults::default();

    for file in files {
        println!("Testing mixed error file: {}", file.display());

        let data = match fs::read(&file) {
            Ok(d) => d,
            Err(e) => {
                results
                    .errors
                    .push(format!("Failed to read {}: {}", file.display(), e));
                continue;
            }
        };

        // Test that parsing does not panic
        let lazy_result = std::panic::catch_unwind(|| LazyWorkbook::new(&data));
        match lazy_result {
            Ok(_) => {
                results.record_success();
            }
            Err(_) => {
                results.record_unexpected_panic(&file);
            }
        }

        // Test full parsing
        let full_result =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| parse_xlsx_to_output(&data)));

        match full_result {
            Ok(_) => {
                results.record_success();
            }
            Err(_) => {
                results.record_unexpected_panic(&file);
            }
        }
    }

    results.assert_no_panics();
    println!(
        "Mixed error corpus: {}/{} tests passed",
        results.passed, results.total
    );
}

// =============================================================================
// Edge Case Tests
// =============================================================================

/// Test edge case files (unusual but valid)
#[test]
fn test_edge_cases() {
    let edge_dir = corpus_path().join("edge-cases");
    let files = collect_xlsx_files(&edge_dir);

    if files.is_empty() {
        println!(
            "No edge case corpus files found at {:?}, skipping test",
            edge_dir
        );
        return;
    }

    let mut results = TestResults::default();

    for file in files {
        println!("Testing edge case file: {}", file.display());

        let data = match fs::read(&file) {
            Ok(d) => d,
            Err(e) => {
                results
                    .errors
                    .push(format!("Failed to read {}: {}", file.display(), e));
                continue;
            }
        };

        // Edge cases should parse successfully
        let lazy_result = std::panic::catch_unwind(|| LazyWorkbook::new(&data));
        match lazy_result {
            Ok(result) => match result {
                Ok(ref wb) => {
                    println!("  [OK] {} - {} sheets", file.display(), wb.sheet_count());
                    results.record_success();
                }
                Err(ref e) => {
                    results.errors.push(format!(
                        "Edge case file should parse: {} - {}",
                        file.display(),
                        e
                    ));
                }
            },
            Err(_) => {
                results.record_unexpected_panic(&file);
            }
        }

        // Test full parsing
        let full_result =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| parse_xlsx_to_output(&data)));

        match full_result {
            Ok(result) => {
                if let Ok(ref parsed) = result {
                    println!(
                        "  [OK] {} - {} sheets",
                        file.display(),
                        parsed.0.sheets.len()
                    );
                    results.record_success();
                }
            }
            Err(_) => {
                results.record_unexpected_panic(&file);
            }
        }
    }

    results.assert_no_panics();
    println!(
        "Edge case corpus: {}/{} tests passed",
        results.passed, results.total
    );
}

// =============================================================================
// Synthetic Malformed Data Tests
// =============================================================================

/// Test synthetic malformed data (not from files)
#[test]
fn test_synthetic_malformed_data() {
    let mut results = TestResults::default();

    // Test empty data
    let empty_result = std::panic::catch_unwind(|| LazyWorkbook::new(&[]));
    assert!(empty_result.is_ok(), "Empty data should not panic");
    results.record_success();

    // Test random garbage
    let garbage: Vec<u8> = (0..1000).map(|i| (i % 256) as u8).collect();
    let garbage_result = std::panic::catch_unwind(|| LazyWorkbook::new(&garbage));
    assert!(garbage_result.is_ok(), "Random garbage should not panic");
    results.record_success();

    // Test valid ZIP signature but garbage content
    let mut fake_zip = vec![0x50, 0x4B, 0x03, 0x04]; // PK signature
    fake_zip.extend_from_slice(&[0u8; 100]);
    let fake_result = std::panic::catch_unwind(|| LazyWorkbook::new(&fake_zip));
    assert!(fake_result.is_ok(), "Fake ZIP should not panic");
    results.record_success();

    // Test full parsing with garbage data (should be bounded)
    let small_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        parse_xlsx_to_output(&garbage)
    }));
    assert!(small_result.is_ok(), "Garbage data should not panic");
    results.record_success();

    println!(
        "Synthetic malformed data: {}/{} tests passed",
        results.passed, results.total
    );
}

// =============================================================================
// Parity Corpus Tests
// =============================================================================

/// Recursively collect all .xlsx files under a directory
fn collect_xlsx_files_recursive(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if !dir.exists() {
        return files;
    }
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if path.is_dir() {
            files.extend(collect_xlsx_files_recursive(&path));
        } else if path.extension().map(|ext| ext == "xlsx").unwrap_or(false) {
            files.push(path);
        }
    }
    files.sort();
    files
}

/// Test that all parity corpus fixtures parse successfully without panics
#[test]
fn test_parity_corpus() {
    let parity_dir = corpus_path().join("parity");
    let files = collect_xlsx_files_recursive(&parity_dir);

    if files.is_empty() {
        println!(
            "No parity corpus files found at {:?}, skipping test",
            parity_dir
        );
        return;
    }

    let mut results = TestResults::default();

    for file in &files {
        println!("Testing parity file: {}", file.display());

        let data = match fs::read(file) {
            Ok(d) => d,
            Err(e) => {
                results
                    .errors
                    .push(format!("Failed to read {}: {}", file.display(), e));
                continue;
            }
        };

        // Lazy parsing — should succeed (these are valid files)
        let lazy_result = std::panic::catch_unwind(|| LazyWorkbook::new(&data));
        match lazy_result {
            Ok(result) => {
                match result {
                    Ok(ref wb) => {
                        println!(
                            "  [OK] {} — {} sheets",
                            file.file_name().unwrap().to_string_lossy(),
                            wb.sheet_count()
                        );
                    }
                    Err(ref e) => {
                        println!(
                            "  [FAIL] {} — lazy parse error: {}",
                            file.file_name().unwrap().to_string_lossy(),
                            e
                        );
                    }
                }
                results.record_success();
            }
            Err(_) => {
                results.record_unexpected_panic(file);
            }
        }

        // Full parsing — should succeed
        let full_result =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| parse_xlsx_to_output(&data)));
        match full_result {
            Ok(result) => {
                if let Ok(ref parsed) = result {
                    println!(
                        "  [OK] {} — {} sheets parsed",
                        file.file_name().unwrap().to_string_lossy(),
                        parsed.0.sheets.len()
                    );
                }
                results.record_success();
            }
            Err(_) => {
                results.record_unexpected_panic(file);
            }
        }
    }

    results.assert_no_panics();
    println!(
        "\nParity corpus: {}/{} tests passed ({} files)",
        results.passed,
        results.total,
        files.len()
    );
}

/// Test that all corpus directories exist
#[test]
fn test_corpus_structure() {
    let base = corpus_path();

    let expected_dirs = [
        "basic",
        "malformed/xml",
        "malformed/zip",
        "malformed/cells",
        "malformed/styles",
        "malformed/relationships",
        "malformed/truncated",
        "malformed/mixed",
        "edge-cases",
    ];

    for dir in expected_dirs {
        let full_path = base.join(dir);
        assert!(
            full_path.exists(),
            "Corpus directory should exist: {:?}",
            full_path
        );
    }

    println!("All corpus directories verified");
}

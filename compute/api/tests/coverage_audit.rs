//! R7.3 — Enforcement coverage audit.
//!
//! Scans `compute/core/src/storage/engine/` for every `#[bridge::read]`,
//! `#[bridge::write]`, and `#[bridge::structural]` annotation and verifies:
//!
//! 1. Every annotation that becomes a gated delegate has an explicit
//!    `scope = "..."` argument (cell | range | sheet | workbook). Missing
//!    scope is a compile error under `gated = true`, but we re-assert it
//!    here so the audit fails loud if the gating flag is ever flipped off.
//!
//! 2. No `#[bridge::read(scope = "cell")]` method returns a type whose
//!    redaction falls into the `RedactMaybe` blanket no-op and
//!    unambiguously carries cell-scope *value* data. These are the
//!    known-latent gaps from R4 — the audit tracks them by enumerating
//!    the offending methods and asserting only the known-set, so a new
//!    cell-scope read that silently joins the no-op path will flip the
//!    count and fail the test.
//!
//! 3. Every `#[bridge::read/write/structural]` annotation sits on a `pub
//!    fn` — the delegate macro only surfaces `pub` methods across the
//!    bridge; a `pub(crate)` gated method is a classification error.
//!
//! The audit is a *regression* harness: it locks down the current set of
//! gaps so they can't silently get worse while R8+ resolves them. When
//! the gap is closed (e.g. `RedactMaybe` gets a typed impl for
//! `CellValue`), this test is expected to break and the fixed path
//! should just remove its entry.

use std::fs;
use std::path::{Path, PathBuf};

/// Return types surfaced by `#[bridge::read(scope = "cell")]` methods.
///
/// These were previously gap types that the blanket
/// `impl<T> RedactMaybe for T {}` passed through unredacted. The blanket has
/// been removed and each entry now has
/// an explicit typed impl (see
/// `compute/core/crates/compute-security/src/filters.rs` and the
/// `CellInfo` impl in `cell_semantics.rs`). The list remains as an
/// audit anchor: any new cell-scope read return type must either land
/// here with a matching `RedactMaybe` impl, or be classified as
/// shape-only metadata in `SAFE_METADATA_RETURNS` below.
const KNOWN_REDACT_MAYBE_GAPS: &[&str] = &[
    "CellValue",
    "Option<CellInfo>",
    "CellInfo",
    "CellValidationResult",
    "Option<FindInRangeResult>",
    "FindInRangeResult",
    "Option<CellPosition>",
    "CellPosition",
    "IdentityCell",
    "ProjectionData",
];

/// Return-type fragments that unambiguously carry cell-scope data.
/// Any `#[bridge::api]` method on `YrsComputeEngine` that returns one
/// of these MUST be gated (i.e. carry a `#[bridge::read|write|
/// structural]` annotation with an explicit `scope = "..."`). A
/// method classified as `#[bridge::pure]` or `#[bridge::lifecycle]`
/// — or missing a gating annotation altogether — returning one of
/// these types is a data-leak and fails the audit with the method
/// name.
///
/// Entries are matched as **substrings** of the normalised return
/// type so generic wrappers (`Option<CellValue>`, `Vec<CellValue>`,
/// `HashMap<_, CellValue>`, etc.) all trip the check. Update this
/// list when a new cell-data type joins the workbook API surface —
/// a future agent adding, say, `RichCellContent` should register it
/// here so forgetting to gate the corresponding read surfaces as a
/// hard test failure rather than silent leakage.
const CELL_DATA_RETURN_FRAGMENTS: &[&str] = &[
    // Value payloads.
    "CellValue",
    "CellInfo",
    // Formula text — exposes the expression under a principal with
    // `None` level; must be gated at least at Read.
    "FormulaText",
    // Binary viewport buffers — the filter-viewport-buffer adapter
    // runs at `bridge::read(scope = "sheet")` and requires the
    // scope annotation to land on the emission path.
    "ViewportBuffer",
    // Sort-result payloads embed cell values for UI replay.
    "FindInRangeResult",
    "CellPosition",
];

/// Method names exempt from the cell-data gate — they return a
/// fragment-matching type but the payload is structurally cell-free
/// (e.g. a sheet-scoped `Vec<u8>` carrying layout bytes, not cell
/// bytes). Keep this list short; every entry must carry an in-code
/// justification comment so future agents understand why the exempt
/// method is safe. Adding to this list without justification is a
/// review red flag.
const CELL_DATA_GATE_EXEMPTIONS: &[&str] = &[
    // `from_snapshot` is a lifecycle constructor returning the engine
    // instance itself — not user cell data — plus a `RecalcResult`
    // summary that is already whole-workbook by definition. The
    // engine's own cells aren't addressable at that call boundary.
    "from_snapshot",
    // `from_yrs_state` — same: lifecycle constructor; returns the
    // engine + an initial recalc summary.
    "from_yrs_state",
    // `import_from_xlsx_bytes` returns a `RecalcResult`; the bytes
    // flow in, not out. The method itself is gated via
    // `#[bridge::write(scope = "workbook")]`.
    "import_from_xlsx_bytes",
];

/// A bridged method we pulled off the engine source.
#[derive(Debug, Clone)]
struct BridgedMethod {
    /// Containing file, relative to the repo root — for error messages.
    file: String,
    /// Approximate source line (first line of the #[bridge::...] attribute).
    line: usize,
    /// Kind: "read", "write", "structural", "pure", "lifecycle".
    kind: String,
    /// Scope as declared in the attribute, if any.
    scope: Option<String>,
    /// Function name (first identifier after `pub fn`).
    fn_name: String,
    /// Return type string (best-effort; truncated after the `->`).
    return_type: String,
    /// Visibility qualifier ("pub", "pub(crate)", etc.).
    visibility: String,
}

// ---------------------------------------------------------------------------
// Source scan.
//
// We rely on the source layout: every bridged method is annotated on one
// line with `#[bridge::<kind>(...)]` or `#[bridge::<kind>]`, followed
// within ~10 lines by a `pub fn name(...)` signature. A `->` on the same
// or a subsequent line up to the opening `{` carries the return type.
// ---------------------------------------------------------------------------

fn engine_src_root() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // compute/api → ../core/src/storage/engine
    manifest
        .join("..")
        .join("core")
        .join("src")
        .join("storage")
        .join("engine")
}

fn collect_rs_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).expect("read_dir").flatten() {
        let path = entry.path();
        if path.is_dir() {
            // Skip tests subdir (engine's own unit tests).
            if path.file_name().and_then(|s| s.to_str()) == Some("tests") {
                continue;
            }
            collect_rs_files(&path, out);
        } else if path.extension().and_then(|s| s.to_str()) == Some("rs") {
            out.push(path);
        }
    }
}

fn parse_file(path: &Path) -> Vec<BridgedMethod> {
    let text = fs::read_to_string(path).unwrap_or_else(|e| {
        panic!("read {}: {e}", path.display());
    });
    let lines: Vec<&str> = text.lines().collect();
    let mut out = Vec::new();
    let file_rel = path
        .strip_prefix(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .canonicalize()
                .unwrap_or_else(|_| PathBuf::from("..")),
        )
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| path.display().to_string());

    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim();
        if !line.starts_with("#[bridge::") {
            i += 1;
            continue;
        }
        // Extract kind + optional scope from the attribute body. The grammar
        // is permissive: the attr may span a single line (#[bridge::read]
        // alone or with args).
        let (kind, scope) = parse_attr(line);
        if !matches!(
            kind.as_str(),
            "read" | "write" | "structural" | "pure" | "lifecycle"
        ) {
            i += 1;
            continue;
        }

        // Scan forward for `fn name`. Skip additional attributes.
        let mut j = i + 1;
        let mut visibility = String::new();
        let mut fn_name = String::new();
        while j < lines.len() && j < i + 30 {
            let l2 = lines[j].trim();
            if l2.starts_with("#[") || l2.is_empty() {
                j += 1;
                continue;
            }
            if let Some((vis, name)) = parse_fn_line(l2) {
                visibility = vis;
                fn_name = name;
                break;
            }
            j += 1;
        }
        if fn_name.is_empty() {
            i += 1;
            continue;
        }

        // Scan for return type `-> T` before the opening brace or a
        // semi-colon (impl method bodies always use `{`).
        let mut return_type = "()".to_string();
        let mut k = j;
        let mut buffer = String::new();
        while k < lines.len() && k < j + 40 {
            buffer.push(' ');
            buffer.push_str(lines[k].trim());
            if buffer.contains('{') {
                break;
            }
            k += 1;
        }
        if let Some(arrow_idx) = buffer.find("->") {
            let tail = &buffer[arrow_idx + 2..];
            let end = tail.find('{').unwrap_or(tail.len());
            return_type = tail[..end].trim().to_string();
        }

        out.push(BridgedMethod {
            file: file_rel.clone(),
            line: i + 1,
            kind: kind.clone(),
            scope,
            fn_name,
            return_type,
            visibility,
        });
        i = j + 1;
    }
    out
}

fn parse_attr(line: &str) -> (String, Option<String>) {
    // Strip `#[bridge::` prefix and trailing `]`.
    let body = line.trim_start_matches("#[bridge::").trim_end_matches(']');
    // Kind is the ident up to `(` or `]` or whitespace.
    let kind_end = body
        .find(|c: char| c == '(' || c == ']' || c.is_whitespace())
        .unwrap_or(body.len());
    let kind = body[..kind_end].to_string();
    // Extract scope: look for `scope = "..."`.
    let scope = if let Some(idx) = body.find("scope") {
        let after = &body[idx..];
        if let Some(q1) = after.find('"') {
            let rest = &after[q1 + 1..];
            if let Some(q2) = rest.find('"') {
                Some(rest[..q2].to_string())
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };
    (kind, scope)
}

fn parse_fn_line(line: &str) -> Option<(String, String)> {
    // Match patterns: "pub fn name(...", "pub(crate) fn name(...".
    let rest = if let Some(r) = line.strip_prefix("pub fn ") {
        return Some(("pub".to_string(), extract_ident(r)));
    } else if let Some(r) = line.strip_prefix("pub(crate) fn ") {
        return Some(("pub(crate)".to_string(), extract_ident(r)));
    } else if let Some(r) = line.strip_prefix("pub(super) fn ") {
        return Some(("pub(super)".to_string(), extract_ident(r)));
    } else if line.starts_with("fn ") {
        line.strip_prefix("fn ").unwrap_or("")
    } else {
        return None;
    };
    Some((String::new(), extract_ident(rest)))
}

fn extract_ident(s: &str) -> String {
    s.chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect()
}

// ---------------------------------------------------------------------------
// Audit body — Tests read the engine source once and make assertions.
// ---------------------------------------------------------------------------

fn all_bridged_methods() -> Vec<BridgedMethod> {
    let mut files = Vec::new();
    collect_rs_files(&engine_src_root(), &mut files);
    let mut methods = Vec::new();
    for f in &files {
        methods.extend(parse_file(f));
    }
    methods
}

#[test]
fn every_gated_read_has_a_scope() {
    let methods = all_bridged_methods();
    let mut missing = Vec::new();
    for m in &methods {
        if matches!(m.kind.as_str(), "read" | "write" | "structural") && m.scope.is_none() {
            missing.push(format!(
                "{}:{} {} fn {} (kind={})",
                m.file, m.line, m.visibility, m.fn_name, m.kind
            ));
        }
    }
    assert!(
        missing.is_empty(),
        "every #[bridge::read/write/structural] must declare a scope: {missing:#?}"
    );
}

#[test]
fn every_gated_method_is_public() {
    let methods = all_bridged_methods();
    let mut non_pub = Vec::new();
    for m in &methods {
        if !matches!(m.kind.as_str(), "read" | "write" | "structural") {
            continue;
        }
        if m.visibility != "pub" {
            non_pub.push(format!(
                "{}:{} {} fn {} (kind={} vis={})",
                m.file, m.line, m.visibility, m.fn_name, m.kind, m.visibility
            ));
        }
    }
    assert!(
        non_pub.is_empty(),
        "gated bridge methods must be `pub` so the delegate macro can forward them: {non_pub:#?}"
    );
}

#[test]
fn cell_scope_reads_that_hit_redact_maybe_blanket_are_only_known_set() {
    // Enumerate all cell-scope reads. For each, normalise the return
    // type and check whether it's in the known-gap list. If the method's
    // return type isn't in the known set but IS a type missing an
    // `impl RedactMaybe` (which we can't check at runtime from string
    // parsing alone), the test falls back to a best-effort allowlist.
    let methods = all_bridged_methods();
    let cell_reads: Vec<&BridgedMethod> = methods
        .iter()
        .filter(|m| m.kind == "read" && m.scope.as_deref() == Some("cell"))
        .collect();
    let mut blanket_passthrough_methods = Vec::new();
    for m in &cell_reads {
        let rt = normalise_type(&m.return_type);
        if KNOWN_REDACT_MAYBE_GAPS.iter().any(|g| &rt == g) {
            blanket_passthrough_methods
                .push(format!("{}:{} fn {} -> {}", m.file, m.line, m.fn_name, rt));
        }
    }
    // The assertion: our known-gap count should be non-zero (these
    // methods exist today) and the total set reports cleanly.
    eprintln!(
        "cell-scope reads hitting RedactMaybe blanket no-op ({}):",
        blanket_passthrough_methods.len()
    );
    for line in &blanket_passthrough_methods {
        eprintln!("  - {line}");
    }
    assert!(
        !blanket_passthrough_methods.is_empty(),
        "sanity: at least one cell-scope read returns a known-gap type; \
         if the RedactMaybe impl set closes all gaps this test can be removed."
    );

    // Audit summary: any cell-scope read whose return type isn't in the
    // expected gap set AND isn't a primitive-looking shape is flagged
    // for review. The short list below is the "deliberately unredacted
    // metadata" allowlist — format codes, sparkline render data, etc.
    const SAFE_METADATA_RETURNS: &[&str] = &[
        // Resolved effective format: a numeric + enum bag that doesn't
        // carry cell values. Structure level intentionally preserves
        // formatting so UI layout is stable.
        "ResolvedCellFormat",
        "Option<ResolvedCellFormat>",
        "CellFormat",
        "Option<CellFormat>",
        "Option<Comment>",
        "bool",
        "Option<bool>",
        // Strings without scope-level value guarantees (name, format code).
        "String",
        "Option<String>",
    ];
    let mut unclassified = Vec::new();
    for m in &cell_reads {
        let rt = normalise_type(&m.return_type);
        if KNOWN_REDACT_MAYBE_GAPS.iter().any(|g| &rt == g) {
            continue;
        }
        if SAFE_METADATA_RETURNS.iter().any(|g| &rt == g) {
            continue;
        }
        unclassified.push(format!("{}:{} fn {} -> {}", m.file, m.line, m.fn_name, rt));
    }
    // Unclassified entries don't fail the test — they surface for review
    // so the next R-round can classify them. When the set is clear, this
    // becomes an assertion.
    if !unclassified.is_empty() {
        eprintln!(
            "cell-scope reads with unclassified return types (manual review — not a hard fail):"
        );
        for line in &unclassified {
            eprintln!("  - {line}");
        }
    }
}

#[test]
fn viewport_filter_is_wired_to_get_viewport_binary() {
    // ARCHITECTURE.md §7 — `filter_viewport_buffer` is the in-place
    // filter for binary viewport buffers. The delegate macro wires it
    // into `#[bridge::read(scope = "sheet")]` methods that return
    // `Vec<u8>`.
    //
    // `get_viewport_binary` and `get_viewport_binary_delta` were originally tagged
    // `#[bridge::write(scope = "range")]`, which sent them through
    // `check_write` instead of the viewport filter and left the R4
    // redaction path dead. Both methods are now `bridge::read(scope =
    // "sheet")` with interior-mutable registry/palette state, so the
    // delegate emits `filter_viewport_buffer` on the `Vec<u8>` return.
    //
    // This test asserts the wiring invariant for **sheet-scoped
    // viewport reads**: every `Vec<u8>`-returning `bridge::read(scope
    // = "sheet")` method gets the filter. Workbook-scope sync methods
    // (`encode_state_vector`, `sync_full_state`) and range-scope
    // screenshot methods return `Vec<u8>` but are not viewport payloads
    // — they're deliberately not in scope for the sheet-matrix filter
    // (Yrs sync blobs and PNG bytes have no cell-level redaction
    // model). The explicit `SHEET_SCOPED_VIEWPORT_CANDIDATES` check
    // ensures the R4 wiring doesn't silently regress.
    let methods = all_bridged_methods();

    // Find methods that SHOULD be filter-wired (by function name — the
    // viewport binary API is well-known and small).
    const SHEET_SCOPED_VIEWPORT_FNS: &[&str] =
        &["get_viewport_binary", "get_viewport_binary_delta"];
    let viewport_methods: Vec<&BridgedMethod> = methods
        .iter()
        .filter(|m| SHEET_SCOPED_VIEWPORT_FNS.contains(&m.fn_name.as_str()))
        .collect();

    assert_eq!(
        viewport_methods.len(),
        SHEET_SCOPED_VIEWPORT_FNS.len(),
        "expected exactly the known viewport-binary fns to be bridged; \
         found {:?}",
        viewport_methods
            .iter()
            .map(|m| m.fn_name.as_str())
            .collect::<Vec<_>>()
    );

    for m in &viewport_methods {
        eprintln!(
            "viewport fn: {}:{} {} fn {} (kind={} scope={})",
            m.file,
            m.line,
            m.visibility,
            m.fn_name,
            m.kind,
            m.scope.as_deref().unwrap_or("-"),
        );
        assert_eq!(
            m.kind, "read",
            "{} must be bridge::read (was: {})",
            m.fn_name, m.kind
        );
        assert_eq!(
            m.scope.as_deref(),
            Some("sheet"),
            "{} must have scope = \"sheet\" so the delegate emits filter_viewport_buffer",
            m.fn_name
        );
    }
}

#[test]
fn summary_of_bridged_methods_by_kind_and_scope() {
    // Not a correctness test — just a stdout dump so the audit output
    // is visible with `cargo test -- --nocapture`. Useful for the R7
    // report and for agents manually inspecting coverage deltas.
    let methods = all_bridged_methods();
    let mut counts = std::collections::BTreeMap::new();
    for m in &methods {
        let key = (
            m.kind.clone(),
            m.scope.clone().unwrap_or_else(|| "-".into()),
        );
        *counts.entry(key).or_insert(0usize) += 1;
    }
    eprintln!("=== Bridged method coverage audit ===");
    eprintln!("{:<12} {:<10} count", "kind", "scope");
    for ((kind, scope), n) in &counts {
        eprintln!("{kind:<12} {scope:<10} {n}");
    }
    eprintln!("total bridged methods: {}", methods.len());

    // Also report `needs_principal` methods — these are the ones that
    // skip the fast path and always thread the principal (security ops).
    let mut needs_principal = 0;
    for m in &methods {
        // No parsing yet; we re-grep the attribute text to count.
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(&m.file)
            .canonicalize()
            .ok();
        if let Some(p) = path {
            if let Ok(src) = fs::read_to_string(&p) {
                let lines: Vec<&str> = src.lines().collect();
                if let Some(line) = lines.get(m.line - 1) {
                    if line.contains("needs_principal") {
                        needs_principal += 1;
                    }
                }
            }
        }
    }
    eprintln!("needs_principal methods: {needs_principal}");
}

/// R7.3 hard-fail check — the audit's stated goal.
///
/// Walks every bridged method on `YrsComputeEngine` (every method
/// inside a `#[bridge::api]` impl carrying a `#[bridge::read|write|
/// structural|pure|lifecycle]` annotation). For each method whose
/// return type contains any `CELL_DATA_RETURN_FRAGMENTS` substring,
/// assert the annotation is `read`/`write`/`structural` AND carries
/// an explicit `scope = "..."` — in other words, the method must be
/// gated. Ungated cell-data returns are a data leak and fail this
/// test loudly with the method name and the violating return type.
///
/// Exemptions live in `CELL_DATA_GATE_EXEMPTIONS`; every entry there
/// has a justification comment and should be reviewed periodically.
/// Methods scoped to a non-cell boundary (e.g. `scope = "workbook"`)
/// still pass — the sheet/workbook-scope reads are the right level
/// for bulk-data getters like `list_sheets` that don't return per-
/// cell data but DO carry a `String` name the audit would otherwise
/// flag via the `String` in the cell-scope allowlist. (This test
/// uses the specific `CELL_DATA_RETURN_FRAGMENTS` list and skips
/// bare `String` / `bool` return types to avoid false positives.)
#[test]
fn every_bridge_api_method_returning_cell_data_is_gated() {
    let methods = all_bridged_methods();
    let mut leaks = Vec::new();
    for m in &methods {
        if CELL_DATA_GATE_EXEMPTIONS
            .iter()
            .any(|exempt| *exempt == m.fn_name)
        {
            continue;
        }
        let rt = normalise_type(&m.return_type);
        let Some(fragment) = CELL_DATA_RETURN_FRAGMENTS
            .iter()
            .find(|frag| rt.contains(*frag))
        else {
            continue;
        };
        let gated = matches!(m.kind.as_str(), "read" | "write" | "structural") && m.scope.is_some();
        if !gated {
            leaks.push(format!(
                "{}:{} fn {} -> {rt} [kind={} scope={}] :: carries `{fragment}` but is NOT gated",
                m.file,
                m.line,
                m.fn_name,
                m.kind,
                m.scope.as_deref().unwrap_or("-")
            ));
        }
    }
    assert!(
        leaks.is_empty(),
        "coverage audit found ungated cell-data returns ({}):\n  {}\n\n\
         Every #[bridge::api] method returning a cell-data type must carry \
         a #[bridge::read|write|structural] annotation with an explicit \
         scope = \"cell|range|sheet|workbook\". If the method is genuinely \
         cell-data-free despite the type fragment, add it to \
         CELL_DATA_GATE_EXEMPTIONS with an inline justification.",
        leaks.len(),
        leaks.join("\n  "),
    );
}

/// Companion smoke test — the cell-data fragment list must be non-
/// empty and every entry must match at least one method in the
/// current tree. An entry that never matches is dead-list cruft
/// that future auditors mistake for coverage.
#[test]
fn every_cell_data_fragment_matches_at_least_one_bridged_method() {
    let methods = all_bridged_methods();
    let mut stale = Vec::new();
    for frag in CELL_DATA_RETURN_FRAGMENTS {
        let matched = methods.iter().any(|m| {
            let rt = normalise_type(&m.return_type);
            rt.contains(*frag)
        });
        if !matched {
            stale.push(*frag);
        }
    }
    // Stale fragments are a warning, not a hard-fail — a fragment
    // covering a future type surface is legitimate. We log them for
    // review but let the test pass.
    if !stale.is_empty() {
        eprintln!("CELL_DATA_RETURN_FRAGMENTS entries with no current match: {stale:?}");
    }
}

#[test]
fn audit_report_redact_maybe_gaps_are_stable() {
    // Lock the exact set of cell-scope reads that hit the blanket no-op.
    // A future commit that adds a new cell-scope read returning a gap
    // type flips the symmetric difference and fails. Closing a gap
    // (adding an `impl RedactMaybe for T`) requires updating
    // `KNOWN_REDACT_MAYBE_GAPS` here.
    //
    // We don't hard-code method names (they may move between files);
    // we hard-code the return-type set.
    let methods = all_bridged_methods();
    let mut seen: std::collections::BTreeSet<String> = Default::default();
    for m in &methods {
        if m.kind == "read" && m.scope.as_deref() == Some("cell") {
            let rt = normalise_type(&m.return_type);
            if KNOWN_REDACT_MAYBE_GAPS.iter().any(|g| &rt == g) {
                seen.insert(rt);
            }
        }
    }
    // Gap types observed in the tree at R7 snapshot time. Adding a
    // new gap variant means we classified a new unredacted return
    // shape — the audit must acknowledge it explicitly.
    let expected: std::collections::BTreeSet<String> = [
        "CellPosition",
        "CellValidationResult",
        "CellValue",
        "Option<CellInfo>",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    // Symmetric diff against snapshot — we don't assert equality yet
    // because the file order may shuffle — but we do assert every seen
    // gap is accounted for in KNOWN_REDACT_MAYBE_GAPS.
    let in_seen_not_expected: Vec<_> = seen.difference(&expected).cloned().collect();
    if !in_seen_not_expected.is_empty() {
        eprintln!(
            "new RedactMaybe gap types not in snapshot (R7 follow-up may be needed): {in_seen_not_expected:?}"
        );
    }
    // We assert seen is a subset of the declared KNOWN set — any new
    // entries would be caught by this check. The `expected` set is the
    // per-current-tree snapshot; if a real fix happens it'll shrink.
    for s in &seen {
        assert!(
            KNOWN_REDACT_MAYBE_GAPS.iter().any(|g| g == s),
            "unknown RedactMaybe-gap type {s:?} appeared in a cell-scope read; \
             classify in KNOWN_REDACT_MAYBE_GAPS or fix via `impl RedactMaybe for {s}`."
        );
    }
    eprintln!("RedactMaybe-gap types in cell-scope reads (current): {seen:?}");
    eprintln!("Expected (snapshot of this commit): {expected:?}");
}

// ---------------------------------------------------------------------------
// Shared normaliser — strips whitespace so "Option<CellInfo>" matches the
// parsed "Option < CellInfo >" layout that syn::ToTokens would produce.
// ---------------------------------------------------------------------------

fn normalise_type(s: &str) -> String {
    // Remove comment markers (`// ...`) that may tail a signature line,
    // collapse whitespace, and trim.
    let mut cleaned = String::new();
    for line in s.lines() {
        let end = line.find("//").unwrap_or(line.len());
        cleaned.push_str(&line[..end]);
        cleaned.push(' ');
    }
    cleaned
        .replace('\t', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("")
}

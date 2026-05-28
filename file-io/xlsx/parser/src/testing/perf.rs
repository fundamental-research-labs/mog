//! Production-path XLSX performance gate harness.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use domain_types::{CellData, ParseOutput, SheetData};
use serde::Deserialize;
use value_types::CellValue;
use xlsx_test_contracts::{
    BudgetResult, FailureFingerprint, FingerprintCategory, FingerprintEvidence, FingerprintOwner,
    FingerprintSeverity, GateName, GateReport, GateReportDomain, GateScenario, GateStatus,
    MetricValue, PackageFacts, PerformanceFingerprintCategory, SharedStringFacts,
    SheetDrawingFacts, SheetFacts, StyleFacts, UsedRangeFacts, WorkbookFacts, WorkbookSummaryFacts,
};

use crate::output::results::{FullParseResult, ParseTimings};
use crate::output::to_parse_output::full_parse_result_to_parse_output;
use crate::pipeline::full_parse::parse_xlsx_full_native;
use crate::testing::validate_package_graph_bytes;
use crate::write::from_parse_output::write_xlsx_from_parse_output;
use crate::zip::XlsxArchive;

const IMPORT_BUDGET_METRIC: &str = "import_ms";
const EXPORT_BUDGET_METRIC: &str = "export_ms";
const PEAK_RSS_BUDGET_METRIC: &str = "peak_rss_mb";
const OUTPUT_SIZE_RATIO_BUDGET_METRIC: &str = "output_size_ratio";

#[derive(Debug, Clone)]
pub struct PerfGateOptions {
    pub gate: GateName,
    pub inputs: Vec<PathBuf>,
    pub manifest_path: Option<PathBuf>,
    pub budget_path: Option<PathBuf>,
    pub baseline_path: Option<PathBuf>,
}

#[derive(Debug, Clone)]
struct PerfFixture {
    id: String,
    source: PerfSource,
    declared_classes: Vec<String>,
    expected_shape: Option<ExpectedShape>,
}

#[derive(Debug, Clone)]
enum PerfSource {
    File(PathBuf),
    Generated(GeneratedScaleFixture),
}

#[derive(Debug, Clone)]
struct GeneratedScaleFixture {
    sheets: u32,
    rows: u32,
    cols: u32,
    shared_string_cardinality: u32,
    formula_every: Option<u32>,
    style_count: u32,
}

#[derive(Debug, Clone)]
struct ExpectedShape {
    sheets: u32,
    rows_per_sheet: u32,
    cols_per_sheet: u32,
    total_cells: u64,
}

#[derive(Debug)]
struct PerfScenarioResult {
    id: String,
    status: GateStatus,
    message: Option<String>,
    duration_ms: u64,
    facts: Option<WorkbookFacts>,
    metrics: BTreeMap<String, MetricValue>,
    fingerprints: Vec<FailureFingerprint>,
    budget_results: Vec<BudgetResult>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
struct PerfBudgetFile {
    #[serde(default)]
    budgets: Vec<PerfBudget>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct PerfBudget {
    id: Option<String>,
    #[serde(default)]
    classes: Vec<String>,
    budgets: BTreeMap<String, f64>,
    reason: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
struct PerfManifestFile {
    #[serde(default)]
    fixtures: Vec<PerfManifestEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct PerfManifestEntry {
    id: Option<String>,
    path: PathBuf,
    #[serde(default)]
    tiers: Vec<String>,
    #[serde(default)]
    classes: Vec<String>,
}

#[derive(Debug)]
struct BaselineRegression {
    metric: String,
    previous: f64,
    current: f64,
    delta: f64,
    delta_percent: f64,
    fingerprint: FailureFingerprint,
}

pub fn run_perf_gate(options: PerfGateOptions) -> (GateReport, i32) {
    let started = Instant::now();
    let budgets = load_budget_file(options.budget_path.as_deref());
    let baseline = load_baseline(options.baseline_path.as_deref());
    let manifest_path = options
        .manifest_path
        .or_else(|| std::env::var_os("MOG_XLSX_PERF_MANIFEST").map(PathBuf::from));
    let mut inputs = options.inputs;
    if let Some(env_inputs) = std::env::var_os("MOG_XLSX_PERF_INPUTS") {
        inputs.extend(std::env::split_paths(&env_inputs));
    }
    let fixtures = discover_perf_fixtures(options.gate, &inputs, manifest_path.as_deref());

    if fixtures.is_empty() {
        let mut scenario = GateScenario::new(options.gate.as_str(), GateStatus::Blocked);
        scenario.release_blocking = false;
        scenario.message = Some("no XLSX files or generated scale fixtures selected".to_string());
        let report = GateReport::from_scenarios(options.gate, vec![scenario], 0);
        return (report, 2);
    }

    let mut scenario_results = Vec::with_capacity(fixtures.len());
    for fixture in fixtures {
        scenario_results.push(run_perf_fixture(&fixture, &budgets, baseline.as_ref()));
    }

    let mut scenarios = Vec::with_capacity(scenario_results.len());
    let mut all_fingerprints = Vec::new();
    let mut all_budgets = Vec::new();
    let mut aggregate_metrics = BTreeMap::new();

    for result in scenario_results {
        let mut scenario = GateScenario::new(result.id, result.status);
        scenario.duration_ms = Some(result.duration_ms);
        scenario.message = result.message;
        scenario.facts = result.facts;
        scenario.metrics = result.metrics;
        scenario.fingerprints = result.fingerprints.clone();
        all_fingerprints.extend(result.fingerprints);
        all_budgets.extend(result.budget_results);
        scenarios.push(scenario);
    }

    aggregate_metrics.insert(
        "scenario_count".to_string(),
        MetricValue::Integer(scenarios.len() as i64),
    );
    aggregate_metrics.insert(
        "failed_budget_count".to_string(),
        MetricValue::Integer(
            all_budgets
                .iter()
                .filter(|budget| budget.status == GateStatus::Failed)
                .count() as i64,
        ),
    );

    let mut report = GateReport::from_scenarios(
        options.gate,
        scenarios,
        started.elapsed().as_millis() as u64,
    );
    let domain = report.domain.get_or_insert_with(GateReportDomain::default);
    domain.fingerprints = all_fingerprints;
    domain.budgets = all_budgets;
    domain.metrics = aggregate_metrics;
    report.normalize();

    let exit_code = if report.status() == GateStatus::Passed {
        0
    } else {
        1
    };
    (report, exit_code)
}

fn run_perf_fixture(
    fixture: &PerfFixture,
    budgets: &[PerfBudget],
    baseline: Option<&GateReport>,
) -> PerfScenarioResult {
    let started = Instant::now();
    let bytes = match load_fixture_bytes(fixture) {
        Ok(bytes) => bytes,
        Err(err) => {
            return blocked_result(&fixture.id, started, err);
        }
    };

    let input_size_bytes = bytes.len();
    let rss_before = current_rss_mb();
    let mut timings = ParseTimings::zero();

    let import_started = Instant::now();
    let parsed = match parse_xlsx_full_native(&bytes, Some(&mut timings)) {
        Ok(parsed) => parsed,
        Err(err) => {
            return failed_result(&fixture.id, started, format!("import failed: {err}"));
        }
    };
    let import_ms = import_started.elapsed().as_secs_f64() * 1000.0;

    let hydrate_started = Instant::now();
    let (output, _diagnostics) = full_parse_result_to_parse_output(&parsed);
    let hydrate_ms = hydrate_started.elapsed().as_secs_f64() * 1000.0;

    let export_started = Instant::now();
    let exported = match write_xlsx_from_parse_output(&output) {
        Ok(bytes) => bytes,
        Err(err) => {
            return failed_result(&fixture.id, started, format!("export failed: {err}"));
        }
    };
    let export_ms = export_started.elapsed().as_secs_f64() * 1000.0;

    let package_validation = validate_package_graph_bytes(&exported);
    let mut status = GateStatus::Passed;
    let mut message = None;
    let mut fingerprints = Vec::new();
    match package_validation {
        Ok(validation) if validation.valid => {}
        Ok(validation) => {
            status = GateStatus::Failed;
            message = Some("exported package graph validation failed".to_string());
            fingerprints.extend(validation.fingerprints);
        }
        Err(err) => {
            status = GateStatus::Failed;
            message = Some(format!("exported package could not be opened: {err}"));
        }
    }

    let rss_after = current_rss_mb();
    let peak_rss_mb = rss_after.or(rss_before).unwrap_or(0.0);
    let relationship_count = package_relationship_count(&exported);
    let facts = workbook_facts(&output, &parsed, &exported);
    let classes = merge_classes(classify_workbook(&facts), &fixture.declared_classes);
    let mut metrics = perf_metrics(
        &timings,
        &facts,
        relationship_count,
        input_size_bytes,
        exported.len(),
        import_ms,
        hydrate_ms,
        export_ms,
        peak_rss_mb,
        &classes,
    );
    if let Some(expected_shape) = &fixture.expected_shape {
        record_expected_shape_metrics(&mut metrics, expected_shape);
        let shape_fingerprints = validate_expected_shape(&fixture.id, expected_shape, &facts);
        if !shape_fingerprints.is_empty() {
            status = GateStatus::Failed;
            fingerprints.extend(shape_fingerprints);
        }
    }

    let budget_results = evaluate_budgets(&fixture.id, &classes, &metrics, budgets);
    if budget_results
        .iter()
        .any(|budget| budget.status == GateStatus::Failed)
    {
        status = GateStatus::Failed;
        fingerprints.extend(
            budget_results
                .iter()
                .filter(|budget| budget.status == GateStatus::Failed)
                .map(|budget| budget_fingerprint(&fixture.id, budget)),
        );
    }

    let baseline_regressions = evaluate_baseline(&fixture.id, &metrics, baseline);
    if !baseline_regressions.is_empty() {
        status = GateStatus::Failed;
        metrics.insert(
            "baseline_regression_count".to_string(),
            MetricValue::Integer(baseline_regressions.len() as i64),
        );
        for regression in baseline_regressions {
            metrics.insert(
                format!("baseline.{}.previous", regression.metric),
                MetricValue::Float(regression.previous),
            );
            metrics.insert(
                format!("baseline.{}.current", regression.metric),
                MetricValue::Float(regression.current),
            );
            metrics.insert(
                format!("baseline.{}.delta", regression.metric),
                MetricValue::Float(regression.delta),
            );
            metrics.insert(
                format!("baseline.{}.delta_percent", regression.metric),
                MetricValue::Float(regression.delta_percent),
            );
            fingerprints.push(regression.fingerprint);
        }
    }

    metrics.insert(
        "production_path".to_string(),
        MetricValue::Text("import-domain-export-package-validation".to_string()),
    );

    PerfScenarioResult {
        id: fixture.id.clone(),
        status,
        message,
        duration_ms: started.elapsed().as_millis() as u64,
        facts: Some(facts),
        metrics,
        fingerprints,
        budget_results,
    }
}

fn discover_perf_fixtures(
    gate: GateName,
    inputs: &[PathBuf],
    manifest_path: Option<&Path>,
) -> Vec<PerfFixture> {
    let mut fixtures = Vec::new();
    if let Some(manifest_path) = manifest_path {
        collect_manifest_fixtures(gate, manifest_path, &mut fixtures);
    }
    for input in inputs {
        collect_input_fixtures(input, &mut fixtures);
    }
    if fixtures.is_empty() {
        fixtures.extend(
            generated_fixtures(gate)
                .into_iter()
                .map(|fixture| PerfFixture {
                    id: fixture.id(),
                    expected_shape: Some(fixture.expected_shape()),
                    source: PerfSource::Generated(fixture),
                    declared_classes: Vec::new(),
                }),
        );
    }
    fixtures.sort_by(|a, b| a.id.cmp(&b.id));
    fixtures
}

fn collect_input_fixtures(path: &Path, fixtures: &mut Vec<PerfFixture>) {
    if path.is_file() {
        if is_xlsx_path(path) {
            fixtures.push(PerfFixture {
                id: path
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_else(|| path.display().to_string()),
                source: PerfSource::File(path.to_path_buf()),
                declared_classes: Vec::new(),
                expected_shape: None,
            });
        }
        return;
    }

    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        let child = entry.path();
        if child.is_dir() {
            collect_input_fixtures(&child, fixtures);
        } else if is_xlsx_path(&child) {
            fixtures.push(PerfFixture {
                id: child
                    .strip_prefix(path)
                    .unwrap_or(&child)
                    .display()
                    .to_string(),
                source: PerfSource::File(child),
                declared_classes: Vec::new(),
                expected_shape: None,
            });
        }
    }
}

fn collect_manifest_fixtures(
    gate: GateName,
    manifest_path: &Path,
    fixtures: &mut Vec<PerfFixture>,
) {
    let Ok(bytes) = fs::read(manifest_path) else {
        return;
    };
    let Ok(manifest) = serde_json::from_slice::<PerfManifestFile>(&bytes) else {
        return;
    };
    let base_dir = manifest_path.parent().unwrap_or_else(|| Path::new("."));
    let gate_name = gate.as_str();
    let tier_name = gate.tier().as_str();
    for entry in manifest.fixtures {
        let tier_matches = entry.tiers.is_empty()
            || entry
                .tiers
                .iter()
                .any(|tier| tier == gate_name || tier == tier_name);
        if !tier_matches {
            continue;
        }
        let path = if entry.path.is_absolute() {
            entry.path
        } else {
            base_dir.join(entry.path)
        };
        if !is_xlsx_path(&path) {
            continue;
        }
        let id = entry.id.unwrap_or_else(|| {
            path.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()
        });
        fixtures.push(PerfFixture {
            id,
            source: PerfSource::File(path),
            declared_classes: entry.classes,
            expected_shape: None,
        });
    }
}

fn is_xlsx_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("xlsx"))
        && !path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("~$"))
}

fn generated_fixtures(gate: GateName) -> Vec<GeneratedScaleFixture> {
    let mut fixtures = vec![
        GeneratedScaleFixture {
            sheets: 1,
            rows: 100,
            cols: 10,
            shared_string_cardinality: 25,
            formula_every: Some(11),
            style_count: 10,
        },
        GeneratedScaleFixture {
            sheets: 4,
            rows: 250,
            cols: 25,
            shared_string_cardinality: 50,
            formula_every: Some(7),
            style_count: 100,
        },
    ];
    if matches!(gate, GateName::PerfGolden | GateName::PerfFull) {
        fixtures.push(GeneratedScaleFixture {
            sheets: 20,
            rows: 500,
            cols: 50,
            shared_string_cardinality: 100,
            formula_every: Some(5),
            style_count: 1_000,
        });
    }
    if matches!(gate, GateName::PerfFull) {
        fixtures.push(GeneratedScaleFixture {
            sheets: 50,
            rows: 1_000,
            cols: 100,
            shared_string_cardinality: 1_000,
            formula_every: Some(3),
            style_count: 5_000,
        });
    }
    fixtures
}

impl GeneratedScaleFixture {
    fn id(&self) -> String {
        format!(
            "generated-scale-s{}-r{}-c{}-styles{}-sst{}",
            self.sheets, self.rows, self.cols, self.style_count, self.shared_string_cardinality
        )
    }

    fn expected_shape(&self) -> ExpectedShape {
        ExpectedShape {
            sheets: self.sheets,
            rows_per_sheet: self.rows,
            cols_per_sheet: self.cols,
            total_cells: u64::from(self.sheets) * u64::from(self.rows) * u64::from(self.cols),
        }
    }
}

fn load_fixture_bytes(fixture: &PerfFixture) -> Result<Vec<u8>, String> {
    match &fixture.source {
        PerfSource::File(path) => fs::read(path).map_err(|err| format!("read failed: {err}")),
        PerfSource::Generated(scale) => {
            let output = generated_parse_output(scale);
            write_xlsx_from_parse_output(&output)
                .map_err(|err| format!("generated fixture write failed: {err}"))
        }
    }
}

fn generated_parse_output(scale: &GeneratedScaleFixture) -> ParseOutput {
    let mut output = ParseOutput::default();
    output.sheets = (0..scale.sheets)
        .map(|sheet_index| generated_sheet(scale, sheet_index))
        .collect();
    output
}

fn generated_sheet(scale: &GeneratedScaleFixture, sheet_index: u32) -> SheetData {
    let mut sheet = SheetData {
        name: format!("Scale{}", sheet_index + 1),
        rows: scale.rows,
        cols: scale.cols,
        sheet_id: Some(sheet_index + 1),
        ..SheetData::default()
    };

    let mut cells = Vec::with_capacity((scale.rows as usize).saturating_mul(scale.cols as usize));
    for row in 0..scale.rows {
        for col in 0..scale.cols {
            let ordinal = row * scale.cols + col;
            let formula = scale
                .formula_every
                .filter(|every| ordinal % *every == 0 && row > 0)
                .map(|_| format!("A{}+{}", row, col + 1));
            let value = if formula.is_some() {
                CellValue::from((row + col + 1) as f64)
            } else if col % 3 == 0 {
                let idx = ordinal % scale.shared_string_cardinality.max(1);
                CellValue::from(format!("shared-string-{idx}"))
            } else {
                CellValue::from((row + col + sheet_index) as f64)
            };
            cells.push(CellData {
                row,
                col,
                value,
                formula,
                style_id: None,
                ..CellData::default()
            });
        }
    }
    sheet.cells = cells;
    sheet
}

fn workbook_facts(
    output: &ParseOutput,
    parsed: &FullParseResult,
    exported: &[u8],
) -> WorkbookFacts {
    let mut facts = WorkbookFacts::new();
    facts.workbook = WorkbookSummaryFacts {
        sheet_count: output.sheets.len() as u32,
        total_cell_count: output
            .sheets
            .iter()
            .map(|sheet| sheet.cells.len() as u64)
            .sum(),
        defined_name_count: output.named_ranges.len() as u32,
        has_workbook_protection: output.protection.is_some(),
        has_core_properties: output.properties.is_some(),
        has_app_properties: output.extended_properties.is_some(),
        has_custom_properties: false,
        has_theme: output.theme.is_some(),
    };
    facts.sheets = output
        .sheets
        .iter()
        .enumerate()
        .map(|(idx, sheet)| sheet_facts(idx, sheet))
        .collect();
    facts.drawings = output
        .sheets
        .iter()
        .enumerate()
        .filter_map(|(idx, sheet)| {
            let drawing = parsed.sheets.get(idx)?.parsed_drawing.as_ref()?;
            Some(SheetDrawingFacts {
                sheet_index: idx as u32,
                sheet_name: sheet.name.clone(),
                drawing: crate::domain::drawings::facts::drawing_facts(drawing),
            })
        })
        .collect();
    facts.styles = StyleFacts {
        number_format_count: 0,
        cell_format_count: parsed.styles.cell_xfs.len() as u32,
        cell_style_count: parsed.styles.cell_styles.len() as u32,
    };
    facts.shared_strings = SharedStringFacts {
        count: parsed.shared_strings.len() as u32,
        rich_text_count: parsed
            .shared_strings_rich_runs
            .iter()
            .filter(|runs| runs.is_some())
            .count() as u32,
    };
    facts.formulas.total_formula_cells = output
        .sheets
        .iter()
        .flat_map(|sheet| sheet.cells.iter())
        .filter(|cell| cell.formula.is_some())
        .count() as u32;
    facts.formulas.array_formula_cells = output
        .sheets
        .iter()
        .flat_map(|sheet| sheet.cells.iter())
        .filter(|cell| cell.array_ref.is_some())
        .count() as u32;
    facts.package = package_facts(exported, output.calculation.calc_id.is_some());
    facts.normalized()
}

fn sheet_facts(index: usize, sheet: &SheetData) -> SheetFacts {
    let used_range = used_range(sheet);
    SheetFacts {
        index: index as u32,
        name: sheet.name.clone(),
        visible_state: format!("{:?}", sheet.visibility),
        cell_count: sheet.cells.len() as u64,
        non_empty_cell_count: sheet
            .cells
            .iter()
            .filter(|cell| !matches!(cell.value, CellValue::Null))
            .count() as u64,
        formula_cell_count: sheet
            .cells
            .iter()
            .filter(|cell| cell.formula.is_some())
            .count() as u32,
        number_cell_count: sheet
            .cells
            .iter()
            .filter(|cell| matches!(cell.value, CellValue::Number(_)))
            .count() as u32,
        string_cell_count: sheet
            .cells
            .iter()
            .filter(|cell| matches!(cell.value, CellValue::Text(_)))
            .count() as u32,
        bool_cell_count: sheet
            .cells
            .iter()
            .filter(|cell| matches!(cell.value, CellValue::Boolean(_)))
            .count() as u32,
        error_cell_count: sheet
            .cells
            .iter()
            .filter(|cell| matches!(cell.value, CellValue::Error(_, _)))
            .count() as u32,
        merge_count: sheet.merges.len() as u32,
        table_count: sheet.tables.len() as u32,
        chart_count: sheet.charts.len() as u32,
        comment_count: sheet.comments.len() as u32,
        hyperlink_count: sheet.hyperlinks.len() as u32,
        data_validation_count: sheet.data_validations.len() as u32,
        conditional_format_count: sheet.conditional_formats.len() as u32,
        sparkline_group_count: sheet.sparkline_groups.len() as u32,
        slicer_count: sheet.slicers.len() as u32,
        form_control_count: sheet
            .floating_objects
            .iter()
            .filter(|object| matches!(object.kind(), domain_types::FloatingObjectKind::FormControl))
            .count() as u32,
        ole_object_count: sheet
            .floating_objects
            .iter()
            .filter(|object| matches!(object.kind(), domain_types::FloatingObjectKind::OleObject))
            .count() as u32,
        used_range,
    }
}

fn used_range(sheet: &SheetData) -> Option<UsedRangeFacts> {
    let mut min_row = u32::MAX;
    let mut min_col = u32::MAX;
    let mut max_row = 0;
    let mut max_col = 0;
    for cell in &sheet.cells {
        min_row = min_row.min(cell.row);
        min_col = min_col.min(cell.col);
        max_row = max_row.max(cell.row);
        max_col = max_col.max(cell.col);
    }
    if min_row == u32::MAX {
        None
    } else {
        Some(UsedRangeFacts {
            min_row,
            min_col,
            max_row,
            max_col,
        })
    }
}

fn package_facts(exported: &[u8], has_calc_pr: bool) -> PackageFacts {
    match XlsxArchive::new(exported) {
        Ok(archive) => {
            let part_count = archive
                .entries()
                .iter()
                .filter(|entry| !entry.name.ends_with(".rels"))
                .count() as u32;
            let relationship_part_count = archive
                .entries()
                .iter()
                .filter(|entry| entry.name.ends_with(".rels"))
                .count() as u32;
            PackageFacts {
                has_calc_pr,
                part_count: Some(part_count),
                relationship_part_count: Some(relationship_part_count),
            }
        }
        Err(_) => PackageFacts {
            has_calc_pr,
            part_count: None,
            relationship_part_count: None,
        },
    }
}

fn package_relationship_count(exported: &[u8]) -> u32 {
    let Ok(archive) = XlsxArchive::new(exported) else {
        return 0;
    };
    archive
        .entries()
        .iter()
        .filter(|entry| entry.name.ends_with(".rels"))
        .filter_map(|entry| archive.read_file(&entry.name).ok())
        .map(|rels_xml| count_xml_start_tags(&rels_xml, b"Relationship"))
        .sum()
}

fn count_xml_start_tags(xml: &[u8], local_name: &[u8]) -> u32 {
    let mut count = 0;
    let mut offset = 0;
    while let Some(pos) = xml[offset..].iter().position(|byte| *byte == b'<') {
        let start = offset + pos + 1;
        if start < xml.len()
            && xml[start] != b'/'
            && xml[start] != b'?'
            && xml[start] != b'!'
            && xml[start..].starts_with(local_name)
        {
            let after_name = start + local_name.len();
            if after_name >= xml.len()
                || matches!(xml[after_name], b' ' | b'\t' | b'\n' | b'\r' | b'/' | b'>')
            {
                count += 1;
            }
        }
        offset = start;
    }
    count
}

fn classify_workbook(facts: &WorkbookFacts) -> Vec<String> {
    let mut classes = BTreeSet::new();
    let sheet_count = facts.workbook.sheet_count;
    let total_cells = facts.workbook.total_cell_count;
    let max_width = facts
        .sheets
        .iter()
        .filter_map(|sheet| sheet.used_range)
        .map(|range| range.max_col.saturating_sub(range.min_col) + 1)
        .max()
        .unwrap_or(0);
    let max_height = facts
        .sheets
        .iter()
        .filter_map(|sheet| sheet.used_range)
        .map(|range| range.max_row.saturating_sub(range.min_row) + 1)
        .max()
        .unwrap_or(0);

    if total_cells < 10_000 {
        classes.insert("small-normal");
    }
    if total_cells >= 100_000 {
        classes.insert("large-used-range");
    }
    if sheet_count >= 20 {
        classes.insert("many-sheets");
    }
    if max_width >= 100 {
        classes.insert("wide-sheet");
    }
    if max_height >= 10_000 {
        classes.insert("tall-sheet");
    }
    if facts.shared_strings.count > 0 {
        if facts.shared_strings.count < (total_cells / 2).max(1) as u32 {
            classes.insert("shared-strings-low-cardinality");
        } else {
            classes.insert("shared-strings-high-cardinality");
        }
    }
    if facts.styles.cell_format_count >= 1_000 {
        classes.insert("styles-heavy");
    }
    if facts.formulas.total_formula_cells >= 10_000 {
        classes.insert("formulas-heavy");
    }
    if facts
        .sheets
        .iter()
        .map(|sheet| sheet.comment_count)
        .sum::<u32>()
        >= 1_000
    {
        classes.insert("comments-vml-heavy");
    }
    if facts
        .sheets
        .iter()
        .map(|sheet| sheet.chart_count)
        .sum::<u32>()
        > 0
    {
        classes.insert("charts-heavy");
    }
    if facts
        .sheets
        .iter()
        .map(|sheet| sheet.table_count)
        .sum::<u32>()
        > 0
    {
        classes.insert("tables-heavy");
    }
    if facts.package.part_count.unwrap_or(0) >= 100 {
        classes.insert("metadata-heavy");
    }

    classes.into_iter().map(str::to_string).collect()
}

fn merge_classes(detected: Vec<String>, declared: &[String]) -> Vec<String> {
    let mut classes = BTreeSet::new();
    classes.extend(detected);
    classes.extend(declared.iter().cloned());
    classes.into_iter().collect()
}

fn record_expected_shape_metrics(
    metrics: &mut BTreeMap<String, MetricValue>,
    expected_shape: &ExpectedShape,
) {
    metrics.insert(
        "expected_shape.sheet_count".to_string(),
        MetricValue::Integer(expected_shape.sheets as i64),
    );
    metrics.insert(
        "expected_shape.rows_per_sheet".to_string(),
        MetricValue::Integer(expected_shape.rows_per_sheet as i64),
    );
    metrics.insert(
        "expected_shape.cols_per_sheet".to_string(),
        MetricValue::Integer(expected_shape.cols_per_sheet as i64),
    );
    metrics.insert(
        "expected_shape.total_cells".to_string(),
        MetricValue::Integer(expected_shape.total_cells as i64),
    );
}

fn validate_expected_shape(
    id: &str,
    expected_shape: &ExpectedShape,
    facts: &WorkbookFacts,
) -> Vec<FailureFingerprint> {
    let mut fingerprints = Vec::new();
    if facts.workbook.sheet_count != expected_shape.sheets {
        fingerprints.push(expected_shape_fingerprint(
            id,
            "sheet_count",
            expected_shape.sheets.to_string(),
            facts.workbook.sheet_count.to_string(),
        ));
    }
    if facts.workbook.total_cell_count != expected_shape.total_cells {
        fingerprints.push(expected_shape_fingerprint(
            id,
            "total_cells",
            expected_shape.total_cells.to_string(),
            facts.workbook.total_cell_count.to_string(),
        ));
    }
    for sheet in &facts.sheets {
        let Some(range) = sheet.used_range else {
            fingerprints.push(expected_shape_fingerprint(
                id,
                &format!("sheet.{}.used_range", sheet.index),
                format!(
                    "{}x{}",
                    expected_shape.rows_per_sheet, expected_shape.cols_per_sheet
                ),
                "none".to_string(),
            ));
            continue;
        };
        let rows = range.max_row.saturating_sub(range.min_row) + 1;
        let cols = range.max_col.saturating_sub(range.min_col) + 1;
        if rows != expected_shape.rows_per_sheet || cols != expected_shape.cols_per_sheet {
            fingerprints.push(expected_shape_fingerprint(
                id,
                &format!("sheet.{}.extent", sheet.index),
                format!(
                    "{}x{}",
                    expected_shape.rows_per_sheet, expected_shape.cols_per_sheet
                ),
                format!("{rows}x{cols}"),
            ));
        }
    }
    fingerprints
}

fn expected_shape_fingerprint(
    id: &str,
    field: &str,
    expected: String,
    actual: String,
) -> FailureFingerprint {
    FailureFingerprint::new(
        format!(
            "perf-generated-shape-{}-{}",
            sanitize_id(id),
            sanitize_id(field)
        ),
        FingerprintCategory::Performance(PerformanceFingerprintCategory::HarnessMeasurementBug),
        FingerprintSeverity::Error,
        FingerprintOwner::Performance,
        "generated perf fixture shape did not match declaration",
    )
    .with_evidence(
        FingerprintEvidence::message("generated fixture shape mismatch")
            .at_path(id)
            .field(field)
            .expected_actual(expected, actual),
    )
}

#[allow(clippy::too_many_arguments)]
fn perf_metrics(
    timings: &ParseTimings,
    facts: &WorkbookFacts,
    relationship_count: u32,
    input_size_bytes: usize,
    output_size_bytes: usize,
    import_ms: f64,
    hydrate_ms: f64,
    export_ms: f64,
    peak_rss_mb: f64,
    classes: &[String],
) -> BTreeMap<String, MetricValue> {
    let mut metrics = BTreeMap::new();
    insert_f64(&mut metrics, IMPORT_BUDGET_METRIC, import_ms);
    insert_f64(&mut metrics, "export_ms", export_ms);
    insert_f64(&mut metrics, "domain_hydration_ms", hydrate_ms);
    insert_f64(&mut metrics, "zip_read_ms", timings.zip_index_us() / 1000.0);
    insert_f64(
        &mut metrics,
        "shared_strings_xml_parse_ms",
        timings.shared_strings_us() / 1000.0,
    );
    insert_f64(
        &mut metrics,
        "styles_xml_parse_ms",
        timings.styles_us() / 1000.0,
    );
    insert_f64(
        &mut metrics,
        "metadata_xml_parse_ms",
        timings.metadata_us() / 1000.0,
    );
    insert_f64(
        &mut metrics,
        "worksheet_xml_parse_ms",
        timings.worksheet_parse_us() / 1000.0,
    );
    insert_f64(
        &mut metrics,
        "worksheet_zip_read_ms",
        timings.ws_zip_decompress_us() / 1000.0,
    );
    insert_f64(
        &mut metrics,
        "worksheet_cell_iteration_ms",
        timings.ws_cell_parse_us() / 1000.0,
    );
    insert_f64(
        &mut metrics,
        "worksheet_cell_convert_ms",
        timings.ws_cell_convert_us() / 1000.0,
    );
    insert_f64(&mut metrics, "serialization_ms", export_ms);
    insert_f64(&mut metrics, "peak_rss_mb", peak_rss_mb);
    metrics.insert(
        "input_size_bytes".to_string(),
        MetricValue::Integer(input_size_bytes as i64),
    );
    metrics.insert(
        "output_size_bytes".to_string(),
        MetricValue::Integer(output_size_bytes as i64),
    );
    insert_f64(
        &mut metrics,
        OUTPUT_SIZE_RATIO_BUDGET_METRIC,
        output_size_bytes as f64 / input_size_bytes.max(1) as f64,
    );
    metrics.insert(
        "part_count".to_string(),
        MetricValue::Integer(facts.package.part_count.unwrap_or(0) as i64),
    );
    metrics.insert(
        "relationship_part_count".to_string(),
        MetricValue::Integer(facts.package.relationship_part_count.unwrap_or(0) as i64),
    );
    metrics.insert(
        "relationship_count".to_string(),
        MetricValue::Integer(relationship_count as i64),
    );
    metrics.insert(
        "sheet_count".to_string(),
        MetricValue::Integer(facts.workbook.sheet_count as i64),
    );
    metrics.insert(
        "cell_count".to_string(),
        MetricValue::Integer(facts.workbook.total_cell_count as i64),
    );
    metrics.insert(
        "formula_count".to_string(),
        MetricValue::Integer(facts.formulas.total_formula_cells as i64),
    );
    metrics.insert(
        "style_count".to_string(),
        MetricValue::Integer(facts.styles.cell_format_count as i64),
    );
    metrics.insert(
        "shared_string_count".to_string(),
        MetricValue::Integer(facts.shared_strings.count as i64),
    );
    metrics.insert(
        "workbook_classes".to_string(),
        MetricValue::Text(classes.join(",")),
    );
    for class in classes {
        metrics.insert(format!("class.{class}"), MetricValue::Bool(true));
    }
    metrics
}

fn insert_f64(metrics: &mut BTreeMap<String, MetricValue>, key: &str, value: f64) {
    metrics.insert(key.to_string(), MetricValue::Float(value));
}

fn evaluate_budgets(
    id: &str,
    classes: &[String],
    metrics: &BTreeMap<String, MetricValue>,
    budgets: &[PerfBudget],
) -> Vec<BudgetResult> {
    let classes: BTreeSet<&str> = classes.iter().map(String::as_str).collect();
    let mut results = Vec::new();
    for budget in budgets {
        let id_matches = budget.id.as_deref().is_none_or(|budget_id| budget_id == id);
        let class_matches = budget.classes.is_empty()
            || budget
                .classes
                .iter()
                .any(|class| classes.contains(class.as_str()));
        if !id_matches || !class_matches {
            continue;
        }
        for (budget_name, limit) in &budget.budgets {
            let metric_name = normalize_budget_metric(budget_name);
            let actual = metric_as_f64(metrics.get(metric_name));
            let status = if actual.is_some_and(|actual| actual <= *limit) {
                GateStatus::Passed
            } else {
                GateStatus::Failed
            };
            results.push(BudgetResult {
                name: budget_name.clone(),
                status,
                actual: MetricValue::Float(actual.unwrap_or(f64::INFINITY)),
                limit: MetricValue::Float(*limit),
                reason: budget.reason.clone(),
            });
        }
    }
    results
}

fn normalize_budget_metric(name: &str) -> &str {
    match name {
        "import_ms_p95" => IMPORT_BUDGET_METRIC,
        "export_ms_p95" => EXPORT_BUDGET_METRIC,
        "peak_rss_mb" => PEAK_RSS_BUDGET_METRIC,
        "output_size_ratio_max" => OUTPUT_SIZE_RATIO_BUDGET_METRIC,
        other => other,
    }
}

fn evaluate_baseline(
    id: &str,
    metrics: &BTreeMap<String, MetricValue>,
    baseline: Option<&GateReport>,
) -> Vec<BaselineRegression> {
    let Some(baseline) = baseline else {
        return Vec::new();
    };
    let Some(previous) = baseline.scenarios.iter().find(|scenario| scenario.id == id) else {
        return Vec::new();
    };

    ["import_ms", "export_ms", "output_size_ratio"]
        .iter()
        .filter_map(|metric| {
            let current = metric_as_f64(metrics.get(*metric))?;
            let prior = metric_as_f64(previous.metrics.get(*metric))?;
            if prior > 0.0 && current > prior * 1.20 {
                let delta = current - prior;
                Some(BaselineRegression {
                    metric: (*metric).to_string(),
                    previous: prior,
                    current,
                    delta,
                    delta_percent: delta / prior * 100.0,
                    fingerprint: regression_fingerprint(id, metric, prior, current),
                })
            } else {
                None
            }
        })
        .collect()
}

fn budget_fingerprint(id: &str, budget: &BudgetResult) -> FailureFingerprint {
    FailureFingerprint::new(
        format!(
            "perf-budget-{}-{}",
            sanitize_id(id),
            sanitize_id(&budget.name)
        ),
        FingerprintCategory::Performance(classify_perf_metric(normalize_budget_metric(
            &budget.name,
        ))),
        FingerprintSeverity::Regression,
        FingerprintOwner::Performance,
        format!("performance budget failed for {}", budget.name),
    )
    .with_evidence(
        FingerprintEvidence::message("metric exceeded configured budget")
            .at_path(id)
            .field(&budget.name)
            .expected_actual(
                metric_to_string(&budget.limit),
                metric_to_string(&budget.actual),
            ),
    )
}

fn regression_fingerprint(
    id: &str,
    metric: &str,
    previous: f64,
    current: f64,
) -> FailureFingerprint {
    FailureFingerprint::new(
        format!(
            "perf-regression-{}-{}",
            sanitize_id(id),
            sanitize_id(metric)
        ),
        FingerprintCategory::Performance(classify_perf_metric(metric)),
        FingerprintSeverity::Regression,
        FingerprintOwner::Performance,
        format!("{metric} regressed against baseline"),
    )
    .with_evidence(
        FingerprintEvidence::message("current metric exceeds baseline by more than 20%")
            .at_path(id)
            .field(metric)
            .expected_actual(format!("{previous:.3}"), format!("{current:.3}")),
    )
}

fn classify_perf_metric(metric: &str) -> PerformanceFingerprintCategory {
    match metric {
        "import_ms" => PerformanceFingerprintCategory::DomainHydration,
        "export_ms" => PerformanceFingerprintCategory::ExportSerialization,
        "output_size_ratio" => PerformanceFingerprintCategory::OutputSizeGrowth,
        _ => PerformanceFingerprintCategory::HarnessMeasurementBug,
    }
}

fn load_budget_file(path: Option<&Path>) -> Vec<PerfBudget> {
    let Some(path) = path else {
        return Vec::new();
    };
    let Ok(bytes) = fs::read(path) else {
        return Vec::new();
    };
    serde_json::from_slice::<PerfBudgetFile>(&bytes)
        .map(|file| file.budgets)
        .unwrap_or_default()
}

fn load_baseline(path: Option<&Path>) -> Option<GateReport> {
    let path = path?;
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn metric_as_f64(value: Option<&MetricValue>) -> Option<f64> {
    match value? {
        MetricValue::Integer(value) => Some(*value as f64),
        MetricValue::Float(value) => Some(*value),
        MetricValue::Text(_) | MetricValue::Bool(_) => None,
    }
}

fn metric_to_string(value: &MetricValue) -> String {
    match value {
        MetricValue::Integer(value) => value.to_string(),
        MetricValue::Float(value) => format!("{value:.3}"),
        MetricValue::Text(value) => value.clone(),
        MetricValue::Bool(value) => value.to_string(),
    }
}

fn sanitize_id(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect()
}

fn failed_result(id: &str, started: Instant, message: String) -> PerfScenarioResult {
    PerfScenarioResult {
        id: id.to_string(),
        status: GateStatus::Failed,
        message: Some(message),
        duration_ms: started.elapsed().as_millis() as u64,
        facts: None,
        metrics: BTreeMap::new(),
        fingerprints: Vec::new(),
        budget_results: Vec::new(),
    }
}

fn blocked_result(id: &str, started: Instant, message: String) -> PerfScenarioResult {
    PerfScenarioResult {
        id: id.to_string(),
        status: GateStatus::Blocked,
        message: Some(message),
        duration_ms: started.elapsed().as_millis() as u64,
        facts: None,
        metrics: BTreeMap::new(),
        fingerprints: Vec::new(),
        budget_results: Vec::new(),
    }
}

fn current_rss_mb() -> Option<f64> {
    #[cfg(target_os = "linux")]
    {
        let statm = fs::read_to_string("/proc/self/statm").ok()?;
        let resident_pages: f64 = statm.split_whitespace().nth(1)?.parse().ok()?;
        Some(resident_pages * 4096.0 / 1024.0 / 1024.0)
    }
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("ps")
            .args(["-o", "rss=", "-p", &std::process::id().to_string()])
            .output()
            .ok()?;
        let rss_kb: f64 = String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse()
            .ok()?;
        Some(rss_kb / 1024.0)
    }
    #[cfg(not(target_os = "linux"))]
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

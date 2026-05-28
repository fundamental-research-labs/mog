//! Generated OOXML contract matrix fixtures and smoke gate.

use std::collections::BTreeMap;

use xlsx_test_contracts::{
    CorrectnessFingerprintCategory, FailureFingerprint, FingerprintCategory, FingerprintEvidence,
    FingerprintOwner, FingerprintSeverity, GateName, GateReport, GateReportDomain, GateScenario,
    GateStatus, MetricValue, PackageGraphValidationReport, WorkbookFacts,
};

use crate::domain::workbook::read::{parse_all_rels, parse_calc_settings};
use crate::infra::opc::{
    REL_COMMENTS, REL_DRAWING, REL_HYPERLINK, REL_METADATA, REL_PIVOT_TABLE, REL_PRINTER_SETTINGS,
    REL_TABLE, REL_VML_DRAWING, opc_target_to_zip_path,
};
use crate::write::{
    CT_COMMENTS, CT_DRAWING, CT_METADATA, CT_PIVOT_TABLE, CT_PRINTER_SETTINGS, CT_RELATIONSHIPS,
    CT_TABLE, CT_WORKBOOK, CT_WORKSHEET, CT_XML, ZipWriter, write_xlsx_from_parse_output,
};
use crate::zip::{XlsxArchive, ZipError};

use super::validate_package_graph_bytes;

const REL_NS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
const SS_NS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const R_NS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const ROOT_OFFICE_DOCUMENT_REL: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const VML_CONTENT_TYPE: &str = "application/vnd.openxmlformats-officedocument.vmlDrawing";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OoxmlPreservationMode {
    Modeled,
    Opaque,
    IntentionalDrop,
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OoxmlGateResponsibility {
    Parse,
    L1,
    L2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OoxmlFixtureFamily {
    OneAttribute,
    ExplicitDefaults,
    RelationshipEdge,
    NegativeNearMiss,
    MissingOptional,
    UnknownExtension,
    EmptySheet,
    LargeDeclaredDimension,
}

#[derive(Debug, Clone)]
pub struct OoxmlContractRow {
    pub id: &'static str,
    pub part_path_pattern: &'static str,
    pub owner_part: &'static str,
    pub relationship_type: Option<&'static str>,
    pub required_content_type: Option<&'static str>,
    pub element_path: &'static str,
    pub relationship_attributes: &'static [&'static str],
    pub explicit_default_rule: Option<&'static str>,
    pub target_resolution_rule: Option<&'static str>,
    pub parser_responsibility: OoxmlGateResponsibility,
    pub writer_responsibility: OoxmlGateResponsibility,
    pub l2_responsibility: OoxmlGateResponsibility,
    pub preservation_mode: OoxmlPreservationMode,
    pub fixture_families: &'static [OoxmlFixtureFamily],
    pub fingerprints: &'static [&'static str],
    pub fixture: OoxmlFixtureSpec,
}

#[derive(Debug, Clone, Copy)]
pub enum OoxmlFixtureSpec {
    CalcPrExplicitDefaults,
    WorksheetDrawing,
    WorksheetVmlDrawing,
    WorksheetComments,
    WorksheetHyperlink,
    WorksheetPrinterSettings,
    WorksheetTable,
    WorksheetPivotTable,
    WorkbookMetadata,
    WorksheetEmptyDimension,
    WorksheetLargeDimension,
    WorksheetExtLstSingleton,
    WorksheetDrawingNearMiss,
    CoreAndAppProperties,
}

#[derive(Debug, Clone)]
pub struct GeneratedOoxmlFixture {
    pub row_id: &'static str,
    pub bytes: Vec<u8>,
    pub expected: ExpectedFixtureFacts,
}

#[derive(Debug, Clone, Default)]
pub struct ExpectedFixtureFacts {
    pub package_entries: &'static [&'static str],
    pub relationships: &'static [ExpectedRelationship],
    pub content_types: &'static [ExpectedContentType],
    pub xml_facts: &'static [ExpectedXmlFact],
    pub modeled_facts: ExpectedModeledFacts,
    pub forbidden_xml_facts: &'static [ExpectedXmlFact],
}

#[derive(Debug, Clone, Copy)]
pub struct ExpectedRelationship {
    pub rels_path: &'static str,
    pub id: &'static str,
    pub rel_type: &'static str,
    pub target: &'static str,
    pub target_mode: Option<&'static str>,
    pub resolved_target: Option<&'static str>,
}

#[derive(Debug, Clone, Copy)]
pub struct ExpectedContentType {
    pub part_path: Option<&'static str>,
    pub extension: Option<&'static str>,
    pub content_type: &'static str,
}

#[derive(Debug, Clone, Copy)]
pub struct ExpectedXmlFact {
    pub part_path: &'static str,
    pub needle: &'static str,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ExpectedModeledFacts {
    pub has_calc_pr: bool,
    pub sheet_count: u32,
}

pub fn ooxml_contract_matrix() -> &'static [OoxmlContractRow] {
    &OOXML_CONTRACT_MATRIX
}

pub fn generate_ooxml_fixture(row: &OoxmlContractRow) -> GeneratedOoxmlFixture {
    match row.fixture {
        OoxmlFixtureSpec::CalcPrExplicitDefaults => fixture_calc_pr_explicit_defaults(row.id),
        OoxmlFixtureSpec::WorksheetDrawing => fixture_worksheet_relationship(
            row.id,
            WorksheetRelationshipFixture {
                rel_type: REL_DRAWING,
                rel_target: "../drawings/drawing1.xml",
                rel_id: "rId2",
                sheet_ref_xml: r#"<drawing r:id="rId2"/>"#,
                target_path: Some("xl/drawings/drawing1.xml"),
                target_xml: Some(
                    r#"<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"/>"#,
                ),
                target_content_type: Some(CT_DRAWING),
                target_default: None,
                resolved_target: Some("xl/drawings/drawing1.xml"),
                forbidden_xml: &[],
            },
        ),
        OoxmlFixtureSpec::WorksheetVmlDrawing => fixture_worksheet_relationship(
            row.id,
            WorksheetRelationshipFixture {
                rel_type: REL_VML_DRAWING,
                rel_target: "../drawings/vmlDrawing1.vml",
                rel_id: "rId2",
                sheet_ref_xml: r#"<legacyDrawing r:id="rId2"/>"#,
                target_path: Some("xl/drawings/vmlDrawing1.vml"),
                target_xml: Some(r#"<xml xmlns:v="urn:schemas-microsoft-com:vml"/>"#),
                target_content_type: None,
                target_default: Some(("vml", VML_CONTENT_TYPE)),
                resolved_target: Some("xl/drawings/vmlDrawing1.vml"),
                forbidden_xml: &[ExpectedXmlFact {
                    part_path: "xl/worksheets/sheet1.xml",
                    needle: r#"<drawing r:id="rId2"/>"#,
                }],
            },
        ),
        OoxmlFixtureSpec::WorksheetComments => fixture_worksheet_relationship(
            row.id,
            WorksheetRelationshipFixture {
                rel_type: REL_COMMENTS,
                rel_target: "../comments1.xml",
                rel_id: "rId2",
                sheet_ref_xml: "",
                target_path: Some("xl/comments1.xml"),
                target_xml: Some(
                    r#"<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>Mog</author></authors><commentList/></comments>"#,
                ),
                target_content_type: Some(CT_COMMENTS),
                target_default: None,
                resolved_target: Some("xl/comments1.xml"),
                forbidden_xml: &[],
            },
        ),
        OoxmlFixtureSpec::WorksheetHyperlink => fixture_worksheet_relationship(
            row.id,
            WorksheetRelationshipFixture {
                rel_type: REL_HYPERLINK,
                rel_target: "https://example.invalid/",
                rel_id: "rId2",
                sheet_ref_xml: r#"<hyperlinks><hyperlink ref="A1" r:id="rId2"/></hyperlinks>"#,
                target_path: None,
                target_xml: None,
                target_content_type: None,
                target_default: None,
                resolved_target: None,
                forbidden_xml: &[],
            },
        ),
        OoxmlFixtureSpec::WorksheetPrinterSettings => fixture_worksheet_relationship(
            row.id,
            WorksheetRelationshipFixture {
                rel_type: REL_PRINTER_SETTINGS,
                rel_target: "../printerSettings/printerSettings1.bin",
                rel_id: "rId2",
                sheet_ref_xml: r#"<pageSetup r:id="rId2"/>"#,
                target_path: Some("xl/printerSettings/printerSettings1.bin"),
                target_xml: Some("MOG_PRINTER_SETTINGS"),
                target_content_type: None,
                target_default: Some(("bin", CT_PRINTER_SETTINGS)),
                resolved_target: Some("xl/printerSettings/printerSettings1.bin"),
                forbidden_xml: &[],
            },
        ),
        OoxmlFixtureSpec::WorksheetTable => fixture_worksheet_relationship(
            row.id,
            WorksheetRelationshipFixture {
                rel_type: REL_TABLE,
                rel_target: "../tables/table1.xml",
                rel_id: "rId2",
                sheet_ref_xml: r#"<tableParts count="1"><tablePart r:id="rId2"/></tableParts>"#,
                target_path: Some("xl/tables/table1.xml"),
                target_xml: Some(
                    r#"<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="Table1" displayName="Table1" ref="A1:A1"><autoFilter ref="A1:A1"/><tableColumns count="1"><tableColumn id="1" name="A"/></tableColumns></table>"#,
                ),
                target_content_type: Some(CT_TABLE),
                target_default: None,
                resolved_target: Some("xl/tables/table1.xml"),
                forbidden_xml: &[],
            },
        ),
        OoxmlFixtureSpec::WorksheetPivotTable => fixture_worksheet_relationship(
            row.id,
            WorksheetRelationshipFixture {
                rel_type: REL_PIVOT_TABLE,
                rel_target: "../pivotTables/pivotTable1.xml",
                rel_id: "rId2",
                sheet_ref_xml: r#"<pivotTableDefinition r:id="rId2"/>"#,
                target_path: Some("xl/pivotTables/pivotTable1.xml"),
                target_xml: Some(
                    r#"<pivotTableDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="PivotTable1"/>"#,
                ),
                target_content_type: Some(CT_PIVOT_TABLE),
                target_default: None,
                resolved_target: Some("xl/pivotTables/pivotTable1.xml"),
                forbidden_xml: &[],
            },
        ),
        OoxmlFixtureSpec::WorkbookMetadata => fixture_workbook_metadata(row.id),
        OoxmlFixtureSpec::WorksheetEmptyDimension => fixture_sheet_dimension(row.id, "A1", false),
        OoxmlFixtureSpec::WorksheetLargeDimension => {
            fixture_sheet_dimension(row.id, "A1:XFD1048576", true)
        }
        OoxmlFixtureSpec::WorksheetExtLstSingleton => fixture_ext_lst(row.id),
        OoxmlFixtureSpec::WorksheetDrawingNearMiss => fixture_worksheet_relationship(
            row.id,
            WorksheetRelationshipFixture {
                rel_type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawingCustom",
                rel_target: "../customXml/item1.xml",
                rel_id: "rId2",
                sheet_ref_xml: "",
                target_path: Some("xl/customXml/item1.xml"),
                target_xml: Some("<notDrawing/>"),
                target_content_type: Some(CT_XML),
                target_default: None,
                resolved_target: Some("xl/customXml/item1.xml"),
                forbidden_xml: &[],
            },
        ),
        OoxmlFixtureSpec::CoreAndAppProperties => fixture_document_properties(row.id),
    }
}

pub fn run_ooxml_contract_gate() -> GateReport {
    let started = std::time::Instant::now();
    let mut scenarios = Vec::new();

    for row in ooxml_contract_matrix() {
        let fixture = generate_ooxml_fixture(row);
        let mut scenario = GateScenario::new(row.id, GateStatus::Passed);
        scenario.facts = Some(workbook_facts_for_fixture(&fixture));

        let mut fingerprints = Vec::new();
        if let Err(err) = assert_fixture_source_contract(row, &fixture) {
            fingerprints.push(contract_fingerprint(row, err));
        }
        if row.preservation_mode == OoxmlPreservationMode::Modeled {
            if let Err(err) = assert_l1_contract(row, &fixture) {
                fingerprints.push(contract_fingerprint(row, err));
            }
        }

        if !fingerprints.is_empty() {
            scenario.status = GateStatus::Failed;
            scenario.fingerprints = fingerprints;
        }
        scenario.metrics = scenario_metrics(row, &fixture);
        scenarios.push(scenario);
    }

    let mut report = GateReport::from_scenarios(
        GateName::OoxmlContract,
        scenarios,
        started.elapsed().as_millis() as u64,
    );
    let domain = report.domain.get_or_insert_with(GateReportDomain::default);
    domain.metrics.insert(
        "matrix_row_count".to_string(),
        MetricValue::Integer(OOXML_CONTRACT_MATRIX.len() as i64),
    );
    domain.metrics.insert(
        "fixture_count".to_string(),
        MetricValue::Integer(OOXML_CONTRACT_MATRIX.len() as i64),
    );
    domain.fingerprints = report
        .scenarios
        .iter()
        .flat_map(|scenario| scenario.fingerprints.clone())
        .collect();
    report.normalize();
    report
}

fn assert_fixture_source_contract(
    row: &OoxmlContractRow,
    fixture: &GeneratedOoxmlFixture,
) -> Result<(), String> {
    let archive = XlsxArchive::new(&fixture.bytes).map_err(|err| err.to_string())?;
    let package_report =
        validate_package_graph_bytes(&fixture.bytes).map_err(|err| err.to_string())?;
    assert_package_graph_ok(&package_report)?;
    assert_expected_entries(&archive, fixture)?;
    assert_expected_relationships(&archive, fixture)?;
    assert_expected_content_types(&archive, fixture)?;
    assert_expected_xml_facts(&archive, fixture.expected.xml_facts)?;
    assert_forbidden_xml_facts(&archive, fixture.expected.forbidden_xml_facts)?;
    assert_feature_specific_parse(row, &archive)?;
    Ok(())
}

fn assert_l1_contract(
    row: &OoxmlContractRow,
    fixture: &GeneratedOoxmlFixture,
) -> Result<(), String> {
    let (output, _diagnostics) = crate::parse_xlsx_to_output(&fixture.bytes)
        .map_err(|err| format!("parse failed: {err}"))?;
    let exported =
        write_xlsx_from_parse_output(&output).map_err(|err| format!("L1 export failed: {err}"))?;
    let archive = XlsxArchive::new(&exported).map_err(|err| err.to_string())?;
    assert_package_graph_ok(
        &validate_package_graph_bytes(&exported).map_err(|err| err.to_string())?,
    )?;
    match row.fixture {
        OoxmlFixtureSpec::CalcPrExplicitDefaults => {
            let workbook_xml = read_utf8(&archive, "xl/workbook.xml")?;
            assert_contains(
                &workbook_xml,
                r#"iterateCount="100""#,
                "L1 calcPr explicit iterateCount",
            )?;
            assert_contains(
                &workbook_xml,
                r#"iterateDelta="0.001""#,
                "L1 calcPr explicit iterateDelta",
            )?;
        }
        OoxmlFixtureSpec::WorksheetEmptyDimension => {
            let sheet_xml = read_utf8(&archive, "xl/worksheets/sheet1.xml")?;
            assert_contains(
                &sheet_xml,
                r#"<dimension ref="A1"/>"#,
                "L1 empty sheet dimension",
            )?;
        }
        OoxmlFixtureSpec::WorksheetLargeDimension => {
            let sheet_xml = read_utf8(&archive, "xl/worksheets/sheet1.xml")?;
            assert_contains(
                &sheet_xml,
                r#"<dimension ref="A1:XFD1048576"/>"#,
                "L1 oversized sheet dimension",
            )?;
        }
        OoxmlFixtureSpec::WorksheetExtLstSingleton => {
            let sheet_xml = read_utf8(&archive, "xl/worksheets/sheet1.xml")?;
            let count = sheet_xml.matches("<extLst").count();
            if count > 1 {
                return Err(format!(
                    "L1 extLst singleton expected at most 1 element, found {count}"
                ));
            }
        }
        _ => {}
    }
    Ok(())
}

fn assert_feature_specific_parse(
    row: &OoxmlContractRow,
    archive: &XlsxArchive<'_>,
) -> Result<(), String> {
    match row.fixture {
        OoxmlFixtureSpec::CalcPrExplicitDefaults => {
            let workbook_xml = archive
                .read_file("xl/workbook.xml")
                .map_err(|err| err.to_string())?;
            let calc = parse_calc_settings(&workbook_xml);
            if !calc.has_explicit_iterate_count || !calc.has_explicit_iterate_delta {
                return Err(
                    "calcPr explicit default iterate attributes were not preserved as explicit"
                        .to_string(),
                );
            }
            if calc.iterate_count != 100 || (calc.iterate_delta - 0.001).abs() > f64::EPSILON {
                return Err(
                    "calcPr default-valued attributes parsed to unexpected values".to_string(),
                );
            }
        }
        OoxmlFixtureSpec::WorksheetDrawingNearMiss => {
            let rels = archive
                .read_file("xl/worksheets/_rels/sheet1.xml.rels")
                .map_err(|err| err.to_string())?;
            let parsed = parse_all_rels(&rels);
            if parsed.iter().any(|rel| rel.rel_type == REL_DRAWING) {
                return Err(
                    "near-miss drawing relationship matched the exact drawing relationship"
                        .to_string(),
                );
            }
        }
        _ => {}
    }
    Ok(())
}

fn assert_package_graph_ok(report: &PackageGraphValidationReport) -> Result<(), String> {
    if report.valid {
        Ok(())
    } else {
        Err(format!(
            "package graph violations: {}",
            report
                .violations
                .iter()
                .map(|violation| violation.message.as_str())
                .collect::<Vec<_>>()
                .join("; ")
        ))
    }
}

fn assert_expected_entries(
    archive: &XlsxArchive<'_>,
    fixture: &GeneratedOoxmlFixture,
) -> Result<(), String> {
    for path in fixture.expected.package_entries {
        if !archive.contains(path) {
            return Err(format!("missing expected package entry {path}"));
        }
    }
    Ok(())
}

fn assert_expected_relationships(
    archive: &XlsxArchive<'_>,
    fixture: &GeneratedOoxmlFixture,
) -> Result<(), String> {
    for expected in fixture.expected.relationships {
        let rels_xml = archive
            .read_file(expected.rels_path)
            .map_err(|err| format!("missing rels {}: {err}", expected.rels_path))?;
        let rels = parse_all_rels(&rels_xml);
        let actual = rels
            .iter()
            .find(|rel| rel.id == expected.id)
            .ok_or_else(|| {
                format!(
                    "missing relationship {} in {}",
                    expected.id, expected.rels_path
                )
            })?;
        if actual.rel_type != expected.rel_type {
            return Err(format!(
                "relationship {} in {} has type {}, expected {}",
                expected.id, expected.rels_path, actual.rel_type, expected.rel_type
            ));
        }
        if actual.target != expected.target {
            return Err(format!(
                "relationship {} in {} has target {}, expected {}",
                expected.id, expected.rels_path, actual.target, expected.target
            ));
        }
        if actual.target_mode.as_deref() != expected.target_mode {
            return Err(format!(
                "relationship {} in {} has target mode {:?}, expected {:?}",
                expected.id, expected.rels_path, actual.target_mode, expected.target_mode
            ));
        }
        if let Some(resolved) = expected.resolved_target {
            let owner_base = relationship_owner_base_dir(expected.rels_path)?;
            let actual_resolved = if owner_base.is_empty() && !actual.target.starts_with('/') {
                actual.target.clone()
            } else {
                opc_target_to_zip_path(&actual.target, &owner_base)
            };
            if actual_resolved != resolved {
                return Err(format!(
                    "relationship {} in {} resolves to {}, expected {}",
                    expected.id, expected.rels_path, actual_resolved, resolved
                ));
            }
        }
    }
    Ok(())
}

fn assert_expected_content_types(
    archive: &XlsxArchive<'_>,
    fixture: &GeneratedOoxmlFixture,
) -> Result<(), String> {
    let xml = read_utf8(archive, "[Content_Types].xml")?;
    for expected in fixture.expected.content_types {
        if let Some(part_path) = expected.part_path {
            assert_contains(
                &xml,
                &format!(
                    r#"PartName="/{part_path}" ContentType="{}""#,
                    expected.content_type
                ),
                &format!("content type override for {part_path}"),
            )?;
        }
        if let Some(extension) = expected.extension {
            assert_contains(
                &xml,
                &format!(
                    r#"Extension="{extension}" ContentType="{}""#,
                    expected.content_type
                ),
                &format!("content type default for {extension}"),
            )?;
        }
    }
    Ok(())
}

fn assert_expected_xml_facts(
    archive: &XlsxArchive<'_>,
    facts: &[ExpectedXmlFact],
) -> Result<(), String> {
    for fact in facts {
        let xml = read_utf8(archive, fact.part_path)?;
        assert_contains(
            &xml,
            fact.needle,
            &format!("XML fact in {}", fact.part_path),
        )?;
    }
    Ok(())
}

fn assert_forbidden_xml_facts(
    archive: &XlsxArchive<'_>,
    facts: &[ExpectedXmlFact],
) -> Result<(), String> {
    for fact in facts {
        let xml = read_utf8(archive, fact.part_path)?;
        if xml.contains(fact.needle) {
            return Err(format!(
                "forbidden XML fact {} found in {}",
                fact.needle, fact.part_path
            ));
        }
    }
    Ok(())
}

fn read_utf8(archive: &XlsxArchive<'_>, path: &str) -> Result<String, String> {
    let bytes = archive.read_file(path).map_err(|err| match err {
        ZipError::FileNotFound(_) => format!("missing package entry {path}"),
        other => other.to_string(),
    })?;
    String::from_utf8(bytes).map_err(|err| format!("{path} is not UTF-8: {err}"))
}

fn assert_contains(haystack: &str, needle: &str, label: &str) -> Result<(), String> {
    if haystack.contains(needle) {
        Ok(())
    } else {
        Err(format!("{label} missing `{needle}`"))
    }
}

fn relationship_owner_base_dir(rels_path: &str) -> Result<String, String> {
    if rels_path == "_rels/.rels" {
        return Ok(String::new());
    }
    let owner = crate::infra::opc::relationship_owner_from_rels_path(rels_path)
        .ok_or_else(|| format!("invalid relationship part path {rels_path}"))?;
    Ok(owner
        .rsplit_once('/')
        .map(|(dir, _)| dir)
        .unwrap_or("")
        .to_string())
}

fn workbook_facts_for_fixture(fixture: &GeneratedOoxmlFixture) -> WorkbookFacts {
    let mut facts = WorkbookFacts::new();
    facts.workbook.sheet_count = fixture.expected.modeled_facts.sheet_count;
    facts.package.has_calc_pr = fixture.expected.modeled_facts.has_calc_pr;
    facts.package.part_count = XlsxArchive::new(&fixture.bytes)
        .ok()
        .map(|archive| archive.entries().len() as u32);
    facts.package.relationship_part_count = XlsxArchive::new(&fixture.bytes).ok().map(|archive| {
        archive
            .entries()
            .iter()
            .filter(|entry| entry.name.ends_with(".rels"))
            .count() as u32
    });
    facts.normalized()
}

fn scenario_metrics(
    row: &OoxmlContractRow,
    fixture: &GeneratedOoxmlFixture,
) -> BTreeMap<String, MetricValue> {
    let mut metrics = BTreeMap::new();
    metrics.insert(
        "package_entry_count".to_string(),
        MetricValue::Integer(
            XlsxArchive::new(&fixture.bytes)
                .map(|archive| archive.entries().len() as i64)
                .unwrap_or(0),
        ),
    );
    metrics.insert(
        "modeled_preservation".to_string(),
        MetricValue::Bool(row.preservation_mode == OoxmlPreservationMode::Modeled),
    );
    metrics
}

fn contract_fingerprint(row: &OoxmlContractRow, message: String) -> FailureFingerprint {
    let category = match row.fixture {
        OoxmlFixtureSpec::WorksheetDrawing
        | OoxmlFixtureSpec::WorksheetVmlDrawing
        | OoxmlFixtureSpec::WorksheetDrawingNearMiss => {
            CorrectnessFingerprintCategory::RelationshipClassification
        }
        OoxmlFixtureSpec::WorksheetComments => {
            CorrectnessFingerprintCategory::CommentsVmlDrawingOwnership
        }
        OoxmlFixtureSpec::WorksheetTable | OoxmlFixtureSpec::WorksheetPivotTable => {
            CorrectnessFingerprintCategory::TablePivotChartSidecarOwnership
        }
        OoxmlFixtureSpec::WorksheetEmptyDimension | OoxmlFixtureSpec::WorksheetLargeDimension => {
            CorrectnessFingerprintCategory::DimensionsUsedRange
        }
        OoxmlFixtureSpec::CalcPrExplicitDefaults
        | OoxmlFixtureSpec::WorkbookMetadata
        | OoxmlFixtureSpec::WorksheetExtLstSingleton
        | OoxmlFixtureSpec::CoreAndAppProperties
        | OoxmlFixtureSpec::WorksheetHyperlink
        | OoxmlFixtureSpec::WorksheetPrinterSettings => {
            CorrectnessFingerprintCategory::ModeledStateLoss
        }
    };
    FailureFingerprint::new(
        row.fingerprints
            .first()
            .copied()
            .unwrap_or("ooxml-contract-failure"),
        FingerprintCategory::Correctness(category),
        FingerprintSeverity::Error,
        FingerprintOwner::Contract,
        format!("{}: {message}", row.id),
    )
    .with_evidence(
        FingerprintEvidence::message(message)
            .at_path(row.part_path_pattern)
            .field(row.element_path),
    )
}

#[derive(Debug, Clone)]
struct WorksheetRelationshipFixture {
    rel_type: &'static str,
    rel_target: &'static str,
    rel_id: &'static str,
    sheet_ref_xml: &'static str,
    target_path: Option<&'static str>,
    target_xml: Option<&'static str>,
    target_content_type: Option<&'static str>,
    target_default: Option<(&'static str, &'static str)>,
    resolved_target: Option<&'static str>,
    forbidden_xml: &'static [ExpectedXmlFact],
}

fn fixture_calc_pr_explicit_defaults(row_id: &'static str) -> GeneratedOoxmlFixture {
    let workbook_extra = r#"<calcPr calcId="191029" calcMode="auto" refMode="A1" iterate="1" iterateCount="100" iterateDelta="0.001" fullPrecision="1" calcCompleted="1" calcOnSave="1" concurrentCalc="1" forceFullCalc="0"/>"#;
    let bytes = build_minimal_workbook(BuildOptions {
        workbook_extra,
        ..BuildOptions::default()
    });
    fixture(
        row_id,
        bytes,
        &["xl/workbook.xml"],
        &[],
        &[ExpectedContentType {
            part_path: Some("xl/workbook.xml"),
            extension: None,
            content_type: CT_WORKBOOK,
        }],
        &[ExpectedXmlFact {
            part_path: "xl/workbook.xml",
            needle: r#"iterateCount="100""#,
        }],
        ExpectedModeledFacts {
            has_calc_pr: true,
            sheet_count: 1,
        },
        &[],
    )
}

fn fixture_worksheet_relationship(
    row_id: &'static str,
    spec: WorksheetRelationshipFixture,
) -> GeneratedOoxmlFixture {
    let mut extra_parts = Vec::new();
    if let (Some(path), Some(xml)) = (spec.target_path, spec.target_xml) {
        extra_parts.push((path, xml.as_bytes().to_vec()));
    }
    let mut content_overrides = Vec::new();
    if let (Some(path), Some(content_type)) = (spec.target_path, spec.target_content_type) {
        content_overrides.push((path, content_type));
    }
    let content_defaults = spec.target_default.into_iter().collect::<Vec<_>>();
    let target_mode = if spec.rel_type == REL_HYPERLINK {
        Some("External")
    } else {
        None
    };
    let bytes = build_minimal_workbook(BuildOptions {
        sheet_extra: spec.sheet_ref_xml,
        sheet_relationships: vec![RelationshipSpec {
            id: spec.rel_id,
            rel_type: spec.rel_type,
            target: spec.rel_target,
            target_mode,
        }],
        extra_parts,
        content_overrides,
        content_defaults,
        ..BuildOptions::default()
    });
    let mut entries = vec![
        "xl/worksheets/sheet1.xml",
        "xl/worksheets/_rels/sheet1.xml.rels",
    ];
    if let Some(path) = spec.target_path {
        entries.push(path);
    }
    let rel = ExpectedRelationship {
        rels_path: "xl/worksheets/_rels/sheet1.xml.rels",
        id: spec.rel_id,
        rel_type: spec.rel_type,
        target: spec.rel_target,
        target_mode,
        resolved_target: spec.resolved_target,
    };
    let content_types =
        if let (Some(path), Some(content_type)) = (spec.target_path, spec.target_content_type) {
            vec![ExpectedContentType {
                part_path: Some(path),
                extension: None,
                content_type,
            }]
        } else if let Some((extension, content_type)) = spec.target_default {
            vec![ExpectedContentType {
                part_path: None,
                extension: Some(extension),
                content_type,
            }]
        } else {
            Vec::new()
        };
    let xml_facts = if spec.sheet_ref_xml.is_empty() {
        Vec::new()
    } else {
        vec![ExpectedXmlFact {
            part_path: "xl/worksheets/sheet1.xml",
            needle: spec.sheet_ref_xml,
        }]
    };
    fixture(
        row_id,
        bytes,
        leak_slice(entries),
        leak_slice(vec![rel]),
        leak_slice(content_types),
        leak_slice(xml_facts),
        ExpectedModeledFacts {
            has_calc_pr: false,
            sheet_count: 1,
        },
        spec.forbidden_xml,
    )
}

fn fixture_workbook_metadata(row_id: &'static str) -> GeneratedOoxmlFixture {
    let bytes = build_minimal_workbook(BuildOptions {
        workbook_relationships: vec![RelationshipSpec {
            id: "rId2",
            rel_type: REL_METADATA,
            target: "metadata.xml",
            target_mode: None,
        }],
        extra_parts: vec![(
            "xl/metadata.xml",
            br#"<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>"#
                .to_vec(),
        )],
        content_overrides: vec![("xl/metadata.xml", CT_METADATA)],
        ..BuildOptions::default()
    });
    fixture(
        row_id,
        bytes,
        &["xl/metadata.xml"],
        &[ExpectedRelationship {
            rels_path: "xl/_rels/workbook.xml.rels",
            id: "rId2",
            rel_type: REL_METADATA,
            target: "metadata.xml",
            target_mode: None,
            resolved_target: Some("xl/metadata.xml"),
        }],
        &[ExpectedContentType {
            part_path: Some("xl/metadata.xml"),
            extension: None,
            content_type: CT_METADATA,
        }],
        &[],
        ExpectedModeledFacts {
            has_calc_pr: false,
            sheet_count: 1,
        },
        &[],
    )
}

fn fixture_sheet_dimension(
    row_id: &'static str,
    dimension: &'static str,
    large: bool,
) -> GeneratedOoxmlFixture {
    const EMPTY_DIMENSION_FACTS: &[ExpectedXmlFact] = &[ExpectedXmlFact {
        part_path: "xl/worksheets/sheet1.xml",
        needle: r#"<dimension ref="A1"/>"#,
    }];
    const LARGE_DIMENSION_FACTS: &[ExpectedXmlFact] = &[ExpectedXmlFact {
        part_path: "xl/worksheets/sheet1.xml",
        needle: r#"<dimension ref="A1:XFD1048576"/>"#,
    }];

    let bytes = build_minimal_workbook(BuildOptions {
        dimension,
        ..BuildOptions::default()
    });
    fixture(
        row_id,
        bytes,
        &["xl/worksheets/sheet1.xml"],
        &[],
        &[],
        if large {
            LARGE_DIMENSION_FACTS
        } else {
            EMPTY_DIMENSION_FACTS
        },
        ExpectedModeledFacts {
            has_calc_pr: false,
            sheet_count: 1,
        },
        &[],
    )
}

fn fixture_ext_lst(row_id: &'static str) -> GeneratedOoxmlFixture {
    let bytes = build_minimal_workbook(BuildOptions {
        sheet_extra: r#"<extLst><ext uri="{mog-contract-ext}"/></extLst>"#,
        ..BuildOptions::default()
    });
    fixture(
        row_id,
        bytes,
        &["xl/worksheets/sheet1.xml"],
        &[],
        &[],
        &[ExpectedXmlFact {
            part_path: "xl/worksheets/sheet1.xml",
            needle: r#"<extLst><ext uri="{mog-contract-ext}"/></extLst>"#,
        }],
        ExpectedModeledFacts {
            has_calc_pr: false,
            sheet_count: 1,
        },
        &[],
    )
}

fn fixture_document_properties(row_id: &'static str) -> GeneratedOoxmlFixture {
    let bytes = build_minimal_workbook(BuildOptions {
        root_relationships: vec![
            RelationshipSpec {
                id: "rId2",
                rel_type: crate::infra::opc::REL_CORE_PROPERTIES,
                target: "docProps/core.xml",
                target_mode: None,
            },
            RelationshipSpec {
                id: "rId3",
                rel_type: crate::infra::opc::REL_EXTENDED_PROPERTIES,
                target: "docProps/app.xml",
                target_mode: None,
            },
        ],
        extra_parts: vec![
            (
                "docProps/core.xml",
                br#"<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"/>"#.to_vec(),
            ),
            (
                "docProps/app.xml",
                br#"<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"/>"#.to_vec(),
            ),
        ],
        content_overrides: vec![
            ("docProps/core.xml", crate::write::CT_CORE_PROPERTIES),
            ("docProps/app.xml", crate::write::CT_EXTENDED_PROPERTIES),
        ],
        ..BuildOptions::default()
    });
    fixture(
        row_id,
        bytes,
        &["docProps/core.xml", "docProps/app.xml"],
        &[
            ExpectedRelationship {
                rels_path: "_rels/.rels",
                id: "rId2",
                rel_type: crate::infra::opc::REL_CORE_PROPERTIES,
                target: "docProps/core.xml",
                target_mode: None,
                resolved_target: Some("docProps/core.xml"),
            },
            ExpectedRelationship {
                rels_path: "_rels/.rels",
                id: "rId3",
                rel_type: crate::infra::opc::REL_EXTENDED_PROPERTIES,
                target: "docProps/app.xml",
                target_mode: None,
                resolved_target: Some("docProps/app.xml"),
            },
        ],
        &[],
        &[],
        ExpectedModeledFacts {
            has_calc_pr: false,
            sheet_count: 1,
        },
        &[],
    )
}

fn fixture(
    row_id: &'static str,
    bytes: Vec<u8>,
    package_entries: &'static [&'static str],
    relationships: &'static [ExpectedRelationship],
    content_types: &'static [ExpectedContentType],
    xml_facts: &'static [ExpectedXmlFact],
    modeled_facts: ExpectedModeledFacts,
    forbidden_xml_facts: &'static [ExpectedXmlFact],
) -> GeneratedOoxmlFixture {
    GeneratedOoxmlFixture {
        row_id,
        bytes,
        expected: ExpectedFixtureFacts {
            package_entries,
            relationships,
            content_types,
            xml_facts,
            modeled_facts,
            forbidden_xml_facts,
        },
    }
}

#[derive(Debug, Clone)]
struct BuildOptions {
    dimension: &'static str,
    workbook_extra: &'static str,
    sheet_extra: &'static str,
    root_relationships: Vec<RelationshipSpec>,
    workbook_relationships: Vec<RelationshipSpec>,
    sheet_relationships: Vec<RelationshipSpec>,
    extra_parts: Vec<(&'static str, Vec<u8>)>,
    content_overrides: Vec<(&'static str, &'static str)>,
    content_defaults: Vec<(&'static str, &'static str)>,
}

impl Default for BuildOptions {
    fn default() -> Self {
        Self {
            dimension: "A1",
            workbook_extra: "",
            sheet_extra: "",
            root_relationships: Vec::new(),
            workbook_relationships: Vec::new(),
            sheet_relationships: Vec::new(),
            extra_parts: Vec::new(),
            content_overrides: Vec::new(),
            content_defaults: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
struct RelationshipSpec {
    id: &'static str,
    rel_type: &'static str,
    target: &'static str,
    target_mode: Option<&'static str>,
}

fn build_minimal_workbook(options: BuildOptions) -> Vec<u8> {
    let mut zip = ZipWriter::new();
    zip.add_file(
        "[Content_Types].xml",
        content_types_xml(&options).into_bytes(),
    );
    zip.add_file("_rels/.rels", root_rels_xml(&options).into_bytes());
    zip.add_file("xl/workbook.xml", workbook_xml(&options).into_bytes());
    zip.add_file(
        "xl/_rels/workbook.xml.rels",
        workbook_rels_xml(&options).into_bytes(),
    );
    zip.add_file(
        "xl/worksheets/sheet1.xml",
        worksheet_xml(&options).into_bytes(),
    );
    if !options.sheet_relationships.is_empty() {
        zip.add_file(
            "xl/worksheets/_rels/sheet1.xml.rels",
            rels_xml(&options.sheet_relationships).into_bytes(),
        );
    }
    for (path, bytes) in options.extra_parts {
        zip.add_file(path, bytes);
    }
    zip.finish()
        .expect("generated OOXML contract ZIP should be valid")
}

fn content_types_xml(options: &BuildOptions) -> String {
    let mut defaults = vec![("rels", CT_RELATIONSHIPS), ("xml", CT_XML)];
    defaults.extend(options.content_defaults.iter().copied());
    let mut overrides = vec![
        ("xl/workbook.xml", CT_WORKBOOK),
        ("xl/worksheets/sheet1.xml", CT_WORKSHEET),
    ];
    overrides.extend(options.content_overrides.iter().copied());

    let default_xml = defaults
        .iter()
        .map(|(extension, content_type)| {
            format!(r#"<Default Extension="{extension}" ContentType="{content_type}"/>"#)
        })
        .collect::<String>();
    let override_xml = overrides
        .iter()
        .map(|(part, content_type)| {
            format!(r#"<Override PartName="/{part}" ContentType="{content_type}"/>"#)
        })
        .collect::<String>();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">{default_xml}{override_xml}</Types>"#
    )
}

fn root_rels_xml(options: &BuildOptions) -> String {
    let mut rels = vec![RelationshipSpec {
        id: "rId1",
        rel_type: ROOT_OFFICE_DOCUMENT_REL,
        target: "xl/workbook.xml",
        target_mode: None,
    }];
    rels.extend(options.root_relationships.clone());
    rels_xml(&rels)
}

fn workbook_rels_xml(options: &BuildOptions) -> String {
    let mut rels = vec![RelationshipSpec {
        id: "rId1",
        rel_type: crate::infra::opc::REL_WORKSHEET,
        target: "worksheets/sheet1.xml",
        target_mode: None,
    }];
    rels.extend(options.workbook_relationships.clone());
    rels_xml(&rels)
}

fn rels_xml(rels: &[RelationshipSpec]) -> String {
    let rel_xml = rels
        .iter()
        .map(|rel| {
            let target_mode = rel
                .target_mode
                .map(|mode| format!(r#" TargetMode="{mode}""#))
                .unwrap_or_default();
            format!(
                r#"<Relationship Id="{}" Type="{}" Target="{}"{} />"#,
                rel.id, rel.rel_type, rel.target, target_mode
            )
        })
        .collect::<String>();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="{REL_NS}">{rel_xml}</Relationships>"#
    )
}

fn workbook_xml(options: &BuildOptions) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="{SS_NS}" xmlns:r="{R_NS}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>{}</workbook>"#,
        options.workbook_extra
    )
}

fn worksheet_xml(options: &BuildOptions) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="{SS_NS}" xmlns:r="{R_NS}"><dimension ref="{}"/><sheetData>{}</sheetData>{}</worksheet>"#,
        options.dimension,
        if options.dimension == "A1" {
            ""
        } else {
            r#"<row r="1"><c r="A1"><v>1</v></c></row>"#
        },
        options.sheet_extra
    )
}

fn leak_slice<T>(values: Vec<T>) -> &'static [T] {
    Box::leak(values.into_boxed_slice())
}

const REL_EDGE: &[OoxmlFixtureFamily] = &[OoxmlFixtureFamily::RelationshipEdge];
const EXPLICIT_DEFAULTS: &[OoxmlFixtureFamily] = &[OoxmlFixtureFamily::ExplicitDefaults];
const EMPTY_SHEET: &[OoxmlFixtureFamily] = &[OoxmlFixtureFamily::EmptySheet];
const LARGE_DIMENSION: &[OoxmlFixtureFamily] = &[OoxmlFixtureFamily::LargeDeclaredDimension];
const UNKNOWN_EXTENSION: &[OoxmlFixtureFamily] = &[OoxmlFixtureFamily::UnknownExtension];
const NEAR_MISS: &[OoxmlFixtureFamily] = &[OoxmlFixtureFamily::NegativeNearMiss];

const OOXML_CONTRACT_MATRIX: [OoxmlContractRow; 14] = [
    OoxmlContractRow {
        id: "workbook.calc-pr.explicit-defaults",
        part_path_pattern: "xl/workbook.xml",
        owner_part: "xl/workbook.xml",
        relationship_type: None,
        required_content_type: Some(CT_WORKBOOK),
        element_path: "/workbook/calcPr",
        relationship_attributes: &[],
        explicit_default_rule: Some(
            "default-valued iterateCount and iterateDelta are preserved when explicit",
        ),
        target_resolution_rule: None,
        parser_responsibility: OoxmlGateResponsibility::Parse,
        writer_responsibility: OoxmlGateResponsibility::L1,
        l2_responsibility: OoxmlGateResponsibility::L2,
        preservation_mode: OoxmlPreservationMode::Modeled,
        fixture_families: EXPLICIT_DEFAULTS,
        fingerprints: &["ooxml-workbook-calc-pr-explicit-defaults"],
        fixture: OoxmlFixtureSpec::CalcPrExplicitDefaults,
    },
    OoxmlContractRow {
        id: "worksheet.relationship.drawing",
        part_path_pattern: "xl/worksheets/sheet*.xml",
        owner_part: "xl/worksheets/sheet1.xml",
        relationship_type: Some(REL_DRAWING),
        required_content_type: Some(CT_DRAWING),
        element_path: "/worksheet/drawing@r:id",
        relationship_attributes: &["r:id"],
        explicit_default_rule: None,
        target_resolution_rule: Some("target resolves relative to xl/worksheets/sheet1.xml"),
        parser_responsibility: OoxmlGateResponsibility::Parse,
        writer_responsibility: OoxmlGateResponsibility::L1,
        l2_responsibility: OoxmlGateResponsibility::L2,
        preservation_mode: OoxmlPreservationMode::Opaque,
        fixture_families: REL_EDGE,
        fingerprints: &["ooxml-worksheet-drawing-relationship"],
        fixture: OoxmlFixtureSpec::WorksheetDrawing,
    },
    OoxmlContractRow {
        id: "worksheet.relationship.vml-drawing",
        part_path_pattern: "xl/worksheets/sheet*.xml",
        owner_part: "xl/worksheets/sheet1.xml",
        relationship_type: Some(REL_VML_DRAWING),
        required_content_type: Some(VML_CONTENT_TYPE),
        element_path: "/worksheet/legacyDrawing@r:id",
        relationship_attributes: &["r:id"],
        explicit_default_rule: None,
        target_resolution_rule: Some("target resolves relative to xl/worksheets/sheet1.xml"),
        parser_responsibility: OoxmlGateResponsibility::Parse,
        writer_responsibility: OoxmlGateResponsibility::L1,
        l2_responsibility: OoxmlGateResponsibility::L2,
        preservation_mode: OoxmlPreservationMode::Opaque,
        fixture_families: REL_EDGE,
        fingerprints: &["ooxml-worksheet-vml-drawing-relationship"],
        fixture: OoxmlFixtureSpec::WorksheetVmlDrawing,
    },
    OoxmlContractRow {
        id: "worksheet.relationship.comments",
        part_path_pattern: "xl/worksheets/sheet*.xml",
        owner_part: "xl/worksheets/sheet1.xml",
        relationship_type: Some(REL_COMMENTS),
        required_content_type: Some(CT_COMMENTS),
        element_path: "/Relationships/Relationship@Type=comments",
        relationship_attributes: &[],
        explicit_default_rule: None,
        target_resolution_rule: Some("target resolves relative to xl/worksheets/sheet1.xml"),
        parser_responsibility: OoxmlGateResponsibility::Parse,
        writer_responsibility: OoxmlGateResponsibility::L1,
        l2_responsibility: OoxmlGateResponsibility::L2,
        preservation_mode: OoxmlPreservationMode::Opaque,
        fixture_families: REL_EDGE,
        fingerprints: &["ooxml-worksheet-comments-relationship"],
        fixture: OoxmlFixtureSpec::WorksheetComments,
    },
    OoxmlContractRow {
        id: "worksheet.relationship.hyperlink",
        part_path_pattern: "xl/worksheets/sheet*.xml",
        owner_part: "xl/worksheets/sheet1.xml",
        relationship_type: Some(REL_HYPERLINK),
        required_content_type: None,
        element_path: "/worksheet/hyperlinks/hyperlink@r:id",
        relationship_attributes: &["r:id"],
        explicit_default_rule: None,
        target_resolution_rule: Some("external target mode is not resolved into a package part"),
        parser_responsibility: OoxmlGateResponsibility::Parse,
        writer_responsibility: OoxmlGateResponsibility::L1,
        l2_responsibility: OoxmlGateResponsibility::L2,
        preservation_mode: OoxmlPreservationMode::Modeled,
        fixture_families: REL_EDGE,
        fingerprints: &["ooxml-worksheet-hyperlink-relationship"],
        fixture: OoxmlFixtureSpec::WorksheetHyperlink,
    },
    OoxmlContractRow {
        id: "worksheet.relationship.printer-settings",
        part_path_pattern: "xl/worksheets/sheet*.xml",
        owner_part: "xl/worksheets/sheet1.xml",
        relationship_type: Some(REL_PRINTER_SETTINGS),
        required_content_type: Some(CT_PRINTER_SETTINGS),
        element_path: "/worksheet/pageSetup@r:id",
        relationship_attributes: &["r:id"],
        explicit_default_rule: None,
        target_resolution_rule: Some("target resolves relative to xl/worksheets/sheet1.xml"),
        parser_responsibility: OoxmlGateResponsibility::Parse,
        writer_responsibility: OoxmlGateResponsibility::L1,
        l2_responsibility: OoxmlGateResponsibility::L2,
        preservation_mode: OoxmlPreservationMode::Opaque,
        fixture_families: REL_EDGE,
        fingerprints: &["ooxml-worksheet-printer-settings-relationship"],
        fixture: OoxmlFixtureSpec::WorksheetPrinterSettings,
    },
    OoxmlContractRow {
        id: "worksheet.relationship.table",
        part_path_pattern: "xl/worksheets/sheet*.xml",
        owner_part: "xl/worksheets/sheet1.xml",
        relationship_type: Some(REL_TABLE),
        required_content_type: Some(CT_TABLE),
        element_path: "/worksheet/tableParts/tablePart@r:id",
        relationship_attributes: &["r:id"],
        explicit_default_rule: None,
        target_resolution_rule: Some("target resolves relative to xl/worksheets/sheet1.xml"),
        parser_responsibility: OoxmlGateResponsibility::Parse,
        writer_responsibility: OoxmlGateResponsibility::L1,
        l2_responsibility: OoxmlGateResponsibility::L2,
        preservation_mode: OoxmlPreservationMode::Modeled,
        fixture_families: REL_EDGE,
        fingerprints: &["ooxml-worksheet-table-relationship"],
        fixture: OoxmlFixtureSpec::WorksheetTable,
    },
    OoxmlContractRow {
        id: "worksheet.relationship.pivot-table",
        part_path_pattern: "xl/worksheets/sheet*.xml",
        owner_part: "xl/worksheets/sheet1.xml",
        relationship_type: Some(REL_PIVOT_TABLE),
        required_content_type: Some(CT_PIVOT_TABLE),
        element_path: "/worksheet/pivotTableDefinition@r:id",
        relationship_attributes: &["r:id"],
        explicit_default_rule: None,
        target_resolution_rule: Some("target resolves relative to xl/worksheets/sheet1.xml"),
        parser_responsibility: OoxmlGateResponsibility::Parse,
        writer_responsibility: OoxmlGateResponsibility::L1,
        l2_responsibility: OoxmlGateResponsibility::L2,
        preservation_mode: OoxmlPreservationMode::Opaque,
        fixture_families: REL_EDGE,
        fingerprints: &["ooxml-worksheet-pivot-table-relationship"],
        fixture: OoxmlFixtureSpec::WorksheetPivotTable,
    },
    OoxmlContractRow {
        id: "workbook.relationship.metadata",
        part_path_pattern: "xl/metadata.xml",
        owner_part: "xl/workbook.xml",
        relationship_type: Some(REL_METADATA),
        required_content_type: Some(CT_METADATA),
        element_path: "/Relationships/Relationship@Type=sheetMetadata",
        relationship_attributes: &[],
        explicit_default_rule: None,
        target_resolution_rule: Some("target resolves relative to xl/workbook.xml"),
        parser_responsibility: OoxmlGateResponsibility::Parse,
        writer_responsibility: OoxmlGateResponsibility::L1,
        l2_responsibility: OoxmlGateResponsibility::L2,
        preservation_mode: OoxmlPreservationMode::Modeled,
        fixture_families: REL_EDGE,
        fingerprints: &["ooxml-workbook-metadata-relationship"],
        fixture: OoxmlFixtureSpec::WorkbookMetadata,
    },
    OoxmlContractRow {
        id: "worksheet.dimension.empty",
        part_path_pattern: "xl/worksheets/sheet*.xml",
        owner_part: "xl/worksheets/sheet1.xml",
        relationship_type: None,
        required_content_type: Some(CT_WORKSHEET),
        element_path: "/worksheet/dimension@ref",
        relationship_attributes: &[],
        explicit_default_rule: Some("empty sheets preserve A1 dimension"),
        target_resolution_rule: None,
        parser_responsibility: OoxmlGateResponsibility::Parse,
        writer_responsibility: OoxmlGateResponsibility::L1,
        l2_responsibility: OoxmlGateResponsibility::L2,
        preservation_mode: OoxmlPreservationMode::Modeled,
        fixture_families: EMPTY_SHEET,
        fingerprints: &["ooxml-worksheet-dimension-empty"],
        fixture: OoxmlFixtureSpec::WorksheetEmptyDimension,
    },
    OoxmlContractRow {
        id: "worksheet.dimension.large-declared",
        part_path_pattern: "xl/worksheets/sheet*.xml",
        owner_part: "xl/worksheets/sheet1.xml",
        relationship_type: None,
        required_content_type: Some(CT_WORKSHEET),
        element_path: "/worksheet/dimension@ref",
        relationship_attributes: &[],
        explicit_default_rule: Some(
            "declared max sheet dimension is not truncated in package facts",
        ),
        target_resolution_rule: None,
        parser_responsibility: OoxmlGateResponsibility::Parse,
        writer_responsibility: OoxmlGateResponsibility::L1,
        l2_responsibility: OoxmlGateResponsibility::L2,
        preservation_mode: OoxmlPreservationMode::Opaque,
        fixture_families: LARGE_DIMENSION,
        fingerprints: &["ooxml-worksheet-dimension-large-declared"],
        fixture: OoxmlFixtureSpec::WorksheetLargeDimension,
    },
    OoxmlContractRow {
        id: "worksheet.ext-lst.singleton",
        part_path_pattern: "xl/worksheets/sheet*.xml",
        owner_part: "xl/worksheets/sheet1.xml",
        relationship_type: None,
        required_content_type: Some(CT_WORKSHEET),
        element_path: "/worksheet/extLst",
        relationship_attributes: &[],
        explicit_default_rule: Some("worksheet extLst is emitted at most once"),
        target_resolution_rule: None,
        parser_responsibility: OoxmlGateResponsibility::Parse,
        writer_responsibility: OoxmlGateResponsibility::L1,
        l2_responsibility: OoxmlGateResponsibility::L2,
        preservation_mode: OoxmlPreservationMode::Modeled,
        fixture_families: UNKNOWN_EXTENSION,
        fingerprints: &["ooxml-worksheet-ext-lst-singleton"],
        fixture: OoxmlFixtureSpec::WorksheetExtLstSingleton,
    },
    OoxmlContractRow {
        id: "worksheet.relationship.drawing-near-miss",
        part_path_pattern: "xl/worksheets/sheet*.xml",
        owner_part: "xl/worksheets/sheet1.xml",
        relationship_type: Some(
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawingCustom",
        ),
        required_content_type: Some(CT_XML),
        element_path: "/worksheet/drawing@r:id",
        relationship_attributes: &["r:id"],
        explicit_default_rule: None,
        target_resolution_rule: Some("near-miss relationship type must not classify as DrawingML"),
        parser_responsibility: OoxmlGateResponsibility::Parse,
        writer_responsibility: OoxmlGateResponsibility::L1,
        l2_responsibility: OoxmlGateResponsibility::L2,
        preservation_mode: OoxmlPreservationMode::Unsupported,
        fixture_families: NEAR_MISS,
        fingerprints: &["ooxml-worksheet-drawing-near-miss"],
        fixture: OoxmlFixtureSpec::WorksheetDrawingNearMiss,
    },
    OoxmlContractRow {
        id: "package.document-properties.core-app",
        part_path_pattern: "docProps/*.xml",
        owner_part: "_rels/.rels",
        relationship_type: None,
        required_content_type: None,
        element_path: "/Relationships/Relationship@Type=core-properties|extended-properties",
        relationship_attributes: &[],
        explicit_default_rule: None,
        target_resolution_rule: Some("root relationships resolve from package root"),
        parser_responsibility: OoxmlGateResponsibility::Parse,
        writer_responsibility: OoxmlGateResponsibility::L1,
        l2_responsibility: OoxmlGateResponsibility::L2,
        preservation_mode: OoxmlPreservationMode::Modeled,
        fixture_families: REL_EDGE,
        fingerprints: &["ooxml-package-document-properties"],
        fixture: OoxmlFixtureSpec::CoreAndAppProperties,
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ooxml_contract_matrix_has_seeded_rows() {
        let rows = ooxml_contract_matrix();
        assert!(
            rows.iter()
                .any(|row| row.id == "workbook.calc-pr.explicit-defaults")
        );
        assert!(
            rows.iter()
                .any(|row| row.id == "worksheet.relationship.vml-drawing")
        );
        assert!(
            rows.iter()
                .any(|row| row.id == "worksheet.relationship.drawing-near-miss")
        );
        assert!(rows.iter().all(|row| !row.fingerprints.is_empty()));
    }

    #[test]
    fn generated_ooxml_fixtures_satisfy_source_contracts() {
        for row in ooxml_contract_matrix() {
            let fixture = generate_ooxml_fixture(row);
            assert_eq!(fixture.row_id, row.id);
            assert_fixture_source_contract(row, &fixture).unwrap_or_else(|err| {
                panic!("source contract failed for {}: {err}", row.id);
            });
        }
    }

    #[test]
    fn modeled_ooxml_fixtures_satisfy_l1_contracts() {
        for row in ooxml_contract_matrix()
            .iter()
            .filter(|row| row.preservation_mode == OoxmlPreservationMode::Modeled)
        {
            let fixture = generate_ooxml_fixture(row);
            assert_l1_contract(row, &fixture).unwrap_or_else(|err| {
                panic!("L1 contract failed for {}: {err}", row.id);
            });
        }
    }
}

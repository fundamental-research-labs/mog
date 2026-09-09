//! Exercise cache preservation and explicit calculation through the shipped CLI.
use std::{
    fs,
    path::PathBuf,
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
};

use compute_api::Workbook;
use value_types::CellValue;
use xlsx_parser::write::ZipWriter;

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "mog-cli-save-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        let mut zip = ZipWriter::new();
        zip.add_file("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#.to_vec());
        zip.add_file("_rels/.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#.to_vec());
        zip.add_file("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets><calcPr calcMode="manual"/></workbook>"#.to_vec());
        zip.add_file("xl/_rels/workbook.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#.to_vec());
        zip.add_file("xl/worksheets/sheet1.xml", br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:F3"/><sheetData><row r="1"><c r="A1"><v>10</v></c><c r="B1"><v>5</v></c><c r="C1"><f>A1+B1</f><v>0</v></c><c r="D1"><f>A1/B1</f><v>0</v></c><c r="E1"><f>RAND()</f><v>0.25</v></c><c r="F1"><f>E1*2</f><v>0.5</v></c></row><row r="2"><c r="A2"><v>20</v></c><c r="B2"><v>15</v></c><c r="C2"><f>A2*B2</f><v>0</v></c><c r="D2"><f>AVERAGE(A1:A3)</f><v>0</v></c></row><row r="3"><c r="A3"><v>30</v></c><c r="C3"><f>SUM(A1:A3)</f><v>0</v></c></row></sheetData></worksheet>"#.to_vec());
        fs::write(path.join("input.xlsx"), zip.finish().unwrap()).unwrap();
        Self(path)
    }

    fn save(&self, recalculate: bool, script: Option<&str>) -> Workbook {
        let mut command = Command::new(env!("CARGO_BIN_EXE_mog"));
        command.arg(if script.is_some() { "run" } else { "save" });
        if recalculate {
            command.arg("--recalculate");
        }
        command.arg(self.0.join("input.xlsx"));
        if let Some(script) = script {
            fs::write(self.0.join("script.js"), script).unwrap();
            command.arg(self.0.join("script.js"));
        }
        command.arg(self.0.join("output.xlsx"));
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        Workbook::from_xlsx_path(self.0.join("output.xlsx").to_str().unwrap())
            .unwrap()
            .0
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn save_preserves_stale_and_volatile_caches() {
    let fixture = Fixture::new();
    let workbook = fixture.save(false, None);
    let sheet = workbook.sheet_by_index(0).unwrap();
    for address in ["C1", "D1", "C2", "D2", "C3"] {
        assert_eq!(
            sheet.get_cell_value(address).unwrap(),
            CellValue::number(0.0),
            "{address}"
        );
    }
    assert_eq!(sheet.get_cell_value("E1").unwrap(), CellValue::number(0.25));
    assert_eq!(sheet.get_cell_value("F1").unwrap(), CellValue::number(0.5));
    assert_eq!(sheet.get_formula("C1").unwrap().as_deref(), Some("=A1+B1"));
}

#[test]
fn save_recalculate_evaluates_stale_caches_even_in_manual_mode() {
    let fixture = Fixture::new();
    let workbook = fixture.save(true, None);
    let sheet = workbook.sheet_by_index(0).unwrap();
    for (address, expected) in [
        ("C1", 15.0),
        ("D1", 2.0),
        ("C2", 300.0),
        ("D2", 20.0),
        ("C3", 60.0),
    ] {
        assert_eq!(
            sheet.get_cell_value(address).unwrap(),
            CellValue::number(expected),
            "{address}"
        );
    }
    let random = match sheet.get_cell_value("E1").unwrap() {
        CellValue::Number(value) => value.get(),
        value => panic!("RAND returned {value:?}"),
    };
    assert!((0.0..1.0).contains(&random));
    assert_eq!(
        sheet.get_cell_value("F1").unwrap(),
        CellValue::number(random * 2.0)
    );
}

#[test]
fn run_recalculate_exports_results_after_script_mutation() {
    let fixture = Fixture::new();
    let workbook = fixture.save(
        true,
        Some(
            r#"
        await Excel.run(async context => {
            context.workbook.worksheets.getItem("Sheet1").getRange("A1").values = [[40]];
            await context.sync();
        });
    "#,
        ),
    );
    let sheet = workbook.sheet_by_index(0).unwrap();
    assert_eq!(sheet.get_cell_value("C1").unwrap(), CellValue::number(45.0));
    assert_eq!(sheet.get_cell_value("C3").unwrap(), CellValue::number(90.0));
}

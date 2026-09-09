//! Chart roundtrips exercise the actual CLI and its native parallel export.
use std::{
    fs,
    path::PathBuf,
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
};

use xlsx_parser::{XlsxArchive, write::ZipWriter};

struct Fixture(PathBuf);

impl Fixture {
    fn new(chart_count: usize) -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let directory = std::env::temp_dir().join(format!(
            "mog-cli-charts-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&directory).unwrap();
        let mut zip = ZipWriter::new();
        let mut content_types = String::from(
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>"#,
        );
        let mut sheets = String::new();
        let mut workbook_rels = String::new();
        // More than one sheet makes the export worker boundary observable even
        // for a workbook that has only one chart.
        for (index, name) in ["נתונים", "Summary", "Detail"].iter().enumerate() {
            let number = index + 1;
            content_types.push_str(&format!(r#"<Override PartName="/xl/worksheets/sheet{number}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>"#));
            sheets.push_str(&format!(
                r#"<sheet name="{name}" sheetId="{number}" r:id="rId{number}"/>"#
            ));
            workbook_rels.push_str(&format!(r#"<Relationship Id="rId{number}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{number}.xml"/>"#));
            let drawing = if index < chart_count {
                content_types.push_str(&format!(r#"<Override PartName="/xl/drawings/drawing{number}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart{number}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>"#));
                zip.add_file(&format!("xl/worksheets/_rels/sheet{number}.xml.rels"), relationships(&format!(r#"<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing{number}.xml"/>"#)));
                zip.add_file(&format!("xl/drawings/_rels/drawing{number}.xml.rels"), relationships(&format!(r#"<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart{number}.xml"/>"#)));
                zip.add_file(&format!("xl/drawings/drawing{number}.xml"), format!(r#"<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:twoCellAnchor><xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>16</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="{number}" name="Chart {number}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>"#).into_bytes());
                zip.add_file(&format!("xl/charts/chart{number}.xml"), format!(r#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:lang val="he-IL"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Totals {number}</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:layout/><c:pieChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/><c:val><c:numRef><c:f>'{name}'!$A$1:$A$2</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:pieChart></c:plotArea><c:plotVisOnly val="1"/></c:chart></c:chartSpace>"#).into_bytes());
                r#"<drawing r:id="rId1"/>"#
            } else {
                ""
            };
            zip.add_file(&format!("xl/worksheets/sheet{number}.xml"), format!(r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:A2"/><sheetData><row r="1"><c r="A1"><v>10</v></c></row><row r="2"><c r="A2"><v>20</v></c></row></sheetData>{drawing}</worksheet>"#).into_bytes());
        }
        content_types.push_str("</Types>");
        zip.add_file("[Content_Types].xml", content_types.into_bytes());
        zip.add_file("_rels/.rels", relationships(r#"<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>"#));
        zip.add_file("xl/_rels/workbook.xml.rels", relationships(&workbook_rels));
        zip.add_file("xl/workbook.xml", format!(r#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>{sheets}</sheets></workbook>"#).into_bytes());
        fs::write(directory.join("input.xlsx"), zip.finish().unwrap()).unwrap();
        Self(directory)
    }

    fn roundtrip(&self, chart_count: usize, mutate: bool) {
        let mut command = Command::new(env!("CARGO_BIN_EXE_mog"));
        // The export must own its worker stack budget, regardless of the host's
        // global pool settings. Each command starts a fresh process/pool.
        command.env("RUST_MIN_STACK", "2097152");
        command.env("RAYON_NUM_THREADS", "2");
        command.arg(if mutate { "run" } else { "save" });
        command.arg(self.0.join("input.xlsx"));
        if mutate {
            let script = self.0.join("script.js");
            fs::write(
                &script,
                r#"await Excel.run(async context => {
                context.workbook.worksheets.getItem("נתונים").getRange("A1").values = [[42]];
                await context.sync();
            });"#,
            )
            .unwrap();
            command.arg(script);
        }
        let output_path = self.0.join("output.xlsx");
        let output = command.arg(&output_path).output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let bytes = fs::read(output_path).unwrap();
        let archive = XlsxArchive::new(&bytes).unwrap();
        for number in 1..=chart_count {
            let chart = String::from_utf8(
                archive
                    .read_file(&format!("xl/charts/chart{number}.xml"))
                    .unwrap(),
            )
            .unwrap();
            assert!(chart.contains(&format!("Totals {number}")), "{chart}");
            assert!(chart.contains("pieChart"), "{chart}");
            assert!(archive.contains(&format!("xl/drawings/drawing{number}.xml")));
        }
        let worksheet =
            String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
        let expected = if mutate { "<v>42</v>" } else { "<v>10</v>" };
        assert!(worksheet.contains(expected), "{worksheet}");
        let workbook = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
        assert!(workbook.contains("נתונים"), "{workbook}");
    }
}

fn relationships(children: &str) -> Vec<u8> {
    format!(r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{children}</Relationships>"#).into_bytes()
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn save_preserves_chart_on_unicode_sheet_with_default_worker_stacks() {
    Fixture::new(1).roundtrip(1, false);
}

#[test]
fn save_preserves_charts_on_multiple_sheets_with_default_worker_stacks() {
    Fixture::new(3).roundtrip(3, false);
}

#[test]
fn run_mutates_unicode_sheet_and_preserves_all_charts() {
    Fixture::new(3).roundtrip(3, true);
}

//! Import/edit/save/reopen through the real CLI. Inspect ZIP/XML directly so
//! a lossy importer cannot also make the assertions pass on a lossy export.
use std::{collections::HashSet, fs, path::Path, process::Command};

use regex::Regex;
use xlsx_parser::{XlsxArchive, write::ZipWriter};

const MAIN: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XDR: &str = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const ART: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const CAMERA: &str = "http://schemas.microsoft.com/office/drawing/2010/main";
// A valid synthetic 1x1 RGB PNG, shared by the modern picture and VML fallback.
const PNG: &[u8] = &[
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0,
    0, 0, 144, 119, 83, 222, 0, 0, 0, 12, 73, 68, 65, 84, 120, 156, 99, 96, 104, 248, 15, 0, 2, 3,
    1, 128, 36, 97, 245, 151, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
];

#[derive(Clone, Copy)]
enum Camera {
    None,
    Bare,
    AlternateContent,
}

fn relationships(children: &str) -> Vec<u8> {
    format!(r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{children}</Relationships>"#).into_bytes()
}

fn fixture(depth: usize, camera: Camera) -> Vec<u8> {
    let is_camera = !matches!(camera, Camera::None);
    let camera_props = if is_camera {
        format!(
            r#"<a:extLst><a:ext uri="{{84589F7E-364E-4C9E-8A38-B11213B215E9}}"><a14:cameraTool xmlns:a14="{CAMERA}" cellRange="$A$1:$B$2" spid="_x0000_s1026"/></a:ext></a:extLst>"#
        )
    } else {
        String::new()
    };
    let mut child = format!(
        r#"<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1025" name="Synthetic Picture"/><xdr:cNvPicPr>{camera_props}</xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="762000" cy="762000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>"#
    );
    for index in 0..depth {
        let id = index + 2;
        child = format!(
            r#"<xdr:grpSp><xdr:nvGrpSpPr><xdr:cNvPr id="{id}" name="Group {id}"/><xdr:cNvGrpSpPr/></xdr:nvGrpSpPr><xdr:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="762000" cy="762000"/><a:chOff x="0" y="0"/><a:chExt cx="762000" cy="762000"/></a:xfrm></xdr:grpSpPr>{child}</xdr:grpSp>"#
        );
    }
    let from = "<xdr:from><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>";
    let anchor = if matches!(camera, Camera::AlternateContent) {
        format!(
            r#"<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:a14="{CAMERA}" Requires="a14"><xdr:twoCellAnchor editAs="oneCell">{from}<xdr:to><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>7</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>{child}<xdr:clientData/></xdr:twoCellAnchor></mc:Choice><mc:Fallback/></mc:AlternateContent>"#
        )
    } else {
        format!(
            r#"<xdr:oneCellAnchor>{from}<xdr:ext cx="762000" cy="762000"/>{child}<xdr:clientData/></xdr:oneCellAnchor>"#
        )
    };
    let mut zip = ZipWriter::new();
    zip.add_file("[Content_Types].xml", br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>"#.to_vec());
    zip.add_file(
        "_rels/.rels",
        relationships(&format!(
            r#"<Relationship Id="rId1" Type="{REL}/officeDocument" Target="xl/workbook.xml"/>"#
        )),
    );
    zip.add_file("xl/workbook.xml", format!(r#"<workbook xmlns="{MAIN}" xmlns:r="{REL}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#).into_bytes());
    zip.add_file(
        "xl/_rels/workbook.xml.rels",
        relationships(&format!(
            r#"<Relationship Id="rId1" Type="{REL}/worksheet" Target="worksheets/sheet1.xml"/>"#
        )),
    );
    let legacy = if is_camera {
        r#"<legacyDrawing r:id="rIdVml"/>"#
    } else {
        ""
    };
    zip.add_file("xl/worksheets/sheet1.xml", format!(r#"<worksheet xmlns="{MAIN}" xmlns:r="{REL}"><sheetData><row r="1"><c r="A1"><v>42</v></c></row></sheetData><drawing r:id="rIdDrawing"/>{legacy}</worksheet>"#).into_bytes());
    let vml_rel = if is_camera {
        format!(
            r#"<Relationship Id="rIdVml" Type="{REL}/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/>"#
        )
    } else {
        String::new()
    };
    zip.add_file("xl/worksheets/_rels/sheet1.xml.rels", relationships(&format!(r#"<Relationship Id="rIdDrawing" Type="{REL}/drawing" Target="../drawings/drawing1.xml"/>{vml_rel}"#)));
    zip.add_file(
        "xl/drawings/drawing1.xml",
        format!(
            r#"<xdr:wsDr xmlns:xdr="{XDR}" xmlns:a="{ART}" xmlns:r="{REL}">{anchor}</xdr:wsDr>"#
        )
        .into_bytes(),
    );
    let image_rel = relationships(&format!(
        r#"<Relationship Id="rIdImage" Type="{REL}/image" Target="../media/synthetic.png"/>"#
    ));
    zip.add_file("xl/drawings/_rels/drawing1.xml.rels", image_rel.clone());
    zip.add_file("xl/media/synthetic.png", PNG.to_vec());
    if is_camera {
        zip.add_file("xl/drawings/vmlDrawing1.vml", br##"<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><v:shape id="_x0000_s1026" type="#_x0000_t75" style="position:absolute;width:60pt;height:60pt"><v:imagedata o:relid="rIdImage"/><x:ClientData ObjectType="Pict"><x:Anchor>3,0,3,0,4,0,4,0</x:Anchor><x:FmlaPict>$A$1:$B$2</x:FmlaPict><x:CF>Pict</x:CF><x:Camera/></x:ClientData></v:shape></xml>"##.to_vec());
        zip.add_file("xl/drawings/_rels/vmlDrawing1.vml.rels", image_rel);
    }
    zip.finish().unwrap()
}

// These intentionally inspect emitted XML without the drawing importer or
// Workbook facade: a dropped feature must not disappear from both sides.
fn tags(xml: &str, local_name: &str) -> Vec<String> {
    Regex::new(&format!(r"<(?:[\w.-]+:)?{local_name}\b[^>]*>"))
        .unwrap()
        .find_iter(xml)
        .map(|tag| tag.as_str().to_owned())
        .collect()
}

fn attribute(tag: &str, name: &str) -> String {
    Regex::new(&format!(r#"\b{}="([^"]*)""#, regex::escape(name)))
        .unwrap()
        .captures(tag)
        .unwrap_or_else(|| panic!("missing {name} in {tag}"))[1]
        .to_owned()
}

fn relationship_part(owner: &str) -> String {
    let (directory, name) = owner.rsplit_once('/').unwrap();
    format!("{directory}/_rels/{name}.rels")
}

fn internal_target(owner: &str, relationship: &str) -> String {
    assert!(!relationship.contains("TargetMode=\"External\""));
    let target = attribute(relationship, "Target");
    assert!(!target.is_empty(), "empty internal relationship target");
    let joined = if target.starts_with('/') {
        target.trim_start_matches('/').to_owned()
    } else {
        format!(
            "{}/{target}",
            owner
                .rsplit_once('/')
                .map_or("", |(directory, _)| directory)
        )
    };
    let mut normalized = Vec::new();
    for component in joined.split('/') {
        match component {
            ".." => assert!(normalized.pop().is_some(), "target escapes package"),
            "." | "" => {}
            other => normalized.push(other),
        }
    }
    normalized.join("/")
}

fn assert_internal_relationships(archive: &XlsxArchive<'_>) {
    let names: HashSet<_> = archive
        .entries()
        .iter()
        .map(|entry| entry.name.as_str())
        .collect();
    for name in names.iter().filter(|name| name.ends_with(".rels")) {
        let owner = if *name == "_rels/.rels" {
            String::new()
        } else {
            let (directory, file) = if let Some(file) = name.strip_prefix("_rels/") {
                ("", file)
            } else {
                name.rsplit_once("/_rels/")
                    .expect("invalid relationship part path")
            };
            let owner = format!("{directory}/{}", file.strip_suffix(".rels").unwrap())
                .trim_start_matches('/')
                .to_owned();
            assert!(
                names.contains(owner.as_str()),
                "relationship owner missing: {owner}"
            );
            owner
        };
        let xml = String::from_utf8(archive.read_file(name).unwrap()).unwrap();
        let relationships = tags(&xml, "Relationship");
        let mut ids = HashSet::new();
        for relationship in relationships {
            let id = attribute(&relationship, "Id");
            assert!(
                !id.is_empty() && ids.insert(id),
                "missing or duplicate relationship ID"
            );
            if relationship.contains("TargetMode=\"External\"") {
                continue;
            }
            let target = internal_target(&owner, &relationship);
            assert!(
                names.contains(target.as_str()),
                "{name} references missing part: {target}"
            );
        }
    }
}

fn assert_drawing(bytes: &[u8], depth: usize, camera: Camera) {
    let archive = XlsxArchive::new(bytes).unwrap();
    assert_internal_relationships(&archive);
    assert!(
        !archive
            .entries()
            .iter()
            .any(|e| e.name.starts_with("xl/ctrlProps/")),
        "camera picture must not become a modern form control"
    );
    let sheet_path = "xl/worksheets/sheet1.xml";
    let sheet = String::from_utf8(archive.read_file(sheet_path).unwrap()).unwrap();
    let drawings = tags(&sheet, "drawing");
    assert_eq!(drawings.len(), 1, "worksheet lost its drawing reference");
    let drawing_id = attribute(&drawings[0], "r:id");
    let sheet_rels_xml =
        String::from_utf8(archive.read_file(&relationship_part(sheet_path)).unwrap()).unwrap();
    let sheet_rels = tags(&sheet_rels_xml, "Relationship");
    let drawing_rels: Vec<_> = sheet_rels
        .iter()
        .filter(|rel| attribute(rel, "Id") == drawing_id)
        .collect();
    assert_eq!(
        drawing_rels.len(),
        1,
        "worksheet drawing reference must resolve uniquely"
    );
    assert_eq!(attribute(drawing_rels[0], "Type"), format!("{REL}/drawing"));
    let drawing_path = internal_target(sheet_path, drawing_rels[0]);
    let xml = String::from_utf8(archive.read_file(&drawing_path).unwrap()).unwrap();
    assert_eq!(tags(&xml, "grpSp").len(), depth, "group hierarchy changed");
    assert_eq!(tags(&xml, "pic").len(), 1, "picture disappeared");
    let blips = tags(&xml, "blip");
    assert_eq!(blips.len(), 1);
    let embed = attribute(&blips[0], "r:embed");
    let rel_xml = String::from_utf8(
        archive
            .read_file(&relationship_part(&drawing_path))
            .expect("picture lost its relationship part"),
    )
    .unwrap();
    let rels = tags(&rel_xml, "Relationship");
    let ids: HashSet<_> = rels.iter().map(|rel| attribute(rel, "Id")).collect();
    assert_eq!(ids.len(), rels.len(), "duplicate drawing relationship IDs");
    let rel = rels
        .iter()
        .find(|rel| attribute(rel, "Id") == embed)
        .expect("picture has a dangling embedded-image reference");
    assert_eq!(attribute(rel, "Type"), format!("{REL}/image"));
    let image_path = internal_target(&drawing_path, rel);
    assert_eq!(
        archive.read_file(&image_path).unwrap(),
        PNG,
        "image bytes changed"
    );
    let cameras = tags(&xml, "cameraTool");
    assert_eq!(cameras.len(), usize::from(!matches!(camera, Camera::None)));
    if let Some(camera) = cameras.first() {
        assert_eq!(
            attribute(camera, "cellRange"),
            "$A$1:$B$2",
            "live camera reference changed"
        );
    }
}

fn invoke(binary: &Path, input: &Path, output: &Path, edit: bool) {
    let script = format!(
        r#"await Excel.run(async c => {{
        const cell = c.workbook.worksheets.getItem('Sheet1').getRange('A1');
        {}
        cell.load('values'); await c.sync();
        console.log(JSON.stringify(cell.values));
    }});"#,
        if edit { "cell.values = [[99]];" } else { "" }
    );
    let result = Command::new(binary)
        .arg("--input")
        .arg(input)
        .arg("--output")
        .arg(output)
        .arg("--eval")
        .arg(script)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert_eq!(
        String::from_utf8(result.stdout).unwrap().trim(),
        "[[99]]",
        "edited cell did not survive CLI reopen"
    );
}

fn roundtrip(depth: usize, camera: Camera) {
    let directory = tempfile::tempdir().unwrap();
    let input = directory.path().join("input.xlsx");
    let original = fixture(depth, camera);
    // Validate the fixture with the same independent structural assertions.
    assert_drawing(&original, depth, camera);
    fs::write(&input, &original).unwrap();
    let first = directory.path().join("edited.xlsx");
    let second = directory.path().join("reopened.xlsx");
    let binary = Path::new(env!("CARGO_BIN_EXE_mog"));
    invoke(binary, &input, &first, true);
    assert_drawing(&fs::read(&first).unwrap(), depth, camera);
    invoke(binary, &first, &second, false);
    assert_drawing(&fs::read(&second).unwrap(), depth, camera);
    assert_eq!(
        fs::read(input).unwrap(),
        original,
        "input workbook was overwritten"
    );
}

#[test]
fn cli_preserves_alternate_content_camera_after_edit_and_reopen() {
    roundtrip(0, Camera::AlternateContent);
}

#[test]
fn cli_preserves_bare_camera_after_edit_and_reopen() {
    roundtrip(0, Camera::Bare);
}

#[test]
fn cli_preserves_grouped_picture_after_edit_and_reopen() {
    roundtrip(1, Camera::None);
}

#[test]
fn cli_preserves_nested_picture_after_edit_and_reopen() {
    roundtrip(2, Camera::None);
}

// Check the assertion itself against an orphaned drawing and a valid alternate
// package layout; neither check invokes the importer as its oracle.
fn rewrite_fixture(mut rewrite: impl FnMut(&str, Vec<u8>) -> (String, Vec<u8>)) -> Vec<u8> {
    let original = fixture(0, Camera::None);
    let archive = XlsxArchive::new(&original).unwrap();
    let mut zip = ZipWriter::new();
    for entry in archive.entries() {
        let (name, bytes) = rewrite(&entry.name, archive.read_file(&entry.name).unwrap());
        zip.add_file(&name, bytes);
    }
    zip.finish().unwrap()
}

#[test]
fn drawing_assertion_rejects_orphaned_or_dangling_sheet_reference() {
    for replacement in ["", r#"<drawing r:id="missing"/>"#] {
        let orphaned = rewrite_fixture(|name, bytes| {
            let bytes = if name == "xl/worksheets/sheet1.xml" {
                String::from_utf8(bytes)
                    .unwrap()
                    .replace(r#"<drawing r:id="rIdDrawing"/>"#, replacement)
                    .into_bytes()
            } else {
                bytes
            };
            (name.to_owned(), bytes)
        });
        assert!(std::panic::catch_unwind(|| assert_drawing(&orphaned, 0, Camera::None)).is_err());
    }
}

#[test]
fn drawing_assertion_follows_renamed_and_relocated_drawing() {
    for target in [
        "../custom/drawings/renamed.xml",
        "/xl/custom/drawings/renamed.xml",
    ] {
        let relocated = rewrite_fixture(|name, bytes| {
            let (new_name, bytes) = match name {
                "xl/drawings/drawing1.xml" => ("xl/custom/drawings/renamed.xml", bytes),
                "xl/drawings/_rels/drawing1.xml.rels" => (
                    "xl/custom/drawings/_rels/renamed.xml.rels",
                    String::from_utf8(bytes)
                        .unwrap()
                        .replace("../media/", "../../media/")
                        .into_bytes(),
                ),
                "xl/worksheets/_rels/sheet1.xml.rels" => (
                    name,
                    String::from_utf8(bytes)
                        .unwrap()
                        .replace("../drawings/drawing1.xml", target)
                        .into_bytes(),
                ),
                "[Content_Types].xml" => (
                    name,
                    String::from_utf8(bytes)
                        .unwrap()
                        .replace(
                            "/xl/drawings/drawing1.xml",
                            "/xl/custom/drawings/renamed.xml",
                        )
                        .into_bytes(),
                ),
                _ => (name, bytes),
            };
            (new_name.to_owned(), bytes)
        });
        assert_drawing(&relocated, 0, Camera::None);
    }
}

#[test]
fn drawing_assertion_checks_unreferenced_internal_relationships() {
    // Retained relationships must resolve even if no drawing element uses them.
    // External links need not name a package part; modern pictures need no VML.
    for external in [false, true] {
        let bytes = rewrite_fixture(|name, bytes| {
            let bytes = if name == "xl/worksheets/_rels/sheet1.xml.rels" {
                let mode = if external {
                    r#" TargetMode="External""#
                } else {
                    ""
                };
                let extra = format!(
                    r#"<Relationship Id="rIdUnusedLegacy" Type="{REL}/vmlDrawing" Target="../drawings/missing.vml"{mode}/></Relationships>"#
                );
                String::from_utf8(bytes)
                    .unwrap()
                    .replace("</Relationships>", &extra)
                    .into_bytes()
            } else {
                bytes
            };
            (name.to_owned(), bytes)
        });
        let result = std::panic::catch_unwind(|| assert_drawing(&bytes, 0, Camera::None));
        assert_eq!(result.is_ok(), external);
    }
    let orphan_owner = rewrite_fixture(|name, bytes| {
        let name = if name == "xl/drawings/_rels/drawing1.xml.rels" {
            "xl/drawings/_rels/missing.xml.rels"
        } else {
            name
        };
        (name.to_owned(), bytes)
    });
    assert!(std::panic::catch_unwind(|| assert_drawing(&orphan_owner, 0, Camera::None)).is_err());
}

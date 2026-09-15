use std::collections::{HashMap, HashSet};

use ooxml_types::shared::OpcRelationship;

use crate::zip::XlsxArchive;

use super::error::PackageIntegrityError;
use super::paths::{part_rels_path, worksheet_rels_path};
use quick_xml::{Reader, events::Event};

pub(super) fn validate_worksheet_r_ids(
    archive: &XlsxArchive<'_>,
    worksheet_path: &str,
    relationships_by_part: &HashMap<String, Vec<OpcRelationship>>,
    errors: &mut Vec<PackageIntegrityError>,
) {
    let xml = match archive.xml_reader(worksheet_path) {
        Ok(xml) => xml,
        Err(error) => {
            errors.push(PackageIntegrityError::UnreadableXmlPart {
                part_path: worksheet_path.to_string(),
                reason: error.to_string(),
            });
            return;
        }
    };
    let rels_path = worksheet_rels_path(worksheet_path);
    let defined_ids: HashSet<&str> = relationships_by_part
        .get(&rels_path)
        .into_iter()
        .flatten()
        .map(|rel| rel.id.as_str())
        .collect();
    let scan = scan_relationship_attrs(xml, &["id"], true, |attr| {
        if !defined_ids.contains(attr.value.as_str()) {
            errors.push(
                PackageIntegrityError::MissingWorksheetRelationshipReference {
                    worksheet_path: worksheet_path.to_string(),
                    rels_path: rels_path.clone(),
                    id: attr.value,
                },
            );
        }
    });
    if let Err(error) = scan {
        errors.push(PackageIntegrityError::UnreadableXmlPart {
            part_path: worksheet_path.to_string(),
            reason: error.to_string(),
        });
    }
}

pub(super) fn validate_part_relationship_references(
    archive: &XlsxArchive<'_>,
    part_path: &str,
    relationships_by_part: &HashMap<String, Vec<OpcRelationship>>,
    errors: &mut Vec<PackageIntegrityError>,
) {
    let input: Result<Box<dyn std::io::BufRead + '_>, _> = if part_path.ends_with(".xml") {
        archive
            .xml_reader(part_path)
            .map(|reader| Box::new(reader) as Box<dyn std::io::BufRead>)
    } else {
        // VML can carry legacy encodings; preserve the existing read policy.
        archive
            .read_file(part_path)
            .map(|bytes| Box::new(std::io::Cursor::new(bytes)) as Box<dyn std::io::BufRead>)
    };
    let xml = match input {
        Ok(xml) => xml,
        Err(error) => {
            errors.push(PackageIntegrityError::UnreadableXmlPart {
                part_path: part_path.to_string(),
                reason: error.to_string(),
            });
            return;
        }
    };
    let rels_path = part_rels_path(part_path);
    let defined_ids: HashSet<&str> = relationships_by_part
        .get(&rels_path)
        .into_iter()
        .flatten()
        .map(|rel| rel.id.as_str())
        .collect();
    let scan = scan_relationship_attrs(xml, &["id", "embed", "link", "relid"], false, |attr| {
        if !defined_ids.contains(attr.value.as_str()) {
            errors.push(PackageIntegrityError::MissingPartRelationshipReference {
                part_path: part_path.to_string(),
                rels_path: rels_path.clone(),
                id: attr.value,
                attr_name: attr.name,
            });
        }
    });
    if let Err(error) = scan {
        errors.push(PackageIntegrityError::UnreadableXmlPart {
            part_path: part_path.to_string(),
            reason: error.to_string(),
        });
    }
}

struct RelationshipAttr {
    name: String,
    value: String,
}

fn scan_relationship_attrs(
    input: impl std::io::BufRead,
    names: &[&str],
    skip_controls: bool,
    mut visit: impl FnMut(RelationshipAttr),
) -> Result<(), quick_xml::Error> {
    let mut reader = Reader::from_reader(input);
    let mut buffer = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer)? {
            Event::Start(start) | Event::Empty(start) => {
                if !(skip_controls && start.local_name().as_ref() == b"control") {
                    for attr in start.attributes().with_checks(false) {
                        let attr = attr?;
                        let key = attr.key.as_ref();
                        let Some(colon) = key.iter().position(|byte| *byte == b':') else {
                            continue;
                        };
                        if names
                            .iter()
                            .any(|name| name.as_bytes() == &key[colon + 1..])
                        {
                            visit(RelationshipAttr {
                                name: String::from_utf8_lossy(key).into_owned(),
                                value: attr.unescape_value()?.into_owned(),
                            });
                        }
                    }
                }
            }
            Event::Eof => return Ok(()),
            _ => {}
        }
        buffer.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::write::{CompressionMethod, ZipWriter};

    #[test]
    fn relationship_scanner_handles_split_attributes_and_escaped_ids() {
        let xml = br#"<worksheet><control r:id="ignored"/><x:control r:id="ignored-too"/><drawing r:id = 'draw&amp;1'/><hyperlink alt:id="link1"/><!-- r:id="comment" --><c><v>r:id="text"</v></c></worksheet>"#;
        for capacity in [1, 2, 7, 64] {
            let reader = std::io::BufReader::with_capacity(capacity, xml.as_slice());
            let mut ids = Vec::new();
            scan_relationship_attrs(reader, &["id"], true, |attr| ids.push(attr.value)).unwrap();
            assert_eq!(ids, ["draw&1", "link1"]);
        }
    }

    #[test]
    fn worksheet_relationship_validation_streams_large_xml_and_rejects_corruption() {
        let xml = format!(
            "<worksheet><sheetData>{}</sheetData><drawing r:id=\"missing\"/></worksheet>",
            "<row><c><v>123</v></c></row>".repeat(10_000)
        );
        for method in [CompressionMethod::Store, CompressionMethod::Deflate(6)] {
            let mut zip = ZipWriter::with_compression(method);
            zip.add_file("xl/worksheets/sheet1.xml", xml.as_bytes());
            let mut bytes = zip.finish().unwrap();
            let archive = XlsxArchive::new(&bytes).unwrap();
            let mut errors = Vec::new();
            validate_worksheet_r_ids(
                &archive,
                "xl/worksheets/sheet1.xml",
                &HashMap::new(),
                &mut errors,
            );
            assert!(
                matches!(errors.as_slice(), [PackageIntegrityError::MissingWorksheetRelationshipReference { id, .. }] if id == "missing")
            );
            // The central-directory CRC must be checked after the final chunk.
            let central = bytes
                .windows(4)
                .rposition(|window| window == b"PK\x01\x02")
                .unwrap();
            bytes[central + 16] ^= 1;
            let archive = XlsxArchive::new(&bytes).unwrap();
            errors.clear();
            validate_worksheet_r_ids(
                &archive,
                "xl/worksheets/sheet1.xml",
                &HashMap::new(),
                &mut errors,
            );
            assert!(errors.iter().any(|error| matches!(error, PackageIntegrityError::UnreadableXmlPart { reason, .. } if reason.contains("CRC"))));
        }
    }

    #[test]
    fn malformed_worksheet_xml_is_a_validation_failure() {
        let mut zip = ZipWriter::new();
        zip.add_file(
            "xl/worksheets/sheet1.xml",
            b"<worksheet><sheetData></worksheet>",
        );
        let bytes = zip.finish().unwrap();
        let archive = XlsxArchive::new(&bytes).unwrap();
        let mut errors = Vec::new();
        validate_worksheet_r_ids(
            &archive,
            "xl/worksheets/sheet1.xml",
            &HashMap::new(),
            &mut errors,
        );
        assert!(matches!(
            errors.as_slice(),
            [PackageIntegrityError::UnreadableXmlPart { .. }]
        ));
    }
}

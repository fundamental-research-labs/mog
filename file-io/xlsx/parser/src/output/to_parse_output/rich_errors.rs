//! Resolve representable rich errors without discarding their legacy fallback.
use domain_types::{ImportedRichError, SheetData, WorkbookMetadata};
use quick_xml::{NsReader, events::Event, name::ResolveResult};
use value_types::{CellError, CellValue};

const RICH_NS: &str = "http://schemas.microsoft.com/office/spreadsheetml/2017/richdata";
const RICH_EXTENSION: &str = "{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}";

#[derive(Default)]
struct Node {
    name: String,
    namespace: String,
    attrs: Vec<(String, String)>,
    text: String,
    children: Vec<Node>,
}
impl Node {
    fn attr(&self, key: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }
    fn children<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Node> + 'a {
        self.children.iter().filter(move |n| n.name == name)
    }
}

// Rich-value XML is shallow. Limit malformed nesting and reject incomplete
// documents rather than turning an unrecognized rich value into a guessed error.
fn parse_node(xml: &[u8]) -> Option<Node> {
    let mut reader = NsReader::from_reader(xml);
    let mut stack = vec![Node::default()];
    loop {
        let (namespace, event) = reader.read_resolved_event().ok()?;
        let namespace = match namespace {
            ResolveResult::Bound(namespace) => {
                std::str::from_utf8(namespace.as_ref()).ok()?.to_owned()
            }
            _ => String::new(),
        };
        let empty = matches!(&event, Event::Empty(_));
        match event {
            Event::Start(event) | Event::Empty(event) => {
                let attrs = event
                    .attributes()
                    .map(|attr| {
                        let attr = attr.ok()?;
                        Some((
                            String::from_utf8(attr.key.as_ref().to_vec()).ok()?,
                            attr.unescape_value().ok()?.into_owned(),
                        ))
                    })
                    .collect::<Option<Vec<_>>>()?;
                let node = Node {
                    name: String::from_utf8(event.local_name().as_ref().to_vec()).ok()?,
                    attrs,
                    namespace,
                    ..Default::default()
                };
                if empty {
                    stack.last_mut()?.children.push(node);
                } else {
                    stack.push(node);
                    if stack.len() > 64 {
                        return None;
                    }
                }
            }
            Event::Text(text) => stack.last_mut()?.text.push_str(&text.unescape().ok()?),
            Event::CData(text) => stack
                .last_mut()?
                .text
                .push_str(std::str::from_utf8(text.as_ref()).ok()?),
            Event::End(_) => {
                if stack.len() <= 1 {
                    return None;
                }
                let node = stack.pop()?;
                stack.last_mut()?.children.push(node);
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if stack.len() != 1 {
        return None;
    }
    let mut root = stack.pop()?;
    (root.children.len() == 1).then(|| root.children.remove(0))
}

fn integer(node: &Node, key: &str) -> Option<usize> {
    node.attr(key)?.trim().parse().ok()
}

fn resolve(
    metadata: &WorkbookMetadata,
    vm: u32,
    values: &Node,
    structures: &Node,
) -> Option<CellError> {
    let block = metadata.value_metadata.get(vm.checked_sub(1)? as usize)?;
    let mut records = block.records.iter().filter(|record| {
        record
            .t
            .checked_sub(1)
            .and_then(|i| metadata.metadata_types.get(i as usize))
            .is_some_and(|t| t.name == "XLRICHVALUE")
    });
    let record = records.next()?;
    if records.next().is_some() {
        return None;
    }
    let mut groups = metadata
        .future_metadata
        .iter()
        .filter(|group| group.name == "XLRICHVALUE");
    let group = groups.next()?;
    if groups.next().is_some() {
        return None;
    }
    let raw = &group.blocks.get(record.v as usize)?.raw_xml;
    let fragment = parse_node(format!("<bk>{raw}</bk>").as_bytes())?;
    let mut refs = fragment
        .children("extLst")
        .flat_map(|list| list.children("ext"))
        .filter(|ext| {
            ext.attr("uri")
                .is_some_and(|uri| uri.eq_ignore_ascii_case(RICH_EXTENSION))
        })
        .flat_map(|ext| ext.children("rvb"));
    let reference = refs.next()?;
    if refs.next().is_some() {
        return None;
    }
    let value = values
        .children("rv")
        .filter(|n| n.namespace == RICH_NS)
        .nth(integer(reference, "i")?)?;
    let structure = structures
        .children("s")
        .filter(|n| n.namespace == RICH_NS)
        .nth(integer(value, "s")?)?;
    if structure.attr("t") != Some("_error") {
        return None;
    }
    let keys: Vec<_> = structure
        .children("k")
        .filter(|n| n.namespace == RICH_NS)
        .collect();
    let vals: Vec<_> = value
        .children("v")
        .filter(|n| n.namespace == RICH_NS)
        .collect();
    if keys.len() != vals.len() {
        return None;
    }
    let mut properties = std::collections::HashMap::new();
    for (key, value) in keys.iter().zip(&vals) {
        let name = key.attr("n")?.to_ascii_lowercase();
        if properties
            .insert(name, (key.attr("t").unwrap_or("d"), value.text.trim()))
            .is_some()
        {
            return None;
        }
    }
    let int_property = |name: &str| -> Option<i64> {
        let (kind, value) = properties.get(name)?;
        (*kind == "i").then(|| value.parse().ok()).flatten()
    };
    // MS-XLSX 2.3.6.1.3: only map errors representable by CellError.
    // Unknown rich types/codes remain opaque and retain the original value.
    // Excel also writes rich spill errors without offset properties (for example
    // the committed dynamic-array fixture B693). Detail fields do not determine
    // the displayed error identity; preserve them without blocking resolution.
    match int_property("errortype")? {
        4 => Some(CellError::Name),
        8 => Some(CellError::Spill),
        13 => Some(CellError::Calc),
        _ => None,
    }
}

pub(super) fn resolve_rich_errors(sheets: &mut [SheetData], metadata: &WorkbookMetadata) {
    let Some(rich) = &metadata.rich_data else {
        return;
    };
    let mut values = None;
    let mut structures = None;
    for part in &rich.parts {
        let Some(node) = parse_node(&part.data) else {
            continue;
        };
        // Imported rich-data parts may use any namespace prefix.
        if node.namespace != RICH_NS {
            continue;
        }
        match node.name.as_str() {
            "rvData" if values.is_none() => values = Some(node),
            "rvStructures" if structures.is_none() => structures = Some(node),
            "rvData" | "rvStructures" => return,
            _ => {}
        }
    }
    let (Some(values), Some(structures)) = (values, structures) else {
        return;
    };
    for cell in sheets.iter_mut().flat_map(|sheet| &mut sheet.cells) {
        if let (Some(vm), CellValue::Error(fallback, message)) = (cell.vm, &cell.value)
            && let Some(semantic) = resolve(metadata, vm, &values, &structures)
        {
            cell.imported_rich_error = Some(ImportedRichError {
                vm,
                semantic,
                fallback: *fallback,
            });
            cell.value = CellValue::Error(semantic, message.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain_types::{
        CellData, CellMetadataRecord, FutureMetadataBlock, FutureMetadataGroup, MetadataType,
        RichDataPart, ValueMetadataBlock, WorkbookRichData,
    };

    fn fixture(code: i32) -> (Vec<SheetData>, WorkbookMetadata) {
        let metadata = WorkbookMetadata {
            metadata_types: vec![MetadataType { name: "XLRICHVALUE".into(), ..Default::default() }],
            future_metadata: vec![FutureMetadataGroup { name: "XLRICHVALUE".into(), blocks: vec![FutureMetadataBlock { raw_xml: format!("<extLst><ext uri=\"{RICH_EXTENSION}\"><xlrd:rvb i=\"0\"/></ext></extLst>") }] }],
            value_metadata: vec![ValueMetadataBlock { records: vec![CellMetadataRecord { t: 1, v: 0 }] }],
            rich_data: Some(WorkbookRichData { parts: vec![
                RichDataPart { data: format!("<r:rvData xmlns:r=\"{RICH_NS}\"><r:rv s=\"0\"><r:v>0</r:v><r:v>{code}</r:v><r:v>1</r:v></r:rv></r:rvData>").into_bytes(), ..Default::default() },
                RichDataPart { data: format!("<rvStructures xmlns=\"{RICH_NS}\"><s t=\"_error\"><k n=\"colOffset\" t=\"i\"/><k n=\"ERRORtype\" t=\"i\"/><k n=\"rwOffset\" t=\"i\"/></s></rvStructures>").into_bytes(), ..Default::default() },
            ], ..Default::default() }),
            ..Default::default()
        };
        let sheets = vec![SheetData {
            cells: vec![CellData {
                value: CellValue::Error(CellError::Value, None),
                vm: Some(1),
                ..Default::default()
            }],
            ..Default::default()
        }];
        (sheets, metadata)
    }

    #[test]
    fn rich_error_resolver_supported_codes_preserve_fallback() {
        for (code, error) in [
            (4, CellError::Name),
            (8, CellError::Spill),
            (13, CellError::Calc),
        ] {
            let (mut sheets, metadata) = fixture(code);
            resolve_rich_errors(&mut sheets, &metadata);
            assert_eq!(sheets[0].cells[0].value, CellValue::Error(error, None));
            assert_eq!(
                sheets[0].cells[0].imported_rich_error,
                Some(ImportedRichError {
                    vm: 1,
                    semantic: error,
                    fallback: CellError::Value
                })
            );
        }
    }

    #[test]
    fn rich_error_resolver_spill_identity_does_not_require_detail_fields() {
        let (mut sheets, mut metadata) = fixture(8);
        let parts = &mut metadata.rich_data.as_mut().unwrap().parts;
        parts[0].data =
            format!("<rvData xmlns=\"{RICH_NS}\"><rv s=\"0\"><v>8</v><v>0</v></rv></rvData>")
                .into_bytes();
        parts[1].data = format!("<rvStructures xmlns=\"{RICH_NS}\"><s t=\"_error\"><k n=\"errorType\" t=\"i\"/><k n=\"subType\" t=\"i\"/></s></rvStructures>").into_bytes();
        let original_metadata = metadata.clone();
        resolve_rich_errors(&mut sheets, &metadata);
        assert_eq!(
            sheets[0].cells[0].value,
            CellValue::Error(CellError::Spill, None)
        );
        assert_eq!(
            sheets[0].cells[0].imported_rich_error.unwrap().fallback,
            CellError::Value
        );
        assert_eq!(metadata, original_metadata);
    }

    #[test]
    fn rich_error_resolver_keeps_unknown_or_invalid_metadata_opaque() {
        for code in [0, 2, 9, 18, 19, 100] {
            let (mut sheets, metadata) = fixture(code);
            let before = sheets.clone();
            resolve_rich_errors(&mut sheets, &metadata);
            assert_eq!(sheets, before);
        }
        for invalid in 0..6 {
            let (mut sheets, mut metadata) = fixture(8);
            match invalid {
                0 => sheets[0].cells[0].vm = Some(0),
                1 => metadata.value_metadata[0].records[0].t = 2,
                2 => metadata.value_metadata[0].records[0].v = 9,
                3 => metadata.future_metadata[0].blocks[0].raw_xml = "<extLst/>".into(),
                4 => {
                    let part = &mut metadata.rich_data.as_mut().unwrap().parts[1];
                    part.data = String::from_utf8(part.data.clone())
                        .unwrap()
                        .replace("ERRORtype", "unsupported")
                        .into_bytes();
                }
                5 => sheets[0].cells[0].value = CellValue::from(42.0),
                _ => unreachable!(),
            }
            let before = sheets.clone();
            resolve_rich_errors(&mut sheets, &metadata);
            assert_eq!(sheets, before);
        }
    }
}

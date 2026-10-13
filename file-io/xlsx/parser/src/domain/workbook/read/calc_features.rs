//! Calculation feature declarations, parsed independently of prefix spelling.
use quick_xml::{events::Event, name::ResolveResult, reader::NsReader};

pub fn parse_calculation_features(xml: &[u8]) -> Option<Vec<String>> {
    let mut reader = NsReader::from_reader(xml);
    let mut depth = 0usize;
    let mut extension = None;
    let mut ext_list = None;
    let mut seen_ext_list = false;
    let mut seen_root = false;
    let mut collection = None;
    let mut result = None;
    loop {
        let (ns, event) = reader.read_resolved_event().ok()?;
        match event {
            Event::Start(ref e) | Event::Empty(ref e) => {
                let empty = matches!(event, Event::Empty(_));
                depth += 1;
                let local = e.local_name();
                let main_ns = matches!(&ns, ResolveResult::Bound(n) if n.as_ref() == b"http://schemas.openxmlformats.org/spreadsheetml/2006/main");
                let calc_ns = matches!(ns, ResolveResult::Bound(n) if n.as_ref() == b"http://schemas.microsoft.com/office/spreadsheetml/2018/calcfeatures");
                if depth == 1 {
                    if seen_root || !main_ns || local.as_ref() != b"workbook" {
                        return None;
                    }
                    seen_root = true;
                }
                if main_ns && local.as_ref() == b"extLst" && depth == 2 {
                    if seen_ext_list {
                        return None;
                    }
                    seen_ext_list = true;
                    ext_list = Some(depth);
                } else if main_ns && local.as_ref() == b"ext" && ext_list == Some(depth - 1) {
                    for attr in e.attributes() {
                        let attr = attr.ok()?;
                        if attr.key.as_ref() == b"uri"
                            && attr.value.as_ref() == b"{B58B0392-4F1F-4190-BB64-5DF3571DCE5F}"
                        {
                            extension = Some(depth);
                        }
                    }
                } else if calc_ns
                    && local.as_ref() == b"calcFeatures"
                    && extension == Some(depth - 1)
                {
                    if result.is_some() {
                        return None;
                    }
                    result = Some(Vec::new());
                    collection = Some(depth);
                } else if calc_ns && local.as_ref() == b"feature" && collection == Some(depth - 1) {
                    let mut name = None;
                    for attr in e.attributes() {
                        let attr = attr.ok()?;
                        if attr.key.as_ref() == b"name" {
                            name = Some(attr.unescape_value().ok()?.into_owned());
                        }
                    }
                    result.as_mut()?.push(name?);
                }
                if empty {
                    if collection == Some(depth) {
                        collection = None;
                    }
                    if extension == Some(depth) {
                        extension = None;
                    }
                    if ext_list == Some(depth) {
                        ext_list = None;
                    }
                    depth -= 1;
                }
            }
            Event::End(_) => {
                if collection == Some(depth) {
                    collection = None;
                }
                if extension == Some(depth) {
                    extension = None;
                }
                if ext_list == Some(depth) {
                    ext_list = None;
                }
                depth = depth.checked_sub(1)?;
            }
            Event::Eof => return if depth == 0 { result } else { None },
            _ => {}
        }
    }
}

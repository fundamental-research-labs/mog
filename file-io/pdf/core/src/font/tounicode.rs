//! ToUnicode CMap builder.
use std::collections::BTreeMap;
use std::fmt::Write;

const MAX_BF_ENTRIES: usize = 100;

pub fn build_tounicode_cmap(codepoint_to_new_gid: &BTreeMap<u32, u16>) -> Vec<u8> {
    let mut gid_to_cp: BTreeMap<u16, u32> = BTreeMap::new();
    for (&cp, &gid) in codepoint_to_new_gid {
        gid_to_cp.insert(gid, cp);
    }
    let entries: Vec<(u16, u32)> = gid_to_cp.into_iter().collect();
    let (ranges, chars) = find_ranges(&entries);
    let mut cmap = String::with_capacity(1024);
    writeln!(cmap, "/CIDInit /ProcSet findresource begin").unwrap();
    writeln!(cmap, "12 dict begin").unwrap();
    writeln!(cmap, "begincmap").unwrap();
    writeln!(
        cmap,
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def"
    )
    .unwrap();
    writeln!(cmap, "/CMapName /Adobe-Identity-UCS def").unwrap();
    writeln!(cmap, "/CMapType 2 def").unwrap();
    writeln!(cmap, "1 begincodespacerange").unwrap();
    writeln!(cmap, "<0000> <FFFF>").unwrap();
    writeln!(cmap, "endcodespacerange").unwrap();
    if !ranges.is_empty() {
        for chunk in ranges.chunks(MAX_BF_ENTRIES) {
            writeln!(cmap, "{} beginbfrange", chunk.len()).unwrap();
            for &(sg, eg, sc) in chunk {
                writeln!(cmap, "<{:04X}> <{:04X}> {}", sg, eg, encode_unicode(sc)).unwrap();
            }
            writeln!(cmap, "endbfrange").unwrap();
        }
    }
    if !chars.is_empty() {
        for chunk in chars.chunks(MAX_BF_ENTRIES) {
            writeln!(cmap, "{} beginbfchar", chunk.len()).unwrap();
            for &(gid, cp) in chunk {
                writeln!(cmap, "<{:04X}> {}", gid, encode_unicode(cp)).unwrap();
            }
            writeln!(cmap, "endbfchar").unwrap();
        }
    }
    writeln!(cmap, "endcmap").unwrap();
    writeln!(cmap, "CMapName currentdict /CMap defineresource pop").unwrap();
    writeln!(cmap, "end").unwrap();
    write!(cmap, "end").unwrap();
    cmap.into_bytes()
}

fn find_ranges(entries: &[(u16, u32)]) -> (Vec<(u16, u16, u32)>, Vec<(u16, u32)>) {
    if entries.is_empty() {
        return (Vec::new(), Vec::new());
    }
    let mut ranges: Vec<(u16, u16, u32)> = Vec::new();
    let mut chars: Vec<(u16, u32)> = Vec::new();
    let mut i = 0;
    while i < entries.len() {
        let mut j = i + 1;
        while j < entries.len() {
            let (pg, pc) = entries[j - 1];
            let (cg, cc) = entries[j];
            if cg == pg + 1 && cc == pc + 1 {
                j += 1;
            } else {
                break;
            }
        }
        if j - i >= 2 {
            let (sg, sc) = entries[i];
            let (eg, _) = entries[j - 1];
            ranges.push((sg, eg, sc));
        } else {
            chars.push(entries[i]);
        }
        i = j;
    }
    (ranges, chars)
}

fn encode_unicode(cp: u32) -> String {
    if cp <= 0xFFFF {
        format!("<{:04X}>", cp)
    } else {
        let a = cp - 0x10000;
        format!("<{:04X}{:04X}>", 0xD800 + (a >> 10), 0xDC00 + (a & 0x3FF))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_unicode_bmp() {
        assert_eq!(encode_unicode(0x0041), "<0041>");
        assert_eq!(encode_unicode(0xFFFF), "<FFFF>");
    }

    #[test]
    fn test_encode_unicode_supplementary() {
        assert_eq!(encode_unicode(0x10000), "<D800DC00>");
        assert_eq!(encode_unicode(0x1F600), "<D83DDE00>");
        assert_eq!(encode_unicode(0x10FFFF), "<DBFFDFFF>");
    }

    #[test]
    fn test_build_tounicode_cmap_empty() {
        let map = BTreeMap::new();
        let cmap = build_tounicode_cmap(&map);
        let text = String::from_utf8(cmap).unwrap();
        assert!(text.contains("begincmap"));
        assert!(!text.contains("beginbfchar"));
    }

    #[test]
    fn test_build_tounicode_cmap_single_char() {
        let mut map = BTreeMap::new();
        map.insert(0x41u32, 1u16);
        let cmap = build_tounicode_cmap(&map);
        let text = String::from_utf8(cmap).unwrap();
        assert!(text.contains("<0001> <0041>"));
    }

    #[test]
    fn test_build_tounicode_cmap_range() {
        let mut map = BTreeMap::new();
        map.insert(0x41, 1u16);
        map.insert(0x42, 2u16);
        map.insert(0x43, 3u16);
        let cmap = build_tounicode_cmap(&map);
        let text = String::from_utf8(cmap).unwrap();
        assert!(text.contains("beginbfrange"));
        assert!(text.contains("<0001> <0003> <0041>"));
    }

    #[test]
    fn test_find_ranges_empty() {
        let (ranges, chars) = find_ranges(&[]);
        assert!(ranges.is_empty());
        assert!(chars.is_empty());
    }

    #[test]
    fn test_find_ranges_one_range() {
        let e = vec![(1u16, 0x41u32), (2, 0x42), (3, 0x43)];
        let (r, c) = find_ranges(&e);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0], (1, 3, 0x41));
        assert!(c.is_empty());
    }

    #[test]
    fn test_cmap_structure() {
        let mut map = BTreeMap::new();
        map.insert(0x41, 1u16);
        let cmap = build_tounicode_cmap(&map);
        let text = String::from_utf8(cmap).unwrap();
        assert!(text.contains("/CMapName /Adobe-Identity-UCS def"));
        assert!(text.contains("endcmap"));
    }
}

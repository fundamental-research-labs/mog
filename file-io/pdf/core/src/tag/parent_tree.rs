//! ParentTree number tree builder.
use crate::document::PdfDocument;
use crate::types::*;

/// Build the ParentTree number tree mapping MCID to StructElem reference.
pub fn build_parent_tree(doc: &mut PdfDocument, entries: &[(u32, PdfRef)]) -> PdfRef {
    let mut nums = Vec::new();
    let mut sorted: Vec<_> = entries.to_vec();
    sorted.sort_by_key(|e| e.0);
    for (mcid, elem_ref) in &sorted {
        nums.push(PdfValue::Integer(*mcid as i64));
        nums.push(PdfValue::Ref(*elem_ref));
    }
    let mut dict = PdfDict::new();
    dict.set("Nums", PdfValue::Array(nums));
    doc.add_object(PdfValue::Dict(dict))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::PdfDocument;

    #[test]
    fn test_empty_parent_tree() {
        let mut doc = PdfDocument::new();
        let r = build_parent_tree(&mut doc, &[]);
        let built = doc.build();
        let obj = built.objects.iter().find(|o| o.obj_ref == r).unwrap();
        if let PdfValue::Dict(ref d) = obj.value {
            let nums = d.get_array("Nums").unwrap();
            assert!(nums.is_empty());
        } else {
            panic!("bad");
        }
    }

    #[test]
    fn test_parent_tree_entries() {
        let mut doc = PdfDocument::new();
        let r1 = PdfRef::new(10, 0);
        let r2 = PdfRef::new(20, 0);
        let r = build_parent_tree(&mut doc, &[(0, r1), (1, r2)]);
        let built = doc.build();
        let obj = built.objects.iter().find(|o| o.obj_ref == r).unwrap();
        if let PdfValue::Dict(ref d) = obj.value {
            let nums = d.get_array("Nums").unwrap();
            assert_eq!(nums.len(), 4);
            assert_eq!(nums[0], PdfValue::Integer(0));
            assert_eq!(nums[1], PdfValue::Ref(r1));
            assert_eq!(nums[2], PdfValue::Integer(1));
            assert_eq!(nums[3], PdfValue::Ref(r2));
        } else {
            panic!("bad");
        }
    }

    #[test]
    fn test_parent_tree_sorted() {
        let mut doc = PdfDocument::new();
        let r1 = PdfRef::new(10, 0);
        let r2 = PdfRef::new(20, 0);
        let r = build_parent_tree(&mut doc, &[(5, r2), (2, r1)]);
        let built = doc.build();
        let obj = built.objects.iter().find(|o| o.obj_ref == r).unwrap();
        if let PdfValue::Dict(ref d) = obj.value {
            let nums = d.get_array("Nums").unwrap();
            assert_eq!(nums[0], PdfValue::Integer(2));
            assert_eq!(nums[2], PdfValue::Integer(5));
        }
    }
}

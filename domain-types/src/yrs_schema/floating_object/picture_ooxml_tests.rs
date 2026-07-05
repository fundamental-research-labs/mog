use yrs::{Doc, Map, MapPrelim, Transact};

use super::*;
use crate::domain::floating_object::{
    FloatingObject, FloatingObjectCommon, FloatingObjectData, PictureData,
    PictureEmbeddedMediaAuthority, PictureOoxmlProps,
};

fn yrs_roundtrip(obj: &FloatingObject) -> FloatingObject {
    let doc = Doc::new();
    let root = doc.get_or_insert_map("test");
    {
        let mut txn = doc.transact_mut();
        let entries = to_yrs_prelim(obj);
        let prelim: MapPrelim = entries.into_iter().collect();
        root.insert(&mut txn, "item", prelim);
    }
    let txn = doc.transact();
    let map_ref = root
        .get(&txn, "item")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    from_yrs_map(&map_ref, &txn).expect("floating object should hydrate")
}

#[test]
fn picture_embedded_media_authority_preserves_imported_payload_through_yrs() {
    let obj = FloatingObject {
        common: FloatingObjectCommon {
            id: "pic-embedded".to_string(),
            sheet_id: "sheet-1".to_string(),
            name: "Imported Picture".to_string(),
            ..Default::default()
        },
        data: FloatingObjectData::Picture(PictureData {
            src: "data:image/png;base64,AQIDBA==".to_string(),
            original_width: None,
            original_height: None,
            crop: None,
            adjustments: None,
            border: None,
            color_type: None,
            ooxml: Some(PictureOoxmlProps {
                image_path: Some("/xl/media/image1.png".to_string()),
                embedded_media: Some(PictureEmbeddedMediaAuthority {
                    relationship_id: "rId1".to_string(),
                    original_target: "/xl/media/image1.png".to_string(),
                    package_path: "xl/media/image1.png".to_string(),
                    content_type: Some("image/png".to_string()),
                    src: "data:image/png;base64,AQIDBA==".to_string(),
                }),
                ..Default::default()
            }),
        }),
    };

    let restored = yrs_roundtrip(&obj);
    let picture = match &restored.data {
        FloatingObjectData::Picture(picture) => picture,
        other => panic!("expected picture object, got {other:?}"),
    };
    let media = picture
        .ooxml
        .as_ref()
        .and_then(|ooxml| ooxml.embedded_media.as_ref())
        .expect("embedded media authority should round-trip");

    assert_eq!(media.relationship_id, "rId1");
    assert_eq!(media.original_target, "/xl/media/image1.png");
    assert_eq!(media.package_path, "xl/media/image1.png");
    assert_eq!(media.content_type.as_deref(), Some("image/png"));
    assert_eq!(media.src, picture.src);
}

use domain_types::domain::floating_object::*;
use domain_types::domain::floating_object::{FloatingObject, ShapeData};
use domain_types::{FloatingObject as RootFloatingObject, ShapeData as RootShapeData};

#[test]
fn floating_object_public_surface_keeps_existing_import_paths() {
    fn accepts_named(_: Option<FloatingObject>, _: ShapeData) {}
    fn accepts_glob(_: FloatingObjectCommon, _: FloatingObjectData) {}
    fn accepts_root(_: Option<RootFloatingObject>, _: RootShapeData) {}

    accepts_named(None, ShapeData::default());
    accepts_glob(
        FloatingObjectCommon::default(),
        FloatingObjectData::Shape(ShapeData::default()),
    );
    accepts_root(None, RootShapeData::default());
}

use super::tests::engine;
use domain_types::domain::hyperlink::HyperlinkTargetKind;

#[test]
fn hyperlink_updates_replace_target_representation_and_display_metadata() {
    let (mut engine, sid) = engine();
    for (url, kind, target, location, mode) in [
        (
            "Target!B2",
            HyperlinkTargetKind::InlineLocation,
            None,
            Some("Target!B2"),
            None,
        ),
        (
            "https://example.com/docs",
            HyperlinkTargetKind::Relationship,
            Some("https://example.com/docs"),
            None,
            Some("External"),
        ),
        (
            "#Target!B2",
            HyperlinkTargetKind::Relationship,
            Some("#Target!B2"),
            None,
            None,
        ),
    ] {
        engine.set_hyperlink(&sid, 0, 0, url).unwrap();
        let links = engine.get_hyperlinks(&sid);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target.as_deref(), target);
        assert_eq!(links[0].location.as_deref(), location);
        assert_eq!(links[0].target_kind, Some(kind));
        assert_eq!(links[0].target_mode.as_deref(), mode);
        assert_eq!(links[0].display.as_deref(), Some("42"));
    }
}

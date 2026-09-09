The semantic merge policy fixture is preserved byte-for-byte from
`f2edc3222^:contracts/src/versioning/semantic-merge-policy-manifest.fixture.json`.
Commit `f2edc3222` removed the TypeScript contracts during the headless-engine
split. The Rust contract test now owns the same independent fixture.

SHA-256: `f327a54c699792a37efae115c98497dd8f4254a9b3dc871c77d72f660bd02f22`.

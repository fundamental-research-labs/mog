Rating: 8/10

Summary judgment

This is a strong, production-aware plan. It correctly identifies `domain-types/src/domain/workbook` as a durable contract layer rather than a passive struct folder, and it ties the proposed work to the real XLSX import/export, `ParseOutput`, Yrs hydration/export, workbook XML fidelity, and sheet package inventory paths. The plan is much better than a local cleanup plan: it aims to make workbook field coverage executable and systematic.

The score is not higher because several central decisions are still left as design options rather than specifications. In particular, the plan calls for a workbook contract inventory and a modeled presence/provenance layer, but it does not fully define their storage shape, public API shape, migration constraints, or how they will be prevented from becoming another hand-maintained schema that can drift.

Major strengths

- The source and adjacent production-path survey is accurate and specific. It correctly calls out workbook properties, calculation settings, views, protection, file version/sharing, web publishing, identity metadata, sheet inventory, OOXML conversions, parser/writer modules, Yrs schemas, compute hydration, and export.
- The architectural direction fits the repo: keep package/archive reading in `xlsx-parser`, keep durable workbook contracts in `domain-types`, avoid `domain-types` dependencies on compute/internal code, and keep `WorkbookXmlFidelity` responsible for direct-child ordering and inert raw payloads.
- The plan focuses on complete categories rather than one-off fixes. Field inventories, enum token tables, validation APIs, storage coverage tests, and parser/writer round-trip fixtures are the right systematic remedies for this folder.
- The plan correctly highlights real production risks: default canonicalization, `WorkbookView::ext_lst_raw` being skipped by serde, `date1904` as an existing Yrs sentinel, calc-chain export policy, sensitive protection/sharing fields, and relationship-bearing raw XML.
- The verification section includes relevant Rust crates and production-flow tests, including parser/writer, Yrs hydration/export, compute export, package fidelity, and security/fidelity behavior.

Major gaps or risks

- The contract inventory is underspecified. A table of field rows could itself become duplicated schema knowledge unless the plan defines compile-time coupling to struct fields, enum variants, Yrs key constants, and writer policies. "Use the inventory to drive tests first" is good, but not enough to guarantee drift detection.
- The presence/provenance model is still a menu of options. For implementation, the plan needs to choose the exact sidecar owner, serialization shape, versioning strategy, Yrs behavior, and edit invalidation rules. Without that, workstreams B/C/D cannot safely compose.
- The validation API is conceptually right but too broad. It should specify error/warning identity, stable diagnostic codes, severity, redaction rules, context fields, and whether parse/export callers warn, drop, canonicalize, or fail for each class.
- Workbook identity remains a decision task, not a contract. The plan says to add adapters only if needed or mark identity inactive, but it does not give an acceptance criterion for deciding. That makes this slice less executable than the workbook metadata and inventory slices.
- Sequencing is mostly sensible, but the first step may be too large. A complete field inventory plus tests plus public re-exports could touch enough crates that the plan should define a minimal stable inventory API first, then require downstream routing only after the inventory tests prove coverage.
- Some verification gates are named by broad filters rather than exact package/test targets and expected assertions. The plan should be clearer about which gates are compile-only/unit gates, which are production parser/writer round trips, and what XML/Yrs outputs must be asserted.

Contract and verification assessment

Contract clarity is high for what must be covered: the plan enumerates the modeled children, field counts, enum token surfaces, Yrs maps, writer emission policies, sheet inventory invariants, security-sensitive fields, and fidelity ownership boundaries. It also preserves key existing contracts such as camelCase serde names, `date1904` sentinel behavior, calc-id canonicalization, and the `WorkbookXmlFidelity` owner model.

The weaker part is the executable contract mechanism. The plan does not yet define whether the field inventory is public or crate-private, how downstream crates refer to it without leaking parser concerns into `domain-types`, how optional/default/presence states are encoded, or how table completeness is checked when a struct field or enum variant is added. Those details are essential because the plan's main goal is to replace ad hoc confidence with verifiable contracts.

Verification coverage is directionally strong. The proposed gates hit `domain-types`, `xlsx-parser`, `compute-document`, and compute export, and the additional behavior gates are production-path relevant. To be fully actionable, the plan should specify exact fixture cases and assertions for explicit default preservation, unsafe `extLst` omission, Yrs storage coverage, inventory diagnostics, and workbook XML child ordering.

Concrete changes that would raise the rating

- Pick one presence/provenance representation and specify its Rust types, serde/Yrs storage, versioning, edit invalidation, and writer disposition enum before assigning parser and writer workstreams.
- Define the contract inventory API precisely, including row identifiers, compile-time enum coverage checks, field-count checks, Yrs policy values, writer policy values, validation category values, and whether downstream crates can depend on it.
- Add an acceptance matrix for every modeled workbook child: import source, `ParseOutput` field, Yrs storage policy, edit invalidation behavior, export behavior, diagnostics, and exact tests.
- Split validation into stable diagnostic contracts with examples: warning vs error, redacted payloads for protection/sharing fields, and parse/export action for each validation class.
- Make the identity section executable by deciding whether XLSX embedded Mog identity is active in the current production path, then specifying either adapter tests or an explicit inactive-contract test.
- Tighten the verification gates with exact test names or new test modules and expected assertions, especially for explicit default attributes, view `extLst` safety, empty/default `webPublishing`, and sheet inventory relationship/content-type mismatch diagnostics.

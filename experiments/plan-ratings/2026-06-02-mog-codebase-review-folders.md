# Mog Codebase Review Folder Queue

Curated on 2026-06-02 from four parallel explorer subagent slices: public core/API, UI/runtime/canvas, file-IO/charts/drawing, and public tooling/release surfaces. Every path below is an existing folder under the public `mog` repo; sibling repos, generated outputs, dependency installs, and build artifacts are intentionally excluded.

1. `mog/contracts/src/api` - Public workbook and worksheet API contracts.
2. `mog/contracts/src/runtime` - Runtime-facing lifecycle and host integration contracts.
3. `mog/contracts/src/security` - Capability, trust, and permission contract definitions.
4. `mog/contracts/runtime-services/src` - Service contracts shared across runtime and kernel layers.
5. `mog/types/api/src` - Published API type package with downstream compatibility risk.
6. `mog/types/app-platform/src` - App and plugin platform extension contracts.
7. `mog/types/bridges/src` - Cross-layer bridge schemas and handoff types.
8. `mog/types/data/src` - Data, chart, table, and workbook domain types.
9. `mog/kernel/src/api` - Main kernel API implementation and behavior gateway.
10. `mog/kernel/src/document` - Document lifecycle, providers, persistence, and ownership.
11. `mog/kernel/src/document/collab` - Collaboration and CRDT consistency path.
12. `mog/kernel/src/bridges/compute` - Kernel-to-compute integration boundary.
13. `mog/kernel/src/domain/cells` - Core cell value, reference, and range semantics.
14. `mog/kernel/src/domain/formulas` - Formula-facing kernel state and reference behavior.
15. `mog/kernel/src/domain/charts` - Chart domain bridge, ownership, and resolved-spec logic.
16. `mog/kernel/src/domain/formatting` - Formatting semantics shared by UI, compute, and file IO.
17. `mog/kernel/src/domain/pivots` - Pivot table domain behavior and state transitions.
18. `mog/kernel/src/domain/tables` - Table domain, structured refs, filtering, and sorting.
19. `mog/kernel/src/floating-objects` - Anchoring and projection for charts, shapes, and images.
20. `mog/kernel/src/services/undo` - Undo and redo invariants across domains.
21. `mog/kernel/src/services/clipboard` - Clipboard, paste, import, and format transfer behavior.
22. `mog/kernel/src/security` - Kernel-side capability and protection enforcement.
23. `mog/compute/api/src` - Rust compute API boundary for workbook and sheet operations.
24. `mog/compute/core/src/eval` - Production formula evaluation engine path.
25. `mog/compute/core/src/scheduler` - Recalculation scheduling and dependency execution.
26. `mog/compute/core/src/storage` - Workbook, sheet, and cell storage invariants.
27. `mog/compute/core/src/import` - Import-to-snapshot conversion and ingest correctness.
28. `mog/compute/core/src/identity` - Cell, range, and document identity rules.
29. `mog/compute/core/crates/compute-functions/src` - Excel-compatible function catalog and parity surface.
30. `mog/compute/core/crates/compute-parser/src` - Formula parser, normalization, and reference grammar.
31. `mog/compute/core/crates/compute-graph/src` - Dependency graph mutation and query correctness.
32. `mog/compute/core/crates/compute-table/src` - Table compute, filters, and structured references.
33. `mog/compute/core/crates/compute-pivot/src` - Pivot engine aggregation and layout semantics.
34. `mog/compute/core/crates/compute-fill/src` - Autofill inference and sequence behavior.
35. `mog/compute/core/crates/compute-formats/src` - Number, date, and locale format parsing/rendering.
36. `mog/compute/core/crates/compute-cf/src` - Conditional formatting evaluation and rule coverage.
37. `mog/compute/core/crates/compute-wire/src` - Mutation serialization and wire protocol correctness.
38. `mog/compute/core/crates/compute-security/src` - Compute-side policy enforcement.
39. `mog/compute/wasm/src` - Browser compute bindings and wasm boundary.
40. `mog/compute/napi/src` - Node/server compute bindings.
41. `mog/canvas/grid-renderer/src` - Core grid rendering, viewport, and hit-test implementation.
42. `mog/canvas/grid-canvas/src` - Grid canvas orchestration and renderer integration.
43. `mog/canvas/engine/src` - Shared canvas loop, scheduling, GPU, and input state.
44. `mog/canvas/overlay/src` - Selection, drag, and overlay rendering behavior.
45. `mog/canvas/spatial/src` - Spatial indexing and hit-test pipeline.
46. `mog/canvas/drawing-canvas/src` - Drawing layer scene, renderer, and hit-testing.
47. `mog/canvas/drawing/engine/src` - Drawing object layout, grouping, z-order, and rendering.
48. `mog/canvas/drawing/shapes/src` - Shape geometry and preset fidelity coverage.
49. `mog/canvas/drawing/geometry/src` - Geometry primitives used by drawing and hit-testing.
50. `mog/charts/src/core` - Chart IR, config conversion, and style resolution.
51. `mog/charts/src/grammar` - Chart grammar compiler, layout, and marks pipeline.
52. `mog/charts/src/primitives` - Chart rendering primitives, scales, and renderer integration.
53. `mog/charts/src/export/ooxml` - Chart OOXML export fidelity.
54. `mog/file-io/xlsx/parser/src` - XLSX parser, reader, writer, and roundtrip path.
55. `mog/file-io/xlsx/bridge/src` - TypeScript/browser bridge to the XLSX parser.
56. `mog/file-io/ooxml/types/src` - OOXML schema and type mapping.
57. `mog/file-io/print-export/src` - Print, PDF, and exported layout pipeline.
58. `mog/runtime/embed/src` - Public embed runtime, iframe, React, and web component paths.
59. `mog/runtime/sdk/src` - Public SDK surface and generated API integration.
60. `mog/runtime/spreadsheet-app/src` - Packaged spreadsheet app runtime.
61. `mog/apps/spreadsheet/src/actions/handlers` - User command handlers and mutation dispatch.
62. `mog/apps/spreadsheet/src/coordinator` - Spreadsheet state and mutation coordinator.
63. `mog/apps/spreadsheet/src/systems/grid-editing` - Production UI editing workflows and input coordination.
64. `mog/apps/spreadsheet/src/components/grid` - Main grid UI component tree.
65. `mog/apps/spreadsheet/src/chrome/formula-bar` - Formula bar editing and display path.
66. `mog/shell/src/platform` - Shell platform abstraction and lifecycle conformance.
67. `mog/shell/src/services` - Shell document, project, capability, and recovery services.
68. `mog/views/sheet-view/src` - Public sheet-view substrate and capability surface.
69. `mog/infra/rust-bridge/bridge-ir/src` - Rust bridge intermediate representation and codegen contract.
70. `mog/infra/transport/src` - Bridge transport abstraction across hosts.
71. `mog/contracts/src/core` - Foundational cell, range, identity, and command contracts.
72. `mog/contracts/src/bridges` - Bridge-facing TypeScript contracts across public surfaces.
73. `mog/contracts/src/rendering` - Renderer-facing state and viewport contracts.
74. `mog/types/core/src` - Canonical spreadsheet primitives consumed by public packages.
75. `mog/types/document/src` - Document, filesystem, storage, and security type contracts.
76. `mog/types/host/src` - Trusted and untrusted host boundary contracts.
77. `mog/types/objects/src` - Floating object, drawing, ink, and equation contracts.
78. `mog/domain-types/src/domain/workbook` - Persistent workbook domain models and schema mapping.
79. `mog/domain-types/src/domain/drawings` - Persistent drawing domain models and schema mapping.
80. `mog/kernel/src/bridges/wire` - Kernel wire bridge and mutation projection boundary.
81. `mog/kernel/src/domain/sheets` - Sheet lifecycle, structure, visibility, and metadata rules.
82. `mog/kernel/src/domain/drawing` - Kernel drawing object domain behavior.
83. `mog/kernel/src/services/protection` - Workbook and worksheet protection enforcement services.
84. `mog/kernel/src/services/query-executor` - Query execution service boundary and result behavior.
85. `mog/compute/core/src/solver` - Goal seek, solver, and what-if calculation support.
86. `mog/compute/core/src/what_if` - Scenario and what-if analysis compute behavior.
87. `mog/compute/core/crates/compute-charts/src` - Native chart computation and transform logic.
88. `mog/compute/core/crates/compute-chart-render/src` - Native chart rendering engine surface.
89. `mog/compute/pyo3/src` - Python compute binding and packaging surface.
90. `mog/apps/spreadsheet/src/app` - App composition and coordinator wiring.
91. `mog/apps/spreadsheet/src/actions/commands` - Command registry and built-in command contracts.
92. `mog/apps/spreadsheet/src/domain/clipboard` - Copy/paste parsing, serialization, and system bridge.
93. `mog/apps/spreadsheet/src/domain/editor` - Cell and formula editor state behavior.
94. `mog/apps/spreadsheet/src/hooks/grid-mouse` - Pointer, drag, and context-menu input paths.
95. `mog/apps/spreadsheet/src/components/canvas-overlays` - DOM overlay alignment and interactive controls.
96. `mog/apps/spreadsheet/src/chrome/toolbar` - Ribbon command surface and contextual tools.
97. `mog/apps/spreadsheet/src/systems/input` - Input actor machines and event coordination.
98. `mog/apps/spreadsheet/src/systems/renderer` - Renderer actor coordination, subscriptions, and view sync.
99. `mog/shell/src/host` - App slot lifecycle, error boundaries, and host hooks.
100. `mog/fixtures/external` - Consumer package boundary fixtures that catch public API leakage.

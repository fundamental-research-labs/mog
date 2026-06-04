Rating: 8/10

Summary judgment

This is a strong plan for a contract-boundary folder. It correctly treats `mog/contracts/src/security` as the public facade over a Rust-first production path, identifies several real drift hazards, and gives implementation agents a useful set of invariants and verification gates. The rating is not higher because the plan leaves the central canonical-ownership decision unresolved and misses one important existing contract mismatch: TypeScript policy targets allow wildcard IDs through `TargetMatcher`, while the shipped Rust policy wire type stores concrete `AccessTarget` values and the public docs say wildcard target IDs are reserved/not shipped.

Major strengths

- The scope is well calibrated: it includes `types/document`, `types/api`, Rust `compute-security` serde, kernel bridge forwarding, SDK generation, events, and public docs, while keeping capability gates, host trust, and UI prompts out of direct ownership.
- The plan is production-path relevant. It focuses on the real `WorkbookSecurityImpl -> ComputeBridge.wbSecurity* -> compute-security` path instead of local TS helper behavior.
- It catches high-impact contract drift: duplicate `contracts/src/security/types.ts`, stale `AccessExplanation`, TS-only `metadata.description`, loose `updatePolicy` typing, non-UUID fallback `PolicyId` generation, and principal/session semantics.
- The verification strategy is much better than typecheck-only. Cross-language fixture tests, Rust serde checks, SDK generation checks, and a public SDK integration gate are the right shape for this folder.
- The plan preserves security architecture boundaries: workbook data policy, host principal verification, and app/runtime capabilities remain separate trust surfaces.

Major gaps or risks

- The canonical-source question is left as "decide whether" instead of being specified. Because `@mog-sdk/types-document` is a lower-tier package and `@mog-sdk/contracts` already depends on it and on `@mog/types-api`, moving canonical declarations into `contracts` would need an explicit package-DAG change. Without a firm decision, parallel agents could produce incompatible import rewrites.
- The target wildcard mismatch is not handled. Current TS `AccessPolicy.target` is `TargetMatcher`, permitting `{ sheetId: '*' }` and `{ colId: '*' }`, but Rust `AccessPolicy.target` is concrete `AccessTarget`, and docs warn not to send wildcard target IDs. The plan says to preserve `TargetMatcher` wildcard IDs, which risks codifying a public contract that production serde does not accept.
- "Use `@mog-sdk/contracts/security` rather than deep `@mog-sdk/types-document/security/*` imports where dependency direction allows" is directionally right but underspecified. `types/document` and likely `types/api` cannot import `contracts` without creating cycles under the current package graph.
- Session principal semantics are framed as a decision rather than a contract. For a security surface, the plan should state whether initialization is awaited/fail-closed, or explicitly define the fail-open anonymous behavior as the product contract.
- The verification gates omit the existing contracts build/declaration checks that are especially relevant here, such as the package build path that runs declaration identity, runtime export, runtime inventory, and runtime import checks.

Contract and verification assessment

The plan is strongest on `AccessExplanation`, metadata, `PolicyId`, and patch-contract alignment. Those are concrete, verifiable, and backed by production code. The proposed shared JSON fixtures should pin `AccessPolicy`, `AccessPolicyPatch`, `PolicyMetadata`, `AccessExplanation`, `AmbiguityWarning`, and `SecurityEvent` casing exactly, including the snake_case fields Rust emits where the bridge does not convert them.

The contract suite should also include negative/edge fixtures: wildcard target IDs rejected or formally unsupported, invalid `PolicyId` strings rejected, `metadata.description` persisted or dropped by explicit design, empty patches accepted or rejected, and `null` principal versus `{ tags: [] }` behavior. The final SDK integration gate is necessary and should exercise the actual public session path, not a direct bridge shortcut.

Concrete changes that would raise the rating

1. Choose the canonical ownership model in the plan. The likely low-risk version is: `types/document/src/security` remains the lower-tier source of truth, `contracts/src/security` is the public facade, and `contracts/src/security/types.ts` becomes a re-export shim plus drift tests.
2. Add an explicit target-contract task: either change `AccessPolicy.target` to concrete `AccessTarget` and reserve `TargetMatcher` for future/non-wire matching, or implement wildcard target support in Rust, bridge serde, enforcement, docs, and fixtures in the same workstream.
3. Replace the generic import-boundary guidance with a package-by-package import matrix showing which packages may import `@mog-sdk/contracts/security`, which must stay on lower-tier types, and which generated docs should expose the public facade.
4. Make principal initialization deterministic in the specification: synchronous only versus async-capable, `null` versus empty tags, and whether workbook APIs are usable only after an awaited principal install.
5. Add `pnpm --filter @mog-sdk/contracts build` or the exact repo gate that runs declaration identity/export/import checks, plus fixture checks for generated SDK docs.
6. Include concrete fixture JSON examples or a schema table for `AccessExplanation` and `SecurityEvent` so implementation agents do not infer field casing independently.

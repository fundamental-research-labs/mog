Rating: 6/10

Summary judgment

This is a strong source audit with the right production-path instincts: it identifies real bugs in `ws-sidecar.ts` around inbound pulls, absent periodic retry, resume lineage, decode hardening, reconnect jitter, and presence re-publication. The plan is much better than a vague cleanup proposal because it names invariants, line-level evidence, tests, and cross-folder protocol dependencies.

The rating is held down by one serious contract error: the proposed client-only `lastServerSv = localSv` fallback after an inbound `PULL_RESPONSE` is not safe when the client has unacknowledged local updates. A local state vector after applying a server diff includes local-only clocks the server may not have. Treating that vector as the server's acknowledged vector can make future `syncDiff(lastServerSv)` skip those local edits, which is exactly the kind of silent divergence this plan is supposed to prevent. The plan recognizes "under-push" as a risk, but its rationale says local-only ops cannot be dropped; that is false for concurrent local edit plus inbound pull interleavings.

Major strengths

- The plan correctly maps the folder's production role: browser sidecar, wire codec, event log, and the relevant tests/consumers.
- The main defect inventory matches the current source: `PULL_RESPONSE` applies without advancing `lastServerSv`, there is no periodic timer despite the comments, resume only validates `roomId`, `handleMessage` decodes without a guard, reconnect delay is deterministic, and presence is cleared after send.
- It treats wire compatibility as a real contract and avoids changing message opcodes or binary framing.
- It calls out `flushAndDetach` as a durability contract rather than just another close path.
- The proposed test matrix covers the right observable behaviors: echo suppression, retry after dropped ack, resume lineage rejection, decode resilience, presence replay, and final-flush durability.

Major gaps or risks

- The `lastServerSv` invariant is mis-specified. It should represent what the server is known to have, not the union of what the local replica now has after applying an inbound diff. The safe client-only fallback is to use an authoritative server vector already carried by the nudge, or require `coordinatorSv` on `PULL_RESPONSE`; it is not safe to substitute the local post-apply vector.
- The plan says all edits are within `mog/kernel/src/document/collab`, but resume-time `ROOM_CHANGED_REFETCH` is a consumer/lifecycle contract. The host first-join path retries this error during initial creation, but a long-lived sidecar reconnect rejection needs an explicit recovery path, status/error surface, and re-snapshot/re-attach ownership.
- The server and compute locations are described imprecisely. `compute/core` exists in the public repo, and the server wire implementation exists in `mog-internal/runtime/server`. That matters because `RESUME_RESPONSE` currently does not carry epoch/hash and `PULL_RESPONSE` currently sends `{}` metadata; these are not just optional client fields.
- Step 3's "client-only fallback" for resume lineage is weak because the client-side meta type includes `roomEpoch?: number`, but the server response shape does not actually send it. Comparing an absent optional field does not validate lineage.
- The scope section says tests are "read for context; not modified by this plan", while the verification section requires adding tests under `__tests__`. That contradiction makes implementation ownership unclear.
- The plan names a "collab vitest suite", but `kernel/package.json` uses Jest. Verification commands need to be exact enough for implementers to run the right gate.

Contract and verification assessment

The contract section is mostly valuable, especially wire byte identity, serial apply ordering, bootstrap lineage, self-presence filtering, and final-flush durability. The weakest contract is `lastServerSv`: the plan should state that it is the server-acknowledged state vector, and it may only be advanced from server-provided vectors or from local push acknowledgements. Advancing it from local state is only safe after proving the server has every local clock covered by that vector.

Verification coverage is broad, but it needs sharper gates. The most important missing test is a three-step interleave: B makes a local edit whose push is delayed or unacked, A's edit reaches B via nudge/pull, B applies that inbound diff, then B must still push its local edit and both replicas must converge. This test would fail the unsafe `lastServerSv = localSv` fallback. The plan should also require server-side wire-format tests for any added `coordinatorSv`, `roomEpoch`, `fullStateHash`, or `snapshotToken` fields, plus a Jest command/pattern for the kernel collab tests and the kernel typecheck.

Concrete changes that would raise the rating

- Replace the `lastServerSv = localSv` fallback with a server-authoritative vector strategy: use `BROADCAST_NUDGE`'s binary coordinator SV for nudge-driven pulls, add optional `coordinatorSv` to `PULL_RESPONSE`, and never mark local-only clocks as server-acknowledged.
- Make resume lineage a paired client/server/lifecycle change, or explicitly defer it until `RESUME_RESPONSE` carries `roomEpoch`, `fullStateHash`, and `snapshotToken` and the host can recover by refetching.
- Resolve the test-scope contradiction by allowing focused edits under `kernel/src/document/collab/__tests__`.
- Replace "collab vitest suite" with exact Jest/typecheck gates, for example the kernel collab Jest pattern plus `pnpm --filter ./kernel typecheck`.
- Add the local-unacked-plus-inbound-pull interleaving test as a must-pass acceptance criterion before any echo-suppression or `lastServerSv` change can land.

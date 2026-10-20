# Reverse engineering and regression audit — 20 October 2026

Base: main `17efeb812d437ad0dcf3b61e7f91b7178844e041`.
Work branch: `codex/reverse-debug-20261020`.
Scope includes the reported first-login failure and shaking customer interface.

## Reconstructed boundaries

| Flow | Authoritative state and recovery |
| --- | --- |
| OAuth → profile → role entry | One PKCE exchange; verified profiles determine roles; partner-entry RPC determines the destination. Staff MFA remains a server and UI boundary. |
| Addresses → carrier offer → request | Debounced route quote; only a valid server quote can be booked. Route input, expiry, carrier availability and idempotency keys guard submission. |
| Company → available driver | Company-scoped availability, offers and server acceptance; a private driver topic signals changes, with bounded HTTP reconciliation. |
| Accepted → arrived → in progress → terminal | Realtime events and HTTP reads merge monotonically. A terminal per-ride snapshot must also guard an initially empty active-ride cache. |
| GPS → driver/customer maps | Shared GPS owner, freshness checks, independent marker animation and bounded routing. Changing a leg or ending a trip cancels obsolete transport. |
| Checkout → receipt → company accounts | Existing idempotent payment RPC and confirmed receipt remain authoritative. No automatic financial replay was added. |
| Inbox/push → current recipient | Existing personal/role scope, server RLS and service-worker recipient binding remain in force. |

## Proven failures and fixes

1. **Original route A → B → A could leave ordering permanently disabled.**
   A successful key was retained while its quote was cleared. Keep the previous
   quote behind the existing input gate, stop the spinner when returning to it,
   and clear its key when a different route fails. Ordering stays disabled during
   recalculation. No extra route purchase is needed for a valid return to A.
2. **A slow driver read could revive a completed/cancelled ride.** Both the starting
   and current active cache could be null, hiding the intervening terminal event.
   The existing per-ride snapshot now defeats that stale active result without an
   additional database read. A newer unrelated active ride still wins.
3. **Obsolete route requests continued after a leg change or unmount.** The shared
   driving hook now passes an AbortSignal and aborts on cleanup and its 20-second
   deadline. GPS movement alone does not cancel useful work. The customer's
   context route is also aborted when tracking ends.
4. **Rejoining the same driver's scope could claim to be connected prematurely.**
   Reset the socket state until the new private subscription acknowledges joining;
   bounded fallback reads remain enabled while it reconnects.
5. **First-login legal acceptance failure stranded the callback.** Production
   logs show a new customer created at 20:03:47 UTC with a profile, followed by a
   401 on `accept_legal_versions` at 20:03:48.774; the same session's later call
   succeeded. This identifies the failed stage, not the server's underlying 401
   cause. Preserve the response status; retry only this idempotent completion
   step, at most twice after 400/1200 ms, for 401/5xx/network/deadline failures.
   Check account ownership before retrying. Persistent errors expose an in-place
   retry using the saved session, never a second exchange of the consumed code.
   Other authorization failures stay errors; the specific staff-MFA handoff remains.
6. **Duplicate map chrome measurements restarted camera fitting.** Ignore identical
   map dimensions/padding while retaining real endpoint, route and layout changes.
7. **Mobile resize/scroll bursts repeatedly wrote layout styles.** Coalesce these
   events into one animation frame, round viewport dimensions, skip unchanged
   writes and clamp negative overscroll. Keyboard placement and accessible zoom
   remain covered. Physical-device shaking is not fully diagnosed by emulation.

The first four defects were reproduced in the red test-only commit
`c78ab77b86c1d401196cf93f5fe21fefe7895e24`: 7 failures, 687 passes.
The new callback/map tests reproduced another 3 failures before their fixes;
the viewport test reproduced 20 style writes for a 10-event burst.

## Validation and size

- Local lint, typecheck and production build passed; 700 unit tests passed.
- Browser regressions cover first OAuth login from no saved session, temporary
  401 recovery, bounded persistent failure and retry, no second code exchange or
  logout, one welcome, route reversal, viewport bursts and terminal route abort.
- Existing native Supabase tests remain the gate for company isolation, real
  Auth/MFA, competing acceptance, payment idempotency, receipts and welcome claims.
- Current measured JavaScript graph: initial 660,016 bytes / 210,198 gzip;
  booking plus initial 757,330 bytes / 244,697 gzip. Compared with the prior audit:
  +300 / +133 bytes initially, +594 / +279 for booking. External Google Maps is
  excluded. No dependency, polling loop or realtime channel was added.
- This package requires no database migration and changes no production records
  or security/payment flags. The public site was verified on the preceding
  `2026.10.20-launch-audit.1` release during this audit.

## Explicit limits / open items

- The original first-login 401's backend cause is not present in the retrieved
  logs. The client now recovers from the reproduced failure rather than requiring
  a logout; monitor recurrence after publication.
- 21 legacy Auth entries lack profile rows. All were created on 13 August 2026;
  none is the new customer or was created in the last week. They were not silently
  recreated, since that could reinstate intentionally removed access. Review their
  provenance separately before an account repair.
- Physical iPhone/Android keyboard, map gestures, reconnect and PWA background
  behavior still need a real-device pass. A browser fixture does not prove Google
  Maps rendering, OS push delivery or continuous background location.
- The previous launch audit's real operator/company setup, legal review, stale
  ride review, extension-owner advisor and backup/restore prerequisites remain.
  This audit does not certify that every possible defect is excluded.
- After the checked main package is ready, Readdy requires **Pull from GitHub →
  Publish**; a main push by itself does not replace the public frontend.

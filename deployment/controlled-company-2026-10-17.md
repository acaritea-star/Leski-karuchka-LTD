# Controlled candidacy and card evidence — 17 October 2026

## Scope

Extend the existing system: no payment processor, dependency, financial model,
polling, notification channel or automatic commission deduction is introduced.

- Firms opt into `accepts_driver_applications`; it defaults false for every
  existing firm. An open firm must keep document checks enabled. Draft/inactive
  firms and firms without a configured positive kilometre price are not offered.
- A signed-in customer with a confirmed Auth email can select an open firm.
  Selection only reads eligibility. The existing application RPC saves the
  candidacy; training, documents, company review and driver activation stay intact.
  Other firms retain their named invitation workflow. Staff cannot move between
  firms through this customer-only entry point. A pending application resumes
  after closing new candidacy; another firm's pending application is not replaced.
- The selector loads only on the driver access page without a named invitation,
  reads at most 50 firms and rechecks the selected firm's state on the server.
  A closed firm cannot accept a new application even from an already-open form.
- Company administrators retain control over their firm's rates. Drivers cannot
  edit them. All firms' prices must be finite and non-negative and their radius
  positive; the database rejects direct-API negative/NaN values as well as the UI.
  Zero/flat legacy tariffs are retained. No existing rate is rewritten.
  Tariff and candidacy changes append exact old/new values and actor
  to the existing company-scoped audit log. Ride fare snapshots remain unchanged.
- Card receipts cannot be newly confirmed, or confirmed receipts corrected,
  using a cash count/cash book. Require a payment record or terminal document
  with a reference. This is enforced in the shared financial core, including
  the legacy verified RPC. Historical records are not rewritten; exact retries
  of previously committed operations remain valid after MFA/ownership checks.

## Preparing the requested firm

The global schema migration creates no firm or privileged user. Provision the
requested real business separately in one transaction: lock the exact confirmed
Auth identity and active unassigned CUSTOMER profile, verify no driver/pending
application/accepted partner process, create one inactive draft with document
checks and open candidacy enabled, bind COMPANY_ADMIN only and append an audit
event. Abort on an existing slug, changed identity or any competing affiliation.
Never downgrade a staff account or reuse another firm's drivers.

The owner completes the existing company setup with real legal details, city,
permit and exact rates. No rates, legal identity, permit or verification may be
invented. The draft takes no bookings and is absent from the candidate selector.
The normal staff MFA requirement applies when the owner signs in. Provisioning
does not send an invitation email or create financial records.

## Verification and release

Migration scaffold: `20261017055440_controlled_driver_applications_and_card_evidence.sql`.
Keep the filename aligned with the actual production migration version after
deployment. Run Check and Database regression on the final GitHub PR head.

New regression cases cover customer identity, fake editable email, draft/closed
firms, closure during a form, no premature driver privileges, duplicate/resumed
applications, company/driver tariff permissions, mandatory documents and exact
company audit values. Financial tests cover wrong cash evidence through both RPC
generations, rollback without partial posting, valid referenced card verification
and retry, and rejection of a cash-based correction. Browser cases exercise the
mobile selector, company selection recheck, closure during submission, account
switches, server application recovery and transition after approval.

Apply the tested additive database migration, then publish the matching frontend
through Readdy. Verify the public release identity; GitHub main alone does not
prove frontend publication. The existing ride-payment completion gate must remain
staged until a frontend containing that checkout is actually public.

For frontend rollback, keep the additive column, audit history and financial
evidence check. Closing `accepts_driver_applications` stops new candidacy without
deleting applications, receipts, financial entries or files. Restore a matching
frontend; never erase real financial history to undo an application release.

Production schema applied as migration `20261017055440`. SQL SHA-256: `6c63b87cc50519e76dce7dd40c27581cba6e3dfc4cfb35a6fa6d04383537faac`.
All five deployed function bodies match the tested source, both constraints are
validated, anonymous access to the new RPC is denied and staff MFA remains on.
The implementation Check (39007341441: 628 unit/component and 138 browser cases)
and Database regression (39007341413: complete SQL/Auth/Storage/concurrency suite)
passed. The added finite-price guard also passed the local SQL scenarios and all
three production firms passed its preflight without changing any rates. Final
release packaging must pass the same gates on its exact PR head.

The requested Leski Karuchka draft is provisioned with a confirmed existing owner,
COMPANY_ADMIN scope only, document review required and no active service. It has
no drivers or financial entries. Actual city, legal data and rates await owner setup.

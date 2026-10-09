# Driver preparation and terms — 9 October 2026

## Scope and implemented journey

Only driver UI links to /driver/preparation. An authenticated prospective driver
can read the terms in the explicit /driver-join application journey before
entering a contractual relationship. They are absent from customer menus and the
public footer. This is an audience restriction, not confidential legal content:
the repository is public and pre-contract transparency is required where P2B
applies. Materials and individual acceptance records are protected in the DB.

Driver: profile → five short training topics → three comprehension questions →
one explicit acceptance button → server receipt → documents/assigned vehicle →
company administrator verification. General terms/privacy acknowledgment and the
driver receipt are written together in one idempotent DB transaction. A driver's
receipt cannot be accepted by an administrator or edited by a client.

The existing verification trigger uses the updated report: an unverified driver's
missing personal preparation is a blocker even for a direct REST update.
Existing verified drivers keep their access and are offered the training; this
first release does not silently impose new terms on them. Revocation and future
verification are separate actions. Future substantive contractual changes need
notice and a legally reviewed cutover, not flipping the current version and
immediately blocking everyone.

## Legal basis checked

* Bulgarian Obligations and Contracts Act, article 94: advance exclusion/limitation
  of intentional or grossly negligent liability is invalid. Official EU-hosted
  national law: https://eur-lex.europa.eu/legal-content/BG/TXT/PDF/?uri=NIM%3A202202191
* CJEU, C-62/19, Star Taxi App, 3 December 2020:
  https://curia.europa.eu/juris/liste.jsf?num=C-62/19
  Licensed taxis already offering services independently and a platform with no
  decisive influence over fares/quality are material facts, not a universal
  exemption for anything labelled an intermediary.
* CJEU, C-434/15, Asociación Profesional Elite Taxi:
  https://curia.europa.eu/juris/liste.jsf?num=C-434/15
  Actual organisation and control of transport can change classification.
* Regulation (EU) 2019/1150, especially articles 3–5 and 9:
  https://eur-lex.europa.eu/eli/reg/2019/1150/oj/eng
  Plain pre-contract terms; main matching/ranking factors and data access;
  applicable notice and grounds for restrictions/termination. At least 15 days
  for substantive changes and generally 30 days for full termination, subject to
  the regulation's specific exceptions. Applicability depends on the actual
  business-user relationship. A driver employed by a company is not automatically
  the contracting business user.
* Ordinance 34 and the taxi framework, official Bulgarian Road Transport Agency:
  https://www.rta.government.bg/bg/674
  https://rta.government.bg/upload/15538/n34.pdf
  https://rta.government.bg/bg/faq
  Software checks and onboarding do not replace carrier/municipal permits,
  driver qualifications, compulsory insurance, taximeter and fiscal requirements.
* GDPR, especially articles 5, 6, 13, 15–17 and 82:
  https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng
  Privacy acknowledgment is not blanket consent or a waiver of data rights.

## Industry comparison, not imported contracts

Uber requires driver acceptance before receiving requests and keeps terms
accessible in the driver portal:
https://help.uber.com/driving-and-delivering/article/agreeing-to-terms-and-conditions?nodeId=6283c573-6da8-4564-a65d-3d3ca9dedf7c

Uber's Luxembourg partner terms distinguish carrier obligations and liability
limits with non-excludable exceptions:
https://www.uber.com/lu/en/legal/partner-terms-and-conditions/

Bolt official legal index: https://bolt.eu/en-bg/legal/
Regional terms are not evidence of the Bulgarian contractual model. Our text is
original; no foreign governing law/arbitration or broad automatic indemnity is
copied from a regional contract.

## Material unresolved legal matters

The application still marks operator identity and contacts unverified, and lacks
verified legal name, registration number and address. This change does not
approve the paid commercial release, invent those details or certify all EU /
Google / transport requirements.

Our intermediary classification is a proposed position, not a legal finding.
Company tariffs, calculated prices, eligibility checks, dispatch and the actual
level of influence must be reviewed together. Merely stating “we don't drive”
does not eliminate platform obligations, negligence or GDPR liability.

A Bulgarian lawyer must validate the operator/carrier contracts, tariff versus
mandatory taxi meter model, notice process and exact business-user status. The
manually operated complaint/contact process must actually provide reasons and
durable notices; this release does not implement automatic 15/30-day mailing or
pretend that a paragraph alone fulfils those operational duties.

## Deployment and recovery

Source: src/config/driverPreparation.json. Exact version, training and SHA-256:
deployment/driver-source-manifest.json. scripts/check-legal-source.mjs compares
the displayed source to the literal archived migration document. Old accepted
rows are not relabelled when wording changes.

Apply the additive migration only after disposable DB regressions pass. The
Supabase CLI was not installed/cached in this workspace; migration creation uses
an explicit UTC timestamp and the authorised Supabase apply_migration API.
Check database constraints, RLS, function grants and advisors after application.

Rollback: deployment/restore-driver-preparation.sql restores the exact previous
verification report; receipts and documents remain intact. It does not delete
data, disable document checks or reset existing verified drivers.

GitHub is the source deployment. The Readdy-hosted website requires Pull/Publish
if /release.json does not yet show 2026.10.09-driver-preparation.1. Publish this UI
before trying to verify a new driver, because the new server gate will correctly
refuse verification without their receipt. Existing verified drivers and active
rides are not automatically disabled.

No additional paid package, native background GPS promise, Google request or
analytics permission is introduced by the preparation flow. Browser and SQL
tests use only synthetic/local mocks and a disposable database.

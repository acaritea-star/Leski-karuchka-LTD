# Legal foundation draft — 3 October 2026

The application is in a testing period. Its stated role is a digital intermediary connecting customers with drivers and taxi companies; it does not itself carry passengers or become a party to their transport contract. The wider legal release remains a review draft while commercial operator details and the prerequisites below are unresolved. A testing-period label is a product status, not a legal certification or an exemption from applicable requirements. The public brand, Levski focus and booking design are retained. The public privacy notice identifies the responsible individual confirmed on 4 October; company information is published only after separate verification.

## Public privacy information — 4 October 2026

The responsible person confirmed the personal data controller as **Владимир Атанасов**, Bulgaria, and the monitored contact as **vladiata39@gmail.com**. These are recorded separately from unverified company identity fields in `src/config/legalOperator.json`. The contact is used by the privacy policy, contact page, footer, Bulgarian/English translations and public deletion instructions. The privacy notice has its own version, `2026-10-04.1`, separate from the draft commercial terms.

Deletion requests are submitted by email and individually reviewed. Sending a message does not automatically erase an account. The public instructions remain available without signing in at `/data-deletion.html`; this is an instructions URL, not a deletion callback endpoint. The controller must handle actual requests; public wording alone does not establish a completed deletion process. Supabase deletion implementation, company verification, contracts and release attestations were not changed in this update.

## What changed

- Replaced an unconditional disclaimer with a limited responsibility clause that preserves mandatory consumer, injury, intent, gross-negligence and data-protection rights. Added a legible footer summary linked to the full clause.
- Replaced the claim of EU-only hosting with the verified current Supabase region, `us-east-1`. Removed unsupported DPO, automatic deletion, audit and card-data statements.
- Listed the actual data paths: Supabase; Google Maps, Places, Routes and optional Google login; optional Meta/Facebook login; Readdy forms and assets; static-resource providers; browser push services; carriers and participating drivers.
- Added direct cookie settings on all routes, legal pages and the customer menu. Optional recent-address persistence requires a current, validated choice. Rejecting removes addresses; logout clears them. Choices expire after 180 days. Advertising and analytics permissions remain denied because there are no configured advertising/analytics tags in this version.
- Replaced forced GDPR consent for contact and driver forms with purpose and privacy notices. Both public login and registration use the same Google/Facebook screen. Selecting a Continue button accepts the Terms through a visible notice; privacy information is linked separately, with no blanket consent or extra checkbox. The public email/password forms have been removed. This UI acceptance action is not an immutable server agreement register; server-owned evidence remains a release prerequisite.
- Removed static sample fares, five-minute guarantees, fixed-price claims, unsupported driver/partner counts and public trip statistics that have not been verified as genuine customer activity. Preserved three product cards: booking steps, tracking, cash payment.
- Added Google Maps attribution to the custom autocomplete results, public Google terms/privacy links and honest website structured data.
- Restored the login page's original warm background, brand heading, contact link and outlined buttons, while keeping only Google and Facebook. Public screens identify the application as being in a testing period.
- Aligned public marketing, booking notices, legal terms and metadata with the intermediary role. The transport contract and transport duties belong to the relevant carrier; mandatory obligations for the platform's own conduct remain intact.

## Intermediary model and carrier responsibilities

The platform connects a customer looking for transport with registered providers. It supplies requests, communication, estimates and status information. The customer enters the transport contract with the relevant carrier. Company administrators enter carrier tariffs. The carrier remains responsible for lawful transport, its drivers and vehicles, taximeter use, fiscal receipts and insurance. Registration in the platform does not replace the provider's required licences and permits.

The CJEU Star Taxi judgment recognises that connecting passengers directly with taxi drivers can be an information-society service. The assessment depends on the actual operating flow, including influence over tariffs, provider selection and essential transport conditions. The CJEU Uber judgment concerns a different model with decisive influence over the transport service. Review the final contracts and implementation against those facts; public descriptions alone do not complete that assessment. Keep the platform's own consumer and data-protection duties separate from the carrier's transport duties.

Private drivers may not provide regulated paid taxi services merely by checking a box or agreeing to a waiver. A driver profile marked `is_verified` is not itself a municipal permit or taxi-driver certificate. An empty `driver_documents` table does not prove that there are no documents elsewhere, but it does not establish their validity either.

## Release prerequisites

| Prerequisite | Required evidence and implementation |
| --- | --- |
| Operator identity | Full legal name, EIK/registration, registered office, correspondence address if different, monitored email/phone and VAT status. Verify against the company registry. Populate `src/config/legalOperator.json` only from confirmed data. |
| Carrier agreements | Signed allocation of platform/transport duties, fees and taxes, complaints, insurance, data roles, suspension and termination. Assess P2B if this is a commercial intermediary for business users; consumer terms do not replace these contracts. |
| Driver and vehicle eligibility | Carrier registration, vehicle/municipal permit, taxi-driver certificate, taximeter/fiscal compliance, inspections and insurance. Prevent activation or matching when relevant documents expire. Check actual passenger capacity; Ordinance 34 defines taxis as cars with at most seven seats including the driver. |
| Before-booking information | Show the actual carrier's legal identity, contact and applicable tariff before a binding request. A generic company display name is insufficient. Present the estimated/final distinction and any platform fee before confirmation. |
| Final fare and fiscal flow | Current live `private.guard_request()` sets `final_price` to the old estimate on completion. This is confirmed in the connected database, not only in repository SQL. The draft terms require taximeter/fiscal treatment for taxis. Implement and validate a compatible completion/receipt flow before real paid taxi operation; changing text alone does not resolve this. Do not silently change carrier prices. |
| Registration and agreement evidence | Add a server-owned record of authenticated customer, exact immutable terms version/document, server timestamp and acceptance action; cover Google/Facebook from both login and registration, existing accounts and booking. The client-side Continue action alone is not server-owned evidence. Preserve proof without unnecessary IP/device logging. |
| Processing and transfers | Confirm the Supabase DPA, applicable SCCs and transfer assessment; identify actual importing entities and subprocessors. Confirm contracts/roles and transfer mechanism for Meta/Facebook, Readdy, hosting and other relevant providers. If the external form arrangements are unsuitable, replace the endpoint before collecting data. EU hosting can simplify part of this assessment but is not a substitute for it. |
| Retention and rights | Approve concrete retention periods by category and enforce deletion/anonymisation, including backups and processor instructions. Provide a working manual rights/closure process and record responses within GDPR deadlines. Do not retain all coordinates for a generic “tax period”. Assess DPIA/DPO thresholds for actual scale and location monitoring. |
| Data access and security | Complete the earlier audit's customer/driver isolation, push-recipient and endpoint ownership checks, rate limits and legacy request-insert cutover. Resolve relevant advisor findings. Publication of a privacy policy cannot compensate for overbroad access. |
| Google configuration | Verify domain ownership and OAuth branding/links, authorised redirect URIs and minimum scopes in Google Cloud; review Maps key referrer/API restrictions, billing address and applicable EEA terms. Configuration in Google Cloud was not accessible through the supplied plugins. |
| Maps content | Review Places/Routes storage, coordinate caching, selected street-address exceptions and historical records under the actual API/EEA agreement. Adding attribution alone is insufficient. Keep native map/data-provider attribution visible on every relevant screen. |
| New tracking | No Analytics/Ads tags are introduced here. Before adding them, specify providers/purposes, gate tag loading, collect valid separate consent, retain proof and support withdrawal. Consent Mode is a signal, not a substitute for consent. Certified-CMP requirements are product-specific, particularly publisher advertising products. |
| Additional scope | Assess DSA by the real hosting/online-platform functions and size; it is not a universal immunity for transport. Assess DAC7, VAT/invoicing, labour classification and the platform-work directive before monetisation or expansion. Assess accessibility obligations/exemptions rather than assuming a small business is exempt from all laws. |

## Publication sequence

1. Confirm the entity and carrier-based model and obtain a qualified review of the final Bulgarian documents and contracts.
2. Implement the transport, data and evidence prerequisites; test the affected flows against staging. Archive the final terms and acceptance mechanism.
3. Fill the company configuration, remove the draft suffix and mark each item in `deployment/legal-release.json` true only after recording real evidence. These flags are attestations, not automatic verification.
4. Run `npm run check` for lint, tests and production build. Run `npm run check:legal-release` separately; it intentionally fails while this draft is incomplete. The existing CI does not automatically certify or enforce legal readiness.
5. Publish the reviewed version and inform existing users of material changes. Do not treat browsing or silent continued use as unrestricted consent. Publish changes prospectively and collect acceptance where required.

## Primary references

- Bulgarian CPC decision 540/30.06.2015, proceeding 227/2015: https://reg.cpc.bg/Decision.aspx?DecID=300043890
- CJEU C-434/15, Uber: https://curia.europa.eu/jcms/upload/docs/application/pdf/2017-12/cp170136en.pdf
- CJEU C-62/19, Star Taxi: https://curia.europa.eu/jcms/upload/docs/application/pdf/2020-12/cp200149en.pdf
- Bulgarian Obligations and Contracts Act, article 94: https://justice.government.bg/home/normdoc/2121934337
- Current Consumer Protection Act, articles 143–147a: https://www.mi.government.bg/file/2026/03/zzp_6.03.2026.pdf
- Electronic Commerce Act, articles 4 and 4a: https://www.mi.government.bg/file/2026/05/zet_03_02_26.pdf
- Ordinance 34: https://rta.government.bg/upload/15538/n34.pdf
- EDPB rights guidance: https://www.edpb.europa.eu/sme/be-compliant/respect-individuals-rights_en
- EDPB international transfers: https://www.edpb.europa.eu/sme/be-compliant/international-data-transfers_en
- Supabase DPA: https://supabase.com/legal/customer-resources/data-processing-addendum
- Google Maps policies: https://developers.google.com/maps/documentation/javascript/policies
- Google Places policies: https://developers.google.com/maps/documentation/places/web-service/policies
- Google OAuth policies: https://developers.google.com/identity/protocols/oauth2/policies
- Google API data policy: https://developers.google.com/terms/api-services-user-data-policy
- Google EU consent policy: https://www.google.com/about/company/user-consent-policy/
- Google consent mode: https://developers.google.com/tag-platform/security/concepts/consent-mode
- DSA official overview: https://digital-strategy.ec.europa.eu/en/faqs/digital-services-act-questions-and-answers
- P2B official overview: https://digital-strategy.ec.europa.eu/en/policies/platform-business-trading-practices
- Platform-work directive: https://eur-lex.europa.eu/eli/dir/2024/2831

The old EU ODR platform closed on 20 July 2025; these terms link to current competent bodies instead of that obsolete portal. Sources were checked on 3 October 2026. Some EUR-Lex and government endpoints refused direct retrieval; indexed official text and accessible official regulator guidance were used where necessary. This package records findings and drafts; it cannot verify unprovided company, licence or contract facts.

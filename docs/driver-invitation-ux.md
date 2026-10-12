# Invited driver preparation UX

Release: `2026.10.12-driver-invitation.1`.

The invitation page welcomes the driver in plain Bulgarian and shows four stages: personal details, training, documents and approval. Labels and inputs are readable on phones; primary actions have generous touch targets. Completed data/documents are retained by the existing server workflow. Unsaved form edits and unfinished training are not represented as persisted.

Training still uses the existing immutable text, questions, conditions and acceptance receipt. Topics stay readable and focus/scroll returns to the task when moving between topics. The conditions remain available before acceptance.

For a personal vehicle, its details are saved before uploading the next required document. Only one missing or expired document is presented at a time. Completed documents are folded into an expandable review. Drivers using company vehicles are asked only for their licence; the firm remains responsible for assigning an eligible vehicle and verifying its insurance and other prerequisites. All server eligibility checks remain active.

A complete package has one submit action. The authoritative submitted state shows that the firm must now review it; the driver can close the page and return with the same account. Editing the submitted vehicle/documents is available under an explicit disclosure and still invalidates submission on the server. The approved panel action refreshes both profile and partner access, with a retryable connection error. A returned application explains the firm's note and preserves the correction operation.

No authentication/email matching, RLS, migrations, accounting calculations, GPS logic or external API calls change. No dependency is added. The API/query structure is unchanged; UI progression is derived from the existing onboarding response.

Validation includes unit cases for missing vehicle details, expired licence replacement, company vehicles, double submission and waiting state. The full invitation browser flow covers recovered lost responses, private uploads, one receipt and submission, reload and administrator approval on Chromium/WebKit. Synthetic previews are captured without traffic to Google or real emails.

After merging, import the repository in Readdy and Publish. Confirm `/release.json` reports this release. GitHub merging alone does not publish the Readdy-hosted site.

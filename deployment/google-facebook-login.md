# Google and Facebook login

The public `/auth/login` and `/auth/register` pages offer exactly two authentication methods: Google and Facebook. They share one component and no longer contain email/password fields. Both paths require an unchecked terms checkbox before starting OAuth; this is a UI acceptance action, not immutable server evidence.

## Integration

- Uses the existing Supabase client, PKCE, and session/profile loading. Permissions still come from the database; social profile metadata is never used to grant a driver or administrator role.
- Facebook requests email and the provider's basic profile. There is no friends/posts permission, Facebook JS SDK, `FB.AppEvents.logPageView`, Pixel or ad tracking added by this integration.
- Before Facebook starts, public Supabase Auth settings are checked with a publishable/anon key. A disabled provider or failed check produces a useful message on the site. No App Secret is placed in frontend code, environment variables prefixed with `VITE_`, or GitHub.
- A request disables both buttons and prevents duplicate OAuth starts. Rejected promises, rate limits and errors unlock the buttons. Callback errors in either query or fragment are handled without displaying raw provider responses. The callback exchanges a PKCE code once and removes it from the address bar.
- The privacy page discloses Meta/Facebook and has a public `#data-deletion` section describing manual deletion requests. The operator and support contacts still require the confirmation documented in `legal-foundation.md`.

## Confirmed configuration — 3 October 2026

Public Auth settings returned `google: true` and `facebook: true`. A read-only authorization probe returned HTTP 302 to `www.facebook.com` with:

| Setting | Value |
| --- | --- |
| Facebook App ID | `1070570969016069` |
| Facebook Valid OAuth Redirect URI | `https://rzjyvxmfqnnxglmgnvma.supabase.co/auth/v1/callback` |
| App destination after Supabase finishes | `https://leskikaruchka.com/auth/callback` |

These are two different stages. Facebook returns to Supabase; Supabase returns to the frontend, where the code is exchanged. The Supabase callback must not be substituted for the frontend `redirectTo`.

## Before publishing and real-account verification

1. Keep the supplied Supabase callback under Facebook Login → Valid OAuth Redirect URIs. Confirm the app's Website URL and domain refer to `https://leskikaruchka.com` / `leskikaruchka.com`.
2. In Supabase Authentication → URL Configuration use the correct production Site URL and allow `https://leskikaruchka.com/auth/callback`. Add exact staging/localhost callbacks only when required for tests; do not broadly allow arbitrary production redirects.
3. In Meta configure `public_profile` and `email` for the intended audience, complete the applicable app publication/access requirements, and provide the public privacy and data-deletion instructions URLs after those pages are published. Suggested URLs: `https://leskikaruchka.com/privacy` and `https://leskikaruchka.com/privacy#data-deletion`. Confirm the support contact is operational.
4. Test both providers with a real permitted account on the production domain, including first login, return login, denial, missing email, sign-out, and returning as an existing driver/admin. The 302 probe establishes provider configuration, not completion of Meta consent or eligibility for every public Facebook user.
5. Use the same existing verified email where provider linking is supported. Supabase manages identity linking; this frontend does not merge accounts by names, user-supplied IDs or matching display text. Test existing privileged accounts before disabling any backend method.

The backend email provider has not been disabled. The older admin driver-creation flow still provisions email/password accounts and needs a separate onboarding cutover before that setting can be turned off. Public login and registration offer only Google/Facebook; existing users, identities, roles and sessions have not been deleted or rewritten.

## Checks

`npm run check` passes locally: lint, 78 tests in 13 files, TypeScript and production build. New tests cover the two public options, terms acceptance on both paths, provider routing, disabled-provider checks, retries, duplicate requests, and query/fragment callback failures under Strict Mode. Full real-account OAuth completion and browser visual review have not been claimed.

References checked: [Supabase Facebook](https://supabase.com/docs/guides/auth/social-login/auth-facebook), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [PKCE OAuth](https://supabase.com/docs/reference/javascript/auth-signinwithoauth), [identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking). The current Supabase changelog was checked; no relevant hosted Google/Facebook PKCE migration was identified.

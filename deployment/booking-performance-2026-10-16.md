# Booking and location performance — 16 October 2026

The pickup screen previously waited for reverse geocoding after GPS had already
found valid coordinates. This serialized two independent waits and prevented
destination entry for up to another eight seconds. The customer can now enter
the destination immediately; street-address resolution runs alongside it.
Pricing waits for that bounded lookup so one route produces one consistent set
of server quotes, including the resolved pickup label.

## Measurements before the change

Existing aggregate telemetry, last seven days, read on 16 October:

| Operation | Successful samples | Mean | Largest recorded sample |
| --- | ---: | ---: | ---: |
| GPS acquisition | 108 | 4,188 ms | 23,425 ms |
| Route / quotes | 23 | 2,123 ms | 5,725 ms |
| Create request | 9 | 456 ms | 1,474 ms |
| GPS write | 135 | 295 ms | 1,554 ms |

There were also 57 failed GPS reads averaging 21,108 ms. These historical,
mixed-device aggregates cannot identify a particular phone or establish p95.
They include earlier releases; they are a baseline, not an after-deployment
speed claim. No coordinates, addresses, names or account identifiers were read
from telemetry for this audit.

Historical PostgREST statement shapes averaged 11–106 ms for request creation,
53 ms for marketplace availability, and 88–168 ms for nearby-car previews.
Those database-only timings exclude network, Auth, Edge startup and Google.
The observed multi-second location/quote waits are not explained by adding a
database index alone. No production schema or RLS changes were made.

## Lightweight changes

- Customer pickup first tries a device fix for at most 2.5 seconds, allowing at
  most five seconds of native cached position. An inaccurate or failed quick
  fix escalates to precise acquisition. The existing 100-metre accuracy check,
  freshness validation and overall 24-second deadline still apply. Driver GPS
  continues to use precise acquisition first.
- Coordinates unlock destination entry before reverse geocoding completes.
  Manual pickup replacement, location-off and unmount cancel the old address
  lookup. Editing the destination does not cancel a valid pickup address lookup.
- Customer GPS watching ends once a pickup is selected or a request exists;
  changing native fixes never moves a chosen pickup. Address entry remains usable
  during GPS acquisition and supersedes a late automatic fix.
- Search text lives in the picker. A keystroke no longer renders the booking
  page/map. The existing 300-ms debounce, aborts and stale-result guards remain.
  A visible progress indicator accompanies disabled old suggestions.
- Destination autocomplete is biased within 30 km of the pickup, while the
  country restriction remains Bulgaria. This is a preference, not a restriction
  on intercity trips. Minimal Place Details fields remain in use. Starting a
  details request consumes its session token; subsequent searches get a new one.
- Superseded route and recovery reads receive an AbortSignal, including their
  session wait. A cancelled read cannot later start a Google request after the
  Auth lock clears. Aborting an already received request does not refund it or
  undo server work; late results are also rejected locally.
- Booking requests ask Google only for distance, duration and route geometry.
  Navigation requests use an explicit subset of leg/step fields, including the
  API's `staticDuration`. One result still prices all carrier/category offers;
  no Google polling or cross-user quote cache was introduced.
- Maps initialization uses Google's readiness callback and one deadline, rather
  than checking readiness every 50 ms. Error/retry and late-callback handling
  remain bounded. Lost availability also clears a pending quote spinner.

No dependencies were added. Current built static JavaScript graphs, measured
with `node scripts/measure-booking-bundle.mjs [build-directory]`:

| Graph | Before, gzip | After, gzip |
| --- | ---: | ---: |
| Initial app imports | 207,140 bytes | 207,279 bytes |
| Initial + booking imports | 240,849 bytes | 241,402 bytes |

The small guard/UI additions add 553 compressed bytes to the booking graph.
These numbers exclude external Google resources and later lazy imports. The
script walks reachable imports, so retained old assets do not inflate totals.
The operational reduction is fewer unnecessary fields, cancelled obsolete reads,
no map renders per key, and no customer GPS watch after pickup selection.

## Research and validation

Primary documentation reviewed:

- [Google autocomplete parameters and performance](https://developers.google.com/maps/documentation/places/web-service/place-autocomplete)
- [Google session tokens](https://developers.google.com/maps/documentation/places/web-service/place-session-tokens)
- [Routes response field masks](https://developers.google.com/maps/documentation/routes/choose_fields)
- [Routes legs and steps](https://developers.google.com/maps/documentation/routes/understand-route-response)
- [Maps readiness callback](https://developers.google.com/maps/documentation/javascript/load-maps-js-api)
- [MDN geolocation options](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition)
- [React input rendering guidance](https://react.dev/reference/react-dom/components/input#optimizing-re-rendering-on-every-keystroke)
- [Supabase RLS performance](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv)

Regression coverage includes imprecise/stale quick fixes, permission denial,
omitted native callbacks, delayed reverse geocoding, manual address overrides,
input/map render isolation, autocomplete/deferred details cancellation, session
tokens, a cheaper late route, lost availability, exact carrier choice, quote
expiry, and duplicate/uncertain booking writes. The GPS regression failed against
the old screen when the address response was delayed by 2.5 seconds; it passes
with destination entry independent of that response. Delayed response browser
scenarios run on Chromium and WebKit, with external requests fulfilled or blocked.
No real rides, notifications or billable Google calls are generated by tests.

Production `google-routes` version 15 was deployed and read back byte-for-byte,
including its unchanged shared authentication and dependencies. It is compatible
with the existing client. Publish the new frontend from GitHub through Readdy
and verify release `2026.10.16-booking-performance.1` before assessing the UI on
physical devices. Server MFA cutover is a separate deployment switch; this
performance release does not change it.

The database advisor still lists informational missing FK/unused-index findings
and existing overlapping-policy notices. They were not blindly altered without
query-plan evidence. Device GPS/permission/OS limits and external API/network
delays remain measurable constraints; this release does not promise zero lag or
a completed physical iPhone/Android field trial.

# Idle GPS and mobile carrier comparison

The 2026-10-13 desktop reproduction sent accurate Mac Chrome samples about 60–61 seconds apart. The previous 45-second dispatch cutoff made both available drivers disappear between successful writes. Sampled writes returned HTTP 200; no server-write failure was seen in that window.

`private.location_is_current` and `locationFreshness.ts` share one rule: both the original device measurement and its server receipt must be less than 90 seconds old when speed is missing or below 1.5 m/s, or less than 45 seconds old at/above that speed. Unknown speed is explicitly in the bounded 90-second group; it is not evidence that a vehicle is stationary. Future timestamps beyond 30 seconds are rejected. Incoming uploads still require a new accurate native measurement. No stored GPS timestamp is renewed to simulate activity.

The rule covers firm-specific and marketplace availability, notifications, claim validation, legacy direct transitions, nearby markers and company fleet status. The older five-argument fleet helper remains for compatibility; active fleet views use the speed-aware overload. Trip evidence keeps its stricter measurement requirements. Before claiming, the client may reuse a confirmed fix with at least 10 seconds of validity left; the server always rechecks the actual current record.

Briefly switching visible windows restores valid readiness without an acquisition flash. Hidden/frozen pages still pause GPS; browser geolocation cannot guarantee measurement while minimized, locked or suspended. Permission denial and offline errors stay visible. Test live driving with a phone as driver, and use desktop testing to exercise slower Wi-Fi location sampling.

Carrier offers are full-width radio rows ordered by the existing price sort. The selected company is named immediately above a fixed order action. The comparison sheet gets more vertical space, supports vertical scrolling and keeps names and prices together. Choice, quoted amount, category, payment and firm routing contracts do not change. The map refits an excessively wide camera and responds to sheet resizing.

Apply `20261014051154_idle_location_validity.sql` after database regression, then publish the frontend. Rollback: `deployment/idle-location-validity.rollback.sql` restores the previous function bodies and removes only the two new helpers. No profile, location, request, trip or accounting data is rewritten.

Validation includes a 60-second native sampling simulation, original timestamp expiry, moving and idle SQL boundaries, exact carrier acceptance with an older valid idle measurement, existing concurrency/privacy/accounting tests, and mobile Chromium/WebKit comparison layouts. Browser fixtures block external Google requests.

Verified source `bb5b15d1d0a5cb3a57d1e7edc46a51eb1e40664f`: 531 unit tests, 40 Chromium/WebKit browser scenarios, lint, build, immutable legal-source checks and Edge type checks passed in GitHub run 38515055287. Disposable SQL lifecycle/privacy/accounting, overlapping acceptance races and rollback passed in run 38515055438.

The migration was applied as `20261014051154_idle_location_validity` on 2026-10-14. Live read-only assertions confirmed the 61-second idle/unknown-speed case, strict 45-second moving expiry, 90-second idle expiry, future timestamp rejection, fleet alignment and anonymous denial. Advisor findings did not increase. Release `2026.10.14-gps-offers.1` must still be pulled and published in Readdy; a GitHub merge alone does not publish the domain.

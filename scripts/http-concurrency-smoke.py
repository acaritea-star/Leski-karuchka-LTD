"""Small authenticated HTTP workload for four explicitly provisioned fixtures.

No fixture credentials are committed. Supply a private JSON manifest containing
project, publishable_key, password, company, vehicle_type and two CUSTOMER/two
DRIVER actors with user/email/quote/driver IDs. Remove fixtures with the database
owner after the run, including when assertions fail. No Google endpoints exist.
"""
import concurrent.futures
import datetime
import json
import math
import pathlib
import re
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid

manifest = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert re.fullmatch(r"[a-z]{20}", manifest['project'])
assert manifest['publishable_key'].startswith('sb_publishable_')
base = 'https://' + manifest['project'] + '.supabase.co'
actors = manifest['actors']
assert len(actors) == 4 and sorted(a['role'] for a in actors) == ['CUSTOMER', 'CUSTOMER', 'DRIVER', 'DRIVER']
for actor in actors:
    assert actor['email'] == 'scale-http-' + str(uuid.UUID(actor['user'])) + '@example.invalid'
    for field in ['quote', 'driver']:
        if actor.get(field): uuid.UUID(actor[field])
customers = [a for a in actors if a['role'] == 'CUSTOMER']
drivers = [a for a in actors if a['role'] == 'DRIVER']
records = []
lock = threading.Lock()
active = peak = 0
checks = []


def call(actor, path, method='GET', body=None, stage='read', prefer=None):
    global active, peak
    assert path.startswith(('/auth/v1/token?', '/auth/v1/logout?', '/rest/v1/'))
    headers = {'apikey': manifest['publishable_key'], 'Content-Type': 'application/json'}
    if actor.get('token'): headers['Authorization'] = 'Bearer ' + actor['token']
    if prefer: headers['Prefer'] = prefer
    request = urllib.request.Request(base + path, method=method, headers=headers,
        data=json.dumps(body).encode() if body is not None else None)
    with lock:
        active += 1
        peak = max(peak, active)
    started = time.monotonic()
    try:
        try:
            response = urllib.request.urlopen(request, timeout=12)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            data = response.read()
            result = {'status': response.code, 'data': json.loads(data) if data else None}
        return result
    finally:
        with lock:
            active -= 1
            records.append({'stage': stage, 'ms': (time.monotonic() - started) * 1000})


def parallel(work):
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        return list(pool.map(lambda fn: fn(), work))


def ok(result):
    assert 200 <= result['status'] < 300, 'Unexpected HTTP status ' + str(result['status'])
    return result['data']


def gps(actor, timestamp=None):
    return call(actor, '/rest/v1/driver_locations?on_conflict=driver_id', 'POST', {
        'driver_id': actor['driver'], 'company_id': manifest['company'], 'latitude': 43.2, 'longitude': 25.6,
        'accuracy': 10, 'position_at': timestamp or datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }, 'gps_upsert', 'resolution=merge-duplicates,return=representation')


try:
    for actor in actors:
        login = call(actor, '/auth/v1/token?grant_type=password', 'POST', {
            'email': actor['email'], 'password': manifest['password'],
        }, 'fixture_login')
        data = ok(login)
        assert data['user']['id'] == actor['user'], 'Unexpected authenticated fixture'
        actor['token'] = data['access_token']
    # Concurrent calls for one customer must reserve the preview rate slot once.
    previews = parallel([lambda: call(customers[0], '/rest/v1/rpc/nearby_cars', 'POST', {
        'p_lat': 43.2, 'p_lng': 25.6, 'p_type': manifest['vehicle_type'],
    }, 'preview_contention') for _ in range(8)])
    assert sum(200 <= r['status'] < 300 for r in previews) == 1, 'Preview rate limit bypass'
    assert all(r['status'] == 200 or r['data'].get('code') == 'P0001' for r in previews)
    checks.append('one preview reservation across eight concurrent calls')
    for driver in drivers:
        ok(gps(driver))
        ok(call(driver, '/rest/v1/drivers?id=eq.' + driver['driver'], 'PATCH', {'is_online': True}, 'availability'))
    # Two request IDs for the same quote must return the same committed ride.
    created = parallel([lambda: call(customers[0], '/rest/v1/rpc/create_taxi_request', 'POST', {
        'p_quote_id': customers[0]['quote'], 'p_request_id': str(uuid.uuid4()), 'p_payment_method': 'cash',
    }, 'create_contention') for _ in range(2)])
    rides = [ok(r) for r in created]
    assert rides[0]['id'] == rides[1]['id'], 'Duplicate quote booking'
    ride = rides[0]['id']
    checks.append('one committed ride across two concurrent booking attempts')
    accepted = parallel([lambda d=d: call(d, '/rest/v1/rpc/accept_taxi_request', 'POST', {
        'p_request_id': ride,
    }, 'accept_contention') for d in drivers])
    winners = [i for i, r in enumerate(accepted) if 200 <= r['status'] < 300]
    assert len(winners) == 1, 'Double ride acceptance'
    assert all(r['status'] < 500 for r in accepted), 'Acceptance server failure'
    winner = drivers[winners[0]]
    other = drivers[1 - winners[0]]
    checks.append('one winning driver across two concurrent accept attempts')
    foreign = ok(call(customers[1], '/rest/v1/taxi_requests?id=eq.' + ride + '&select=id', stage='tenant_isolation'))
    assert foreign == [], 'Foreign customer saw the ride'
    # Mix ordinary client reads and driver GPS writes, eight requests in flight.
    work = []
    for i in range(48):
        work.append(lambda: call(customers[0], '/rest/v1/taxi_requests?id=eq.' + ride + '&select=id,status', stage='ride_read'))
        work.append(lambda d=drivers[i % 2]: gps(d))
    mixed = parallel(work)
    for result in mixed: ok(result)
    checks.append('96 mixed reads and GPS writes with eight in-flight HTTP requests')
    ok(gps(winner)); ok(gps(other))
    second = ok(call(customers[1], '/rest/v1/rpc/create_taxi_request', 'POST', {
        'p_quote_id': customers[1]['quote'], 'p_request_id': str(uuid.uuid4()), 'p_payment_method': 'cash',
    }, 'second_booking'))['id']
    busy = call(winner, '/rest/v1/rpc/accept_taxi_request', 'POST', {'p_request_id': second}, 'busy_guard')
    assert 400 <= busy['status'] < 500, 'Busy driver obtained a second ride'
    ok(call(other, '/rest/v1/rpc/accept_taxi_request', 'POST', {'p_request_id': second}, 'second_accept'))
    ok(call(customers[1], '/rest/v1/taxi_requests?id=eq.' + second + '&status=eq.accepted', 'PATCH', {
        'status': 'cancelled', 'cancel_reason': 'scale_http_fixture',
    }, 'cancellation', 'return=representation'))
    for previous, status in [('accepted', 'arrived'), ('arrived', 'in_progress'), ('in_progress', 'completed')]:
        data = ok(call(winner, '/rest/v1/taxi_requests?id=eq.' + ride + '&status=eq.' + previous, 'PATCH', {
            'status': status, **({'final_price': 99999} if status == 'completed' else {}),
        }, 'lifecycle', 'return=representation'))
        assert len(data) == 1 and data[0]['status'] == status, 'Missed trip transition'
        if status == 'completed': assert float(data[0]['final_price']) == 5, 'Forged final price'
    assert len(ok(call(customers[0], '/rest/v1/trips?request_id=eq.' + ride + '&select=id', stage='accounting'))) == 1
    assert ok(call(customers[1], '/rest/v1/trips?request_id=eq.' + second + '&select=id', stage='accounting')) == []
    checks.extend(['busy driver rejected; available driver accepted', 'foreign customer isolated',
        'completion counted once; cancellation creates no trip; final price protected'])
finally:
    for actor in actors:
        if actor.get('token'):
            try: call(actor, '/auth/v1/logout?scope=global', 'POST', stage='fixture_logout')
            except Exception: pass

timings = {}
for stage in sorted(set(r['stage'] for r in records)):
    values = sorted(r['ms'] for r in records if r['stage'] == stage)
    timings[stage] = {'count': len(values), 'avg_ms': round(sum(values) / len(values), 2),
        'p95_ms': round(values[math.ceil(.95 * len(values)) - 1], 2), 'max_ms': round(max(values), 2)}
print(json.dumps({'passed': True, 'peak_in_flight': peak, 'requests': len(records), 'google_requests': 0,
    'checks': checks, 'timings': timings}))

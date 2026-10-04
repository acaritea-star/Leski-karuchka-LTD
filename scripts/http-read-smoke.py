"""Forty read-only public Data API requests, up to eight HTTP calls in flight.
Config contains project and a publishable API key; no login or writes occur.
This checks HTTP availability, not authenticated dispatch capacity.
"""
import concurrent.futures
import json
import math
import pathlib
import re
import sys
import threading
import time
import urllib.error
import urllib.request

config = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert re.fullmatch(r'[a-z]{20}', config['project'])
assert config['publishable_key'].startswith('sb_publishable_')
base = 'https://' + config['project'] + '.supabase.co/rest/v1/'
lock = threading.Lock()
active = peak = 0


def read(i):
    global active, peak
    table = 'companies' if i % 2 == 0 else 'vehicle_types'
    request = urllib.request.Request(base + table + '?select=id&limit=1', method='GET',
        headers={'apikey': config['publishable_key']})
    with lock:
        active += 1
        peak = max(peak, active)
    started = time.monotonic()
    try:
        try: response = urllib.request.urlopen(request, timeout=10)
        except urllib.error.HTTPError as error: response = error
        with response:
            body = json.loads(response.read())
            return {'status': response.code, 'rows': len(body) if isinstance(body, list) else None,
                'ms': (time.monotonic() - started) * 1000}
    finally:
        with lock: active -= 1


with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    results = list(pool.map(read, range(40)))
values = sorted(r['ms'] for r in results)
summary = {'requests': len(results), 'peak_in_flight': peak, 'google_requests': 0, 'writes': 0,
    'statuses': {str(status): sum(r['status'] == status for r in results) for status in set(r['status'] for r in results)},
    'p95_ms': round(values[math.ceil(.95 * len(values)) - 1], 2), 'max_ms': round(max(values), 2),
    'passed': all(r['status'] == 200 for r in results), 'authenticated': False}
print(json.dumps(summary))
if not summary['passed']: sys.exit(1)

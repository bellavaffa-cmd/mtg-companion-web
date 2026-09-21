"""Step 1 of building the scanner's card index: every English paper printing Scryfall knows, and a
small picture of each face. Resumable — pictures already on disk are skipped — so a later run only
fetches what's new (a new set).

    python fetch_cards.py [data_dir]

data_dir defaults to ../../../manabind-index (beside the repos, not in them). Writes:
    default-cards.jsonl.gz   Scryfall's bulk list (refreshed when a day old)
    cards.jsonl          one line per picture: id, face, name, set, number, illustration, file
    img/<id>[_<face>].jpg
"""
import gzip
import http.client
import json
import os
import sys
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', '..', 'manabind-index'))
IMG = os.path.join(DATA, 'img')
os.makedirs(IMG, exist_ok=True)
UA = {'User-Agent': 'Manabind-CardIndex/1.0 (github.com/bellavaffa-cmd)', 'Accept': '*/*'}

# Not cards a player scans into a collection: art cards, tokens and emblems, oversized commanders.
SKIP_LAYOUTS = {'art_series', 'token', 'double_faced_token', 'emblem', 'vanguard'}


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60)


def bulk_list():
    path = os.path.join(DATA, 'default-cards.jsonl.gz')
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < 86400:
        return path
    info = json.load(get('https://api.scryfall.com/bulk-data/default-cards'))
    print('downloading bulk list', info.get('compressed_size', 0) // 1_000_000, 'MB', flush=True)
    tmp = path + '.part'
    with get(info['jsonl_download_uri']) as r, open(tmp, 'wb') as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    os.replace(tmp, path)
    return path


def pictures(path):
    """Each face picture of each printing worth scanning."""
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        for line in f:
            if not line.strip():
                continue
            c = json.loads(line)
            if c.get('lang') != 'en' or c.get('digital') or 'paper' not in c.get('games', []):
                continue
            if c.get('layout') in SKIP_LAYOUTS or c.get('oversized') or c.get('image_status') in ('missing', 'placeholder'):
                continue
            base = {'id': c['id'], 'name': c['name'], 'set': c['set'], 'number': c['collector_number'],
                    'released': c.get('released_at')}
            if c.get('image_uris'):
                yield {**base, 'face': 0, 'illustration': c.get('illustration_id'), 'url': c['image_uris']['small'], 'file': c['id'] + '.jpg'}
            else:
                for i, face in enumerate(c.get('card_faces') or []):
                    if face.get('image_uris'):
                        yield {**base, 'face': i, 'illustration': face.get('illustration_id'), 'url': face['image_uris']['small'],
                               'file': f"{c['id']}_{i}.jpg"}


def main():
    rows = list(pictures(bulk_list()))
    with open(os.path.join(DATA, 'cards.jsonl'), 'w', encoding='utf-8') as f:
        for r in rows:
            f.write(json.dumps({k: v for k, v in r.items() if k != 'url'}) + '\n')
    todo = [r for r in rows if not os.path.exists(os.path.join(IMG, r['file']))]
    print(f'{len(rows)} pictures, {len(todo)} to fetch', flush=True)

    done = [0]
    failed = []
    lock = threading.Lock()
    started = time.time()

    # One kept-open connection per worker: a fresh secure connection for every little picture
    # spent three quarters of a second on the handshake alone.
    local = threading.local()

    def download(url):
        u = urllib.parse.urlsplit(url)
        conn = getattr(local, 'conn', None)
        if conn is None or local.host != u.netloc:
            conn = local.conn = http.client.HTTPSConnection(u.netloc, timeout=60)
            local.host = u.netloc
        try:
            conn.request('GET', u.path + ('?' + u.query if u.query else ''), headers=UA)
            resp = conn.getresponse()
            data = resp.read()
        except Exception:
            local.conn = None
            conn.close()
            raise
        if resp.status != 200:
            raise IOError(f'HTTP {resp.status}')
        return data

    def fetch(r):
        out = os.path.join(IMG, r['file'])
        for attempt in range(3):
            try:
                data = download(r['url'])
                with open(out + '.part', 'wb') as f:
                    f.write(data)
                os.replace(out + '.part', out)
                break
            except Exception as e:  # noqa: BLE001 — a flaky picture is retried, then listed
                if attempt == 2:
                    with lock:
                        failed.append((r['file'], str(e)))
                time.sleep(2 * (attempt + 1))
        with lock:
            done[0] += 1
            if done[0] % 2000 == 0:
                rate = done[0] / (time.time() - started)
                print(f'{done[0]}/{len(todo)}  {rate:.1f}/s  ~{(len(todo) - done[0]) / rate / 60:.0f} min left', flush=True)
        # Scryfall's pictures are served from a CDN without the API's limits; still, a light touch.
        time.sleep(0.02)

    with ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(fetch, todo))
    print(f'done: {done[0]} fetched, {len(failed)} failed', flush=True)
    for name, err in failed[:20]:
        print('  failed', name, err)


if __name__ == '__main__':
    main()

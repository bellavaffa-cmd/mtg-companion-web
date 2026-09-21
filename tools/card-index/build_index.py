"""Step 2 of building the scanner's card index: every picture fetch_cards.py saved, run through the
image model, shrunk to a short fingerprint, and packed into the file the apps download.

    python build_index.py --model mobilenetv2.onnx [--dims 64,96,128] [--bench DIR] [--write 96]

--bench DIR  scores each fingerprint length against photos of real cards (edgebench: scenes.json,
             printings.json, flat/*.rgba, flat.json — see README) before anything is written.
--write D    writes card-index.bin with D-number fingerprints.

The fingerprint: the model's feature vector for the whole card (squashed to its input size, ImageNet
normalised), centred and turned by PCA onto its D most telling directions, made unit length, then
stored as bytes (-127..127) on one shared scale. Matching is then a dot product of bytes.

card-index.bin, little-endian:
    "MBIX"  u32 version=1  u32 count  u32 dim  u32 featDim  f32 scale  u32 inputSize
    f32[featDim]        mean
    f32[dim*featDim]    components (row per fingerprint number)
    i8[count*dim]       fingerprints
    u8[16*count]        Scryfall ids (raw uuid bytes)
    u8[count]           face (0 front, 1 back)
    u32[count]          name   (index into names)
    u16[count]          set    (index into sets)
    u16[count]          number (index into numbers)
    u32[count]          picture group: printings sharing one illustration share a group
    u32 n + utf8 json   {"names": [...], "sets": [...], "numbers": [...]}
"""
import argparse
import json
import os
import struct
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import onnxruntime as ort
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)


class Model:
    def __init__(self, path):
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = os.cpu_count()
        self.sess = ort.InferenceSession(path, opts, providers=['CPUExecutionProvider'])
        self.inp = self.sess.get_inputs()[0]
        self.size = self.inp.shape[-1] if isinstance(self.inp.shape[-1], int) else 224
        # The feature vector is the widest output (a classifier also gives its 1000 class scores).
        self.out = max(self.sess.get_outputs(), key=lambda o: np.prod([d for d in o.shape if isinstance(d, int)])).name

    def prep(self, img):
        a = np.asarray(img.convert('RGB').resize((self.size, self.size), Image.BILINEAR), np.float32) / 255
        return ((a - MEAN) / STD).transpose(2, 0, 1)

    def features(self, imgs):
        x = np.stack([self.prep(im) for im in imgs])
        return self.sess.run([self.out], {self.inp.name: x})[0].reshape(len(imgs), -1)


def all_features(model, rows, data, cache):
    if os.path.exists(cache):
        f = np.load(cache)
        if len(f) == len(rows):
            return f.astype(np.float32)
    out = np.zeros((len(rows), 0), np.float16)
    chunks = []
    batch = 64
    started = time.time()
    pool = ThreadPoolExecutor(8)
    load = lambda r: Image.open(os.path.join(data, 'img', r['file']))  # noqa: E731
    for i in range(0, len(rows), batch):
        imgs = list(pool.map(load, rows[i:i + batch]))
        chunks.append(model.features(imgs).astype(np.float16))
        if (i // batch) % 100 == 0:
            done = i + len(imgs)
            rate = done / (time.time() - started)
            print(f'  features {done}/{len(rows)}  {rate:.0f}/s  ~{(len(rows) - done) / rate / 60:.0f} min left', flush=True)
    out = np.concatenate(chunks)
    np.save(cache, out)
    return out.astype(np.float32)


def pca(features, dims, sample=40000, seed=1):
    rnd = np.random.default_rng(seed)
    pick = features[rnd.choice(len(features), min(sample, len(features)), replace=False)]
    mean = pick.mean(axis=0)
    # The directions the features vary most along: the top of the covariance's eigenvectors.
    cov = np.cov((pick - mean).T)
    vals, vecs = np.linalg.eigh(cov)
    order = np.argsort(vals)[::-1][:dims]
    return mean.astype(np.float32), vecs[:, order].T.astype(np.float32)


def fingerprints(features, mean, comps):
    z = (features - mean) @ comps.T
    return z / np.linalg.norm(z, axis=1, keepdims=True)


def quantised(z, scale):
    return np.clip(np.round(z * scale), -127, 127).astype(np.int8)


def bench(model, bench_dir, rows, feats, dims_list):
    meta = json.load(open(os.path.join(bench_dir, 'scenes.json')))
    prints = json.load(open(os.path.join(bench_dir, 'printings.json')))
    flat = json.load(open(os.path.join(bench_dir, 'flat.json')))
    ids = np.array([r['id'] for r in rows])
    names = np.array([r['name'] for r in rows])
    illus = np.array([r.get('illustration') or '' for r in rows])
    queries = []
    for s in meta['scenes']:
        n = flat['counts'].get(s['name'], 0)
        imgs = [Image.frombytes('RGBA', (flat['width'], flat['height']),
                                open(os.path.join(bench_dir, 'flat', f"{s['name']}_{k}.rgba"), 'rb').read()) for k in range(n)]
        queries.append((s, model.features(imgs) if imgs else None))
    for dims in dims_list:
        if dims == 'full':
            mean = feats.mean(axis=0)
            fp = feats - mean
            fp /= np.linalg.norm(fp, axis=1, keepdims=True)
            project = lambda q: (q - mean) / np.linalg.norm(q - mean, axis=1, keepdims=True)  # noqa: E731
            scale = 1.0
            db = fp
        else:
            mean, comps = pca(feats, dims)
            z = fingerprints(feats, mean, comps)
            scale = 127 / np.abs(z).max()
            db = quantised(z, scale).astype(np.float32)
            project = lambda q: quantised(fingerprints(q, mean, comps), scale).astype(np.float32)  # noqa: E731
        tally = {'global': dict(exact=0, samePicture=0, sameName=0, wrong=0), 'byName': dict(exact=0, samePicture=0, sameName=0, wrong=0)}
        margins = []
        for s, q in queries:
            p = prints[s['card']]
            if q is None:
                tally['global']['wrong'] += 1; tally['byName']['wrong'] += 1
                continue
            best = (project(q) @ db.T).max(axis=0)
            for kind in ('global', 'byName'):
                b = best if kind == 'global' else np.where(names == p['name'], best, -1e9)
                i = int(b.argmax())
                o = ('exact' if ids[i] == p['truth'] else 'samePicture' if illus[i] == p['illustration']
                     else 'sameName' if names[i] == p['name'] else 'wrong')
                tally[kind][o] += 1
                if kind == 'global':
                    # How far clear of the nearest card with another picture the winner stood.
                    other = np.where(illus != illus[i], best, -1e9).max()
                    margins.append((best[i] - other) / (scale * scale if dims != 'full' else 1))
        m = np.array(margins)
        print(f"dims {dims}: " + '   '.join(f"{k} {v['exact']}/{v['samePicture']}/{v['sameName']}/{v['wrong']}" for k, v in tally.items())
              + f"   margin p5 {np.percentile(m, 5):.3f} median {np.median(m):.3f}", flush=True)
    print('(exact / same picture, other printing / same name, other picture / wrong card)')


def write(path, rows, feats, dims, input_size):
    mean, comps = pca(feats, dims)
    z = fingerprints(feats, mean, comps)
    scale = 127 / np.abs(z).max()
    fp = quantised(z, scale)
    names = sorted({r['name'] for r in rows}); ni = {n: i for i, n in enumerate(names)}
    sets = sorted({r['set'] for r in rows}); si = {n: i for i, n in enumerate(sets)}
    nums = sorted({r['number'] for r in rows}); ui = {n: i for i, n in enumerate(nums)}
    assert len(sets) < 65536 and len(nums) < 65536
    groups = {}
    group = [groups.setdefault(r.get('illustration') or r['id'] + str(r['face']), len(groups)) for r in rows]
    with open(path, 'wb') as f:
        f.write(b'MBIX' + struct.pack('<IIIIfI', 1, len(rows), dims, feats.shape[1], float(scale), input_size))
        f.write(mean.astype('<f4').tobytes())
        f.write(comps.astype('<f4').tobytes())
        f.write(fp.tobytes())
        f.write(b''.join(uuid.UUID(r['id']).bytes for r in rows))
        f.write(np.array([r['face'] for r in rows], np.uint8).tobytes())
        f.write(np.array([ni[r['name']] for r in rows], '<u4').tobytes())
        f.write(np.array([si[r['set']] for r in rows], '<u2').tobytes())
        f.write(np.array([ui[r['number']] for r in rows], '<u2').tobytes())
        f.write(np.array(group, '<u4').tobytes())
        meta = json.dumps({'names': names, 'sets': sets, 'numbers': nums}, ensure_ascii=False).encode('utf-8')
        f.write(struct.pack('<I', len(meta)) + meta)
    print(f'wrote {path}: {len(rows)} pictures × {dims}, {os.path.getsize(path) / 1e6:.1f} MB')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    ap.add_argument('--data', default=os.path.join(HERE, '..', '..', '..', 'manabind-index'))
    ap.add_argument('--dims', default='64,96,128')
    ap.add_argument('--bench')
    ap.add_argument('--query-model', help='fingerprint the bench photos with this model instead (e.g. the 8-bit one)')
    ap.add_argument('--write', type=int)
    ap.add_argument('--out', default=None)
    a = ap.parse_args()
    data = os.path.abspath(a.data)
    rows = [json.loads(l) for l in open(os.path.join(data, 'cards.jsonl'), encoding='utf-8')]
    rows = [r for r in rows if os.path.exists(os.path.join(data, 'img', r['file']))]
    print(len(rows), 'pictures')
    model = Model(a.model)
    feats = all_features(model, rows, data, os.path.join(data, f'features_{os.path.basename(a.model)}.npy'))
    if a.bench:
        bench(Model(a.query_model) if a.query_model else model, a.bench, rows, feats, [d if d == 'full' else int(d) for d in a.dims.split(',')])
    if a.write:
        write(a.out or os.path.join(data, 'card-index.bin'), rows, feats, a.write, model.size)


if __name__ == '__main__':
    main()

"""Shrinks the image model to 8-bit numbers (about a quarter the size) for the apps to download,
calibrated on a few hundred real card pictures so its ranges fit what it'll see.

    python quantize_model.py <model.onnx> <out.onnx> [data_dir]
"""
import json
import os
import random
import sys

import numpy as np
import onnx
from onnx import version_converter
from onnxruntime.quantization import CalibrationDataReader, QuantFormat, QuantType, quantize_static
from onnxruntime.quantization.shape_inference import quant_pre_process
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
src, out = sys.argv[1], sys.argv[2]
data = os.path.abspath(sys.argv[3] if len(sys.argv) > 3 else os.path.join(HERE, '..', '..', '..', 'manabind-index'))
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)

rows = [json.loads(l) for l in open(os.path.join(data, 'cards.jsonl'), encoding='utf-8')]
random.Random(3).shuffle(rows)
files = [os.path.join(data, 'img', r['file']) for r in rows[:300]]


class Cards(CalibrationDataReader):
    def __init__(self):
        self.it = iter(files)

    def get_next(self):
        f = next(self.it, None)
        if f is None:
            return None
        a = np.asarray(Image.open(f).convert('RGB').resize((224, 224), Image.BILINEAR), np.float32) / 255
        return {'input': ((a - MEAN) / STD).transpose(2, 0, 1)[None]}


# Per-channel 8-bit weights need operator set 13 or later; older models are brought up to it first.
m = onnx.load(src)
if m.opset_import[0].version < 13:
    m = version_converter.convert_version(m, 13)
up = out + '.up.onnx'
onnx.save(m, up)
pre = out + '.pre.onnx'
quant_pre_process(up, pre, skip_symbolic_shape=True)
os.remove(up)
quantize_static(pre, out, Cards(), quant_format=QuantFormat.QDQ, per_channel=True,
                activation_type=QuantType.QUInt8, weight_type=QuantType.QInt8)
os.remove(pre)
print(f'{out}: {os.path.getsize(out) / 1e6:.1f} MB')

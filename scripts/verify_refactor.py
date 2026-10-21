"""Compare the shared training loader with the pre-refactor implementation."""
import argparse
from pathlib import Path
import runpy
import joblib
import numpy as np
from polars.testing import assert_frame_equal
from src.ml.training_data import ROOT, MODEL_COLUMNS, load_training_data

parser = argparse.ArgumentParser()
parser.add_argument('baseline', type=Path)
args = parser.parse_args()
legacy = runpy.run_path(str(args.baseline / 'src/ml/candidate_training_data.py'))
current = load_training_data()
assert MODEL_COLUMNS == legacy['MODEL_COLUMNS']
assert_frame_equal(current, legacy['df'], check_exact=True)
for model_id, columns in MODEL_COLUMNS.items():
    model = joblib.load(ROOT / f'models/{model_id}.joblib')
    before = model.predict_proba(legacy['df'].select(columns).to_numpy())
    after = model.predict_proba(current.select(columns).to_numpy())
    np.testing.assert_array_equal(before, after)
print(f'PASS: {current.height} training rows, column order, nulls, values and saved-model predictions are identical.')

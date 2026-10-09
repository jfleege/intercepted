
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

DATA_DIR = PROJECT_ROOT / "data"
PROCESSED_DIR = DATA_DIR / "processed"
DIAGNOSTICS_DIR = DATA_DIR / "diagnostics"
MODEL_DIR = PROJECT_ROOT / "models"

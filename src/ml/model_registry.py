"""Stable IDs: never relabel historical forecasts as a newer fitted model."""
MODELS = ("v4_a", "v4_qb_plus", "v5_qb_plus", "v5_boosted")
ACTIVE_MODELS = ("v5_qb_plus", "v5_boosted", "v4_a")
LABELS = {"v4_a": "Base", "v4_qb_plus": "QB+ (original)",
          "v5_qb_plus": "Updated QB+", "v5_boosted": "Gradient Boosted"}

def model_metadata(metadata, model):
    return {**metadata, **metadata.get("models", {}).get(model, {})}

def available_models(metadata):
    return tuple(m for m in MODELS if m in metadata.get("models", {}))

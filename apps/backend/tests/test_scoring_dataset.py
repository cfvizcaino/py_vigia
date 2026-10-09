"""El dataset sintético es consistente y los casos de control no se degradan."""

from datetime import datetime

from vigia_backend.scoring_dataset import DEFAULT_PATH, evaluate, load_dataset


def test_dataset_is_internally_consistent():
    data = load_dataset(DEFAULT_PATH)
    assert data["synthetic"] is True
    cameras = {c["external_id"] for c in data["cameras"]}
    links = {(l["from"], l["to"]) for l in data["road_links"] if l["options"]}
    ids = [d["id"] for d in data["detections"]]
    assert len(ids) == len(set(ids))
    assert all(d["camera_id"] in cameras for d in data["detections"])
    for vehicle in data["vehicles"]:
        assert all((a, b) in links for a, b in zip(vehicle["path"], vehicle["path"][1:]))
        times = [d["observed_at"] for d in data["detections"] if d["vehicle_id"] == vehicle["id"]]
        assert times == sorted(times)
    for case in data["cases"]:
        assert datetime.fromisoformat(case["time_from"]) < datetime.fromisoformat(case["time_to"])


def test_control_cases_keep_their_expected_outcome():
    cases = {c["case"]: c for c in evaluate(load_dataset(DEFAULT_PATH))["cases"]}
    # A clean trip and a weak-but-coherent one must rank first.
    assert cases["S01"]["truths"][0]["rank"] == 1 and cases["S01"]["false_links_topk"] == 0
    assert cases["S08"]["truths"][0]["rank"] == 1
    # An impossible jump and pure noise must not produce any route.
    assert cases["S06"]["routes"] == 0
    assert cases["S10"]["routes"] == 0


def test_report_exposes_comparable_metrics():
    summary = evaluate(load_dataset(DEFAULT_PATH))["summary"]
    assert summary["trajectories"] > 0
    for key in ("recall_at_1", "recall_at_3", "mean_best_jaccard_top3", "false_link_rate_topk"):
        assert 0 <= summary[key] <= 1

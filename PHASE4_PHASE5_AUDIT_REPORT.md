# Trace — Phase 4 & Phase 5 Repository-Level Audit Report

**Audit date:** 2026-10-21
**Auditor:** Automated repository audit (Claude Code session)
**Scope:** All previously unchecked items in Phase 4 and Phase 5, verified against repository evidence only.
**Verdict:** **PROJECT NOT COMPLETE.** `end.md` was **not** created because required items in both phases are `NOT COMPLETED` or `NOT VERIFIABLE`. Per the audit decision rule, a completion document would be false.

---

## 1. Audit Method

1. **Static inspection** of source code, configuration, dataset artifacts, and documentation.
2. **Runtime verification** where possible: full pytest suite execution and a FastAPI import/service-construction smoke test.
3. Documentation claims were treated as hypotheses and checked against files on disk. Where a document claims a result but no supporting artifact exists in the repository, the item is classified `NOT VERIFIABLE`.
4. No source code was modified during this audit.

### Tests executed during this audit

| Test | Command | Actual result |
|---|---|---|
| Full test suite | `venv/Scripts/python.exe -m pytest ai_pipeline backend -q` | **568 passed, 3 failed, 5 skipped** |
| Backend smoke test | Import `backend.app.main`, construct `RouteService` and `MatchingService` | **Passed** — app imports, 23 API routes registered, adjacency `{C01↔C02: 20s, C02↔C03: 30s}`, face threshold 0.38 loaded |

**The 3 test failures are data/test-expectation conflicts, not code defects:** the committed body galleries (`embeddings_C01/C02/C03.json`) now contain **768-d SOLIDER** embeddings, while three tests still assert **512-d OSNet**:

- `test_embed.py::TestEmbeddingLength::test_embedding_length_is_512_in_all_records`
- `test_face_first_matching.py::TestExistingGallery::test_embedding_record_schema`
- `test_similarity.py::TestRealEmbeddingsSmoke::test_all_embeddings_are_512d`

These failures are themselves evidence: the SOLIDER backbone is active in the real gallery data.

---

## 2. Terminology Note

Two different things are both called "Phase 5" in this repository:

- **Roadmap Phase 5** (in `TRACE_PROJECT_TECHNICAL_DOCUMENTATION.md` §13–14): *Optimisation & Production* — vector indexing, ONNX export, evaluation harness, deployment, authentication, etc. The documentation lists this as **Planned**.
- **`docs/phase5_*.md`** documents: the *target-search sub-experiments* (5.1–5.8). These implement roadmap Phase 3/4 work (query matching, validation, no-match handling), not roadmap Phase 5.

This audit evaluates **both**, labelled explicitly.

---

## 3. Phase 4 — Verified Item Status

### 3.1 Previously unchecked items from documentation §13–14

| # | Requirement | Status | Evidence | Remaining gap |
|---|---|---|---|---|
| P4-1 | Camera transition logic | **COMPLETED** | `backend/app/services/route_service.py` — `spatial_score()`, adjacency loaded from `dataset/camera_graph.json`; smoke test confirmed `{C01: {C02: 20}, C02: {C01: 20, C03: 30}, C03: {C02: 30}}` | None |
| P4-2 | Route reconstruction | **COMPLETED** | `route_service.py::reconstruct_route()` — greedy walk + candidate-track evaluation; fusion weights 0.60 appearance / 0.25 spatial / 0.15 temporal in `backend/app/config.py`; exercised by passing backend tests | No formal route-accuracy evaluation (see P4-6) |
| P4-3 | Face-first identity matching policy | **COMPLETED** | `ai_pipeline/reid/matching.py` — `resolve_match_mode()`, `select_identity_score()`; `backend/app/services/matching_service.py` evidence hierarchy + face veto; ORM columns `matching_mode`, `face_used`, `identity_score` in `backend/app/models/orm.py`; 32 tests in `test_face_first_matching.py` (all passing) | Thresholds explicitly uncalibrated |
| P4-4 | SOLIDER body backbone in galleries | **COMPLETED** | All 3 body galleries verified 768-d: C01=89, C02=44, C03=97 records; face galleries 512-d (89/44/97); KPR galleries 512-d holistic (89/44/97) | Backbone-aware thresholds for SOLIDER (0.94/0.90) marked "NOT calibrated" in `backend/app/config.py` |
| P4-5 | 5-camera support | **PARTIALLY COMPLETED** | `dataset/camera_graph.json` defines C01–C05; C04/C05 have `mvp=false` | `backend/app/routers/upload.py` hard-rejects C04/C05 (`valid_cameras = {"C01","C02","C03"}`); `pipeline_service.py` uses `mvp_cameras = ["C01","C02","C03"]`. No C04/C05 galleries exist. |
| P4-6 | Formal labelled cross-camera evaluation | **NOT COMPLETED** | No `ground_truth.json` anywhere (glob: no matches); `dataset/metadata.csv` is **empty** (filming plan in `docs/filming_plan.md` never executed); no evaluation script computes route accuracy against labels | Everything: labelled footage, ground-truth file, evaluation script |
| P4-7 | Confidence calibration | **NOT COMPLETED** | `backend/app/config.py`: `similarity_observed_min/max` constants carried over from OSNet-era C01 analysis; `face_match_threshold=0.38` commented "NOT calibrated"; SOLIDER thresholds "NOT calibrated". Phase 5.7 doc itself admits threshold failed unknown-person test (sim 0.7267 > 0.70) | No recalibration for SOLIDER distribution; no ROC/PR analysis |
| P4-8 | Direction estimation | **NOT COMPLETED** | Documentation §13 marks it ❌. Content grep for `direction|heading|velocity|kalman` across `**/*.py` matches only incidental mentions in test/sanity scripts (`timeline_check.py`, `sanity_check.py`, tests) — no direction/heading module exists | Full implementation |

### 3.2 Phase 4 summary

| Status | Count |
|---|---|
| COMPLETED | 4 |
| PARTIALLY COMPLETED | 1 |
| NOT COMPLETED | 3 |
| NOT VERIFIABLE | 0 |

---

## 4. Phase 5 — Verified Item Status

### 4.1 Target-search sub-experiments (`docs/phase5_*.md`, 5.1–5.8)

| # | Item | Status | Evidence | Remaining gap |
|---|---|---|---|---|
| P5e-1 | Query variant generation (5.1) | **COMPLETED** | `ai_pipeline/reid/gen_query_variants.py`; 10 query images exist on disk (`dataset/query_photos/query_track13/`, `query_track16/` — 5 each) plus Track-29 set | — |
| P5e-2 | Track 29 contamination discovery + clean-track selection (5.2–5.3) | **COMPLETED** | Contact sheets exist: `dataset/target_search/inspection/track_{13,16,29,66}_contact_sheet.jpg`; documented in `docs/phase5_query_variant_results.md` | — |
| P5e-3 | Query-variant robustness run (5.4) | **PARTIALLY COMPLETED** | Script `test_query_variants_tracks.py` exists; results file `dataset/query_variant_track_test.json` exists with data | Results were produced on Colab; the result tables in the doc remain "—" placeholders — the doc was never updated with the JSON values, so the documented experiment is only half-closed |
| P5e-4 | Target search CLI (5.8) | **COMPLETED** | `ai_pipeline/reid/target_search.py` with `--query/--gallery/--top-k/--output/--format`; unit tests passing in this audit's suite run | — |
| P5e-5 | Validation framework + contact sheets (5.6) | **COMPLETED** | `ai_pipeline/reid/validate_phase5_6.py`; all 3 validation sheets exist on disk (`dataset/target_search/validation_sheets/*.jpg`); judgment tables filled in the doc | Small sample (3 queries), single camera — acknowledged in doc |
| P5e-6 | No-match threshold (5.7) — implementation | **COMPLETED** | Threshold logic in `target_search.py`; config key present; 6 unit tests (`TestNoMatchThreshold`) all passing in this audit | — |
| P5e-7 | No-match threshold (5.7) — real-world Colab tests | **NOT VERIFIABLE** | Doc claims results (unknown person sim 0.7267; known person 0.8148), but the claimed output files `unknown_person_result.json` and `known_person_regression.json` are **absent** from the repository (`ls` fails). Only the query image `dataset/query_photos/unknown/test_unknown.jpg` exists | Result artifacts must be committed, or the test re-run |

### 4.2 Roadmap Phase 5 (Optimisation & Production)

| # | Item | Status | Evidence |
|---|---|---|---|
| P5r-1 | Vector indexing (FAISS or similar) | **NOT COMPLETED** | Glob `**/*faiss*`: no matches; similarity search is brute-force NumPy (`ai_pipeline/reid/similarity.py`) |
| P5r-2 | ONNX model export | **NOT COMPLETED** | Glob `**/*.onnx`: no matches |
| P5r-3 | Deployment / containerization | **NOT COMPLETED** | No `Dockerfile`, no `docker-compose*` anywhere; `docs/scope.md` explicitly defers it |
| P5r-4 | Authentication / multi-user | **NOT COMPLETED** | Grep `jwt|oauth|login|authenticate|Bearer` in `backend/`: no matches; `docs/scope.md` defers it |
| P5r-5 | Formal evaluation harness (metrics scripts) | **NOT COMPLETED** | No script computing route accuracy / CMC / mAP against ground truth (see P4-6) |
| P5r-6 | Re-ID fine-tuning | **NOT COMPLETED** | No training code or labelled dataset; deferred by scope |

### 4.3 Phase 5 summary

| Status | Count |
|---|---|
| COMPLETED | 4 |
| PARTIALLY COMPLETED | 1 |
| NOT COMPLETED | 7 |
| NOT VERIFIABLE | 1 |

---

## 5. Combined Tally

| Status | Phase 4 | Phase 5 | Total |
|---|---|---|---|
| COMPLETED | 4 | 4 | **8** |
| PARTIALLY COMPLETED | 1 | 1 | **2** |
| NOT COMPLETED | 3 | 7 | **10** |
| NOT VERIFIABLE | 0 | 1 | **1** |
| **Total audited** | 8 | 13 | **21** |

**8 of 21 items verified complete.** Because 13 items are not fully complete, the completion condition ("every required item is COMPLETED") is not met.

---

## 6. Additional Audit Observations (evidence-based, no code changed)

1. **Documentation/data drift:** Several docs still describe OSNet 512-d galleries (`docs/phase5_new_video_search.md`, the 3 failing tests, `.env`), while the committed galleries are SOLIDER 768-d. Anyone following those docs verbatim will hit the same 3 test failures observed here.
2. **Threshold config inconsistency:** `docs/phase5_7_no_match.md` says the threshold is 0.70; `ai_pipeline/config.yaml` holds 0.74 and `backend/app/config.py` uses 0.74/0.60 for OSNet and 0.94/0.90 for SOLIDER. The 0.70 figure is stale relative to the code.
3. **`README.md` claims "99.8% accuracy"** — no repository artifact supports any accuracy figure; the technical document itself (§12.2) questions this claim.
4. **Demo criteria in `docs/scope.md` are unmet:** criterion 1 (blind test set) and criterion 2 (route matches ground truth) cannot be satisfied because no labelled/blind footage or ground truth exists in the repo (`dataset/metadata.csv` empty, no `ground_truth.json`).
5. **Honest failures already documented:** Phase 5.7's unknown-person threshold failure (0.7267 > 0.70, system returned candidates for a person not in the gallery) is documented openly. This audit confirms the implementation matches that description, but the supporting result JSONs are not committed.

---

## 7. Decision

Per the audit rule: *"If any required item is PARTIALLY COMPLETED, NOT COMPLETED, or NOT VERIFIABLE, do not falsely declare the entire project complete."*

- **`end.md` was not created.**
- This audit report is the deliverable.

### Shortest path to a future completion audit

1. Execute the filming plan → populate `dataset/metadata.csv` and a `ground_truth.json`.
2. Re-run the Phase 5.7 Colab tests and commit the result JSONs (or delete the claimed results from the doc).
3. Recalibrate confidence/threshold constants for the SOLIDER distribution; fix the 3 stale 512-d test assertions or keep dual-backbone expectations explicit.
4. Implement or formally descope direction estimation, C04/C05 activation, and route-accuracy evaluation.
5. Update `docs/phase5_query_variant_results.md` result tables from the existing `dataset/query_variant_track_test.json`.

---

## 8. Evidence Locations

| Evidence | Path |
|---|---|
| Technical documentation (audited against) | `TRACE_PROJECT_TECHNICAL_DOCUMENTATION.md` |
| MVP scope & demo criteria | `docs/scope.md` |
| Phase docs | `docs/phase4_reid.md`, `docs/phase4_identity_policy.md`, `docs/phase5_3.md`…`phase5_7_no_match.md`, `phase5_new_video_search.md`, `phase5_query_variant_results.md`, `phase5_6_validation.md` |
| Face-first policy | `ai_pipeline/reid/matching.py`, `backend/app/services/matching_service.py` |
| Route reconstruction | `backend/app/services/route_service.py` |
| Pipeline orchestration | `backend/app/services/pipeline_service.py`, `backend/app/routers/upload.py` |
| Config/thresholds | `ai_pipeline/config.yaml`, `backend/app/config.py`, `.env` |
| Camera graph | `dataset/camera_graph.json` |
| Galleries (SOLIDER 768-d body, face/KPR 512-d) | `dataset/embeddings_C0{1,2,3}.json`, `dataset/face_embeddings_C0{1,2,3}.json`, `dataset/kpr_embeddings_C0{1,2,3}.json` |
| Validation artifacts | `dataset/target_search/validation_sheets/`, `dataset/target_search/inspection/` |
| Variant results | `dataset/query_variant_track_test.json` |
| Empty ground-truth proxy | `dataset/metadata.csv` (empty) |
| Server entrypoint | `run.py` |
# Databricks Apps Load Test Results — agent_app_1000_load_test

**Date:** 2026-04-03
**Ramp:** 20 users/step, 45s/step, max 1000 concurrent users (50 steps, ~37 min per app)
**Mock config:** 80 chunks @ 10ms delay per response
**Auth:** M2M OAuth (service principal)
**Workspace:** eng-ml-inference-team-eu-central-1

---

## Results Summary

| Config | Compute | Workers | Peak QPS | Users @ Peak | Total Reqs | Fail % | p50 | p95 | TTFT p50 | TTFT p95 |
|--------|---------|---------|----------|-------------|------------|--------|-----|-----|----------|----------|
| medium_2w | Medium | 2 | 139 | 340 | 101,506 | 3.5% | 920ms | 3500ms | 1500ms | 3800ms |
| medium_4w | Medium | 4 | 126 | 180 | 71,031 | 0.3% | 820ms | 1900ms | 1200ms | 2400ms |
| medium_6w | Medium | 6 | 119 | 120 | 111,892 | 1.1% | 680ms | 1100ms | 970ms | 1800ms |
| medium_8w | Medium | 8 | 115 | 100 | 108,022 | 0.0% | 870ms | 1500ms | 1500ms | 3000ms |
| large_6w | Large | 6 | 292* | 1000 | 198,164 | 12.4% | 530ms | 1500ms | 610ms | 1600ms |
| large_8w | Large | 8 | 407* | 360 | 204,587 | 5.5% | 600ms | 1500ms | 760ms | 1700ms |
| large_10w | Large | 10 | 283 | 440 | 229,496 | 0.0% | 770ms | 2200ms | 990ms | 2700ms |
| large_12w | Large | 12 | 247 | 300 | 127,713 | 0.3% | 640ms | 2000ms | 730ms | 2200ms |

*Peak QPS is inflated — see analysis below.

---

## Analysis

### Medium Compute — caps at ~100-120 QPS

All medium configs hit a throughput ceiling around 100-120 QPS regardless of worker count. The CPU/memory of medium compute is the bottleneck, not the number of workers.

**medium_2w (2 workers):** Unstable. QPS fluctuated wildly throughout the test, including periods of 0 QPS at 200-240 users (app likely restarting). The 139 QPS "peak" is a burst, not sustained. Effective throughput ~100-110 QPS. 3.5% failure rate.

**medium_4w (4 workers):** Crashed between 400-640 users — 0 QPS for roughly 10 minutes, then recovered and sustained ~100-115 QPS for the remainder. 0.3% overall failure rate but unreliable under heavy load.

**medium_6w (6 workers):** Cleanest medium config. Plateaued at ~100-105 QPS from 120 users onward and held steady through 1000 users. Low latency (680ms p50, best among medium configs). One brief dip at 600 users.

**medium_8w (8 workers):** Most reliable — 0.0% failure rate across 108k requests. However, QPS gradually degraded from 115 → 94 as users increased, suggesting the extra workers add per-request overhead on medium compute without increasing throughput.

**Medium verdict:** 6 workers is the sweet spot — best throughput-to-stability ratio. 8 workers is safest (zero failures) but slightly lower peak.

### Large Compute — caps at ~250-280 QPS sustained

Large compute delivers roughly 2.5x the throughput of medium, but worker count matters more — too few or too many both cause problems.

**large_6w (6 workers):** Hit a burst of failures at 620 users where all 260 req/s failed (100% instantaneous failure rate). Also had failures at 60 users during warmup. 12.4% overall failure rate — the worst of all configs. The app was still ramping at 1000 users (292 QPS peak at the very end), indicating 6 workers is underpowered for large compute.

**large_8w (8 workers):** The reported 407 QPS peak is misleading — at 340 users, 33.4 req/s were 100% failures. At 360 users, 406.9 req/s were **100% failures** (the app was returning errors very fast, inflating "QPS"). The app went dead at 260, 380, and 440 users (likely restarting from overload). After recovery at 460 users, it sustained a clean ~220-250 QPS with 0% failures through 1000 users. Real sustained peak: **~250-270 QPS**.

**large_10w (10 workers):** Best large config. Sustained 200-280 QPS cleanly with **0.0% failure rate** across 229k requests — the highest total request count of any config. One brief dip at 360 users (likely app restart), but recovered fully. Clean ramp from 20 → 440 users, then stable plateau through 1000.

**large_12w (12 workers):** Peaked at 247 QPS at 300 users, then crashed hard at 520 users — 0 QPS for an extended period (520-700 users). Never fully recovered, with sporadic failures and near-zero QPS through the rest of the test. Too many workers causes memory pressure on large compute, leading to OOM-like crashes.

**Large verdict:** 10 workers is the clear winner — highest sustained throughput, zero failures, most total requests served.

---

## Recommendations

| Use case | Compute | Workers | Expected QPS | Notes |
|----------|---------|---------|-------------|-------|
| Cost-effective | Medium | 6 | ~105 QPS | Best balance of throughput + stability on medium |
| Reliable (zero failures) | Medium | 8 | ~100 QPS | Slightly lower throughput but 0% failures |
| High throughput | Large | 10 | ~260 QPS | 2.5x medium, zero failures, clear winner |
| Not recommended | Large | 12 | ~247 QPS peak, crashes | Too many workers causes OOM-like crashes |
| Not recommended | Large | 6 | ~250 QPS but 12% failures | Underpowered, high failure rate |

**Key takeaways:**
- Medium compute caps at ~100-120 QPS — adding workers beyond 6-8 doesn't help
- Large compute caps at ~250-280 QPS — 10 workers is the sweet spot
- Large compute gives ~2.5x the throughput of medium
- More workers is not always better — large_12w crashed while large_10w was clean
- Peak QPS numbers can be misleading when failures are high — always check the failure rate alongside QPS

---

## Interactive Dashboard

View the full interactive dashboard with charts and ramp progression:

```bash
open load-test-runs/agent_app_1000_load_test/dashboard.html
```

# Databricks Apps Load Test Analysis

## Test Configuration

- **Runs:** 5 identical rounds (`agent_app_1000_10s_load_test_r1` through `r5`)
- **Max concurrent users:** 1,000
- **Step size:** 20 users/step
- **Step duration:** 10 seconds/step
- **Ramp shape:** 20 → 1,000 users (50 steps per config)
- **Apps tested:** 8 configurations (4 medium, 4 large)
- **Mock agent:** Streaming responses with ~95 chunks per request
- **Total requests across all runs:** 1,456,480

## Results Summary

### Per-Config Results (averaged across 5 runs)

| Config | Compute | Workers | Avg Peak QPS | Peak Range | Avg QPS | TTFT p50 | Latency p50 | Fail % |
|--------|---------|---------|-------------|------------|---------|----------|-------------|--------|
| medium_2w | Medium | 2 | **155.1** | 137.0–166.6 | 47.4 | 1,820ms | 1,180ms | 0.0% |
| medium_4w | Medium | 4 | 116.5 | 112.6–121.8 | 45.0 | 1,720ms | 1,140ms | 0.1% |
| medium_6w | Medium | 6 | 111.9 | 102.6–117.5 | 44.7 | 1,740ms | 1,160ms | 0.0% |
| medium_8w | Medium | 8 | 110.3 | 108.3–112.1 | 44.8 | 1,720ms | 1,140ms | 0.0% |
| large_6w | Large | 6 | 281.6 | 268.2–292.4 | 103.1 | 1,100ms | 908ms | 0.0% |
| large_8w | Large | 8 | 268.2 | 265.8–271.0 | 99.3 | 1,100ms | 920ms | 0.0% |
| large_10w | Large | 10 | **288.1** | 280.3–299.4 | 100.9 | 1,100ms | 906ms | 0.0% |
| large_12w | Large | 12 | 274.2 | 269.4–278.8 | 97.0 | 1,100ms | 916ms | 0.0% |

### By Compute Size

| Compute | Avg Peak QPS | Avg QPS |
|---------|-------------|---------|
| Medium | 123.5 | 45.5 |
| Large | 278.0 | 100.1 |

Large compute delivers **~2.2x** the throughput of medium compute on both peak and average QPS.

### Per-Run Peak QPS (consistency check)

| Config | r1 | r2 | r3 | r4 | r5 | Std Dev |
|--------|-----|-----|-----|-----|-----|---------|
| medium_2w | 137.0 | 153.6 | 165.0 | 166.6 | 153.2 | 11.9 |
| medium_4w | 121.8 | 112.6 | 114.1 | 116.8 | 117.2 | 3.5 |
| medium_6w | 102.6 | 116.1 | 111.9 | 111.6 | 117.5 | 5.8 |
| medium_8w | 112.0 | 108.3 | 112.1 | 110.4 | 108.8 | 1.8 |
| large_6w | 284.0 | 292.4 | 283.8 | 268.2 | 279.8 | 8.8 |
| large_8w | 265.8 | 267.4 | 267.8 | 269.1 | 271.0 | 1.9 |
| large_10w | 283.6 | 290.0 | 299.4 | 280.3 | 287.2 | 7.3 |
| large_12w | 278.8 | 273.9 | 273.7 | 275.3 | 269.4 | 3.4 |

Results are consistent across runs. Most configs have a standard deviation under 10 QPS, indicating stable and reproducible measurements.

## Key Findings

### 1. More workers is not always better

**Medium compute:** 2 workers (155.1 QPS) outperforms 4 workers (116.5 QPS) by 33%. Adding workers beyond 2 on medium compute causes CPU/memory contention that outweighs the parallelism benefit.

**Large compute:** Performance is relatively flat across 6–12 workers (268–288 QPS, within ~7%). 10 workers edges out slightly at 288.1 QPS, but the differences are within noise.

### 2. Recommended worker configurations

| Compute Size | Recommended Workers | Expected Peak QPS |
|-------------|--------------------|--------------------|
| Medium | **2** | ~155 QPS |
| Large | **8** (safe default in the 6–10 plateau) | ~280 QPS |

### 3. Near-zero failure rate

All configurations maintained a failure rate at or near 0% across all 5 runs, even at 1,000 concurrent users. The Apps infrastructure handles high concurrency gracefully.

### 4. Latency characteristics

- **Large compute** has ~20% lower latency than medium (906ms vs 1,180ms p50)
- **TTFT** follows the same pattern: 1,100ms (large) vs 1,720–1,820ms (medium)
- Latency is relatively stable across worker counts within the same compute size

## Dashboards

Individual run dashboards are available at:
- `load-test-runs/agent_app_1000_10s_load_test_r1/dashboard.html`
- `load-test-runs/agent_app_1000_10s_load_test_r2/dashboard.html`
- `load-test-runs/agent_app_1000_10s_load_test_r3/dashboard.html`
- `load-test-runs/agent_app_1000_10s_load_test_r4/dashboard.html`
- `load-test-runs/agent_app_1000_10s_load_test_r5/dashboard.html`

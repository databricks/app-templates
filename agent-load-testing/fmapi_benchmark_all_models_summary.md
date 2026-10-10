# Databricks FMAPI Streaming Benchmark - All Models Combined

**Date:** 2026-03-31
**Host:** eng-ml-agent-platform.staging.cloud.databricks.com
**Prompt:** "Calculate the 10th fibonacci number using python code and execute it."
**Runs per config:** 5
**Streaming:** Yes (SSE)

## Methodology

This benchmark uses **raw HTTP streaming** via the `httpx` Python library, sending
POST requests directly to each model's `/serving-endpoints/<model>/invocations`
endpoint with `"stream": true`. This is equivalent to using `curl` — no SDK
abstraction layer is involved. The payload uses the **OpenAI Chat Completions
format** (`messages` / `max_tokens`), and the response is parsed as Server-Sent
Events (SSE) with `data: {json}` lines.

```python
# Equivalent curl:
curl -N -X POST "$DATABRICKS_HOST/serving-endpoints/$MODEL/invocations" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"..."}],"stream":true}'
```

For the same benchmark using the `DatabricksOpenAI` SDK with the Responses API
(`client.responses.create(stream=True)`), see `fmapi_benchmark_responses_api.md`.

## Overall Model Ranking (averaged across all max_tokens configs)

| Rank | Model | Avg Total (ms) | Avg TTFT (ms) | Avg Chunks | Avg Inter-Chunk (ms) | Notes |
|-----:|-------|---------------:|-------------:|----------:|--------------------:|-------|
| 1 | gpt-5-4-mini | ~1,100 | ~730 | ~80 | ~4.7 | Fastest overall |
| 2 | gpt-5-4-nano | ~1,430 | ~680 | ~114 | ~6.4 | Very fast, most chunks |
| 3 | gpt-5-4 | ~1,590 | ~700 | ~84 | ~10.3 | Consistent performer |
| 4 | gpt-5-2 | ~1,990 | ~900 | ~83 | ~12.5 | Slightly slower GPT |
| 5 | qwen3-next-80b-a3b-instruct | ~3,750 | ~1,130 | ~294 | ~8.9 | Very fast TTFT, verbose |
| 6 | claude-3-7-sonnet | ~4,160 | ~910 | ~63 | ~54 | Consistent, larger chunks |
| 7 | claude-opus-4-6 | ~5,450 | ~2,250 | ~60 | ~53 | Highest quality, slowest Anthropic |
| 8 | gemini-3-flash | ~5,240 | ~4,530 | ~5 | ~173 | Few giant chunks |
| 9 | gemini-3-1-pro | ~8,280 | ~7,170 | ~4 | ~304 | Very high TTFT, batched output |
| 10 | gemini-3-1-flash-lite | N/A | N/A | N/A | N/A | 502 errors - endpoint broken |

## Detailed Summary Table (all configs)

### Original 6 Models

| Config | Model | Avg Total (ms) | Avg TTFT (ms) | Avg Chunks | Avg Inter-Chunk (ms) | Avg Resp Len |
|--------|-------|---------------:|-------------:|----------:|--------------------:|------------:|
| no_limit | claude-3-7-sonnet | 3953 | 832 | 52 | 62.5 | 690 |
| no_limit | gpt-5-4 | 1511 | 626 | 86 | 10.0 | 231 |
| no_limit | gpt-5-4-mini | 959 | 525 | 79 | 5.1 | 244 |
| no_limit | claude-opus-4-6 | 6110 | 2379 | 65 | 57.1 | 738 |
| no_limit | gemini-3-1-pro | 11443 | 9502 | 5 | 471.8 | 649 |
| no_limit | gemini-3-1-flash-lite | ERROR | ERROR | ERROR | ERROR | ERROR |
| max_tokens=500 | claude-3-7-sonnet | 4009 | 918 | 72 | 44.8 | 688 |
| max_tokens=500 | gpt-5-4 | 1455 | 648 | 81 | 9.7 | 222 |
| max_tokens=500 | gpt-5-4-mini | 1328 | 880 | 86 | 4.7 | 270 |
| max_tokens=500 | claude-opus-4-6 | 5491 | 2559 | 59 | 50.4 | 709 |
| max_tokens=500 | gemini-3-1-pro | 7909 | 7619 | 2 | 113.9 | 272 |
| max_tokens=500 | gemini-3-1-flash-lite | ERROR | ERROR | ERROR | ERROR | ERROR |
| max_tokens=1000 | claude-3-7-sonnet | 4402 | 951 | 60 | 59.4 | 728 |
| max_tokens=1000 | gpt-5-4 | 1727 | 822 | 87 | 10.0 | 236 |
| max_tokens=1000 | gpt-5-4-mini | 1080 | 722 | 73 | 4.3 | 217 |
| max_tokens=1000 | claude-opus-4-6 | 5216 | 2047 | 59 | 54.0 | 686 |
| max_tokens=1000 | gemini-3-1-pro | 7040 | 5985 | 4 | 309.2 | 600 |
| max_tokens=1000 | gemini-3-1-flash-lite | ERROR | ERROR | ERROR | ERROR | ERROR |
| max_tokens=10000 | claude-3-7-sonnet | 4294 | 937 | 69 | 49.5 | 732 |
| max_tokens=10000 | gpt-5-4 | 1664 | 696 | 81 | 11.4 | 230 |
| max_tokens=10000 | gpt-5-4-mini | 1206 | 806 | 81 | 4.6 | 249 |
| max_tokens=10000 | claude-opus-4-6 | 4964 | 2004 | 59 | 50.7 | 703 |
| max_tokens=10000 | gemini-3-1-pro | 6730 | 5585 | 5 | 321.5 | 594 |
| max_tokens=10000 | gemini-3-1-flash-lite | ERROR | ERROR | ERROR | ERROR | ERROR |

### Additional 4 Models

| Config | Model | Avg Total (ms) | Avg TTFT (ms) | Avg Chunks | Avg Inter-Chunk (ms) | Avg Resp Len |
|--------|-------|---------------:|-------------:|----------:|--------------------:|------------:|
| no_limit | gpt-5-4-nano | 1136 | 588 | 101 | 5.2 | 293 |
| no_limit | gpt-5-2 | 1768 | 740 | 79 | 12.3 | 227 |
| no_limit | gemini-3-flash | 5620 | 4635 | 5 | 225.7 | 622 |
| no_limit | qwen3-next-80b-a3b-instruct | 6599 | 3375 | 363 | 8.8 | 1014 |
| max_tokens=500 | gpt-5-4-nano | 1472 | 543 | 124 | 7.6 | 337 |
| max_tokens=500 | gpt-5-2 | 2396 | 1206 | 86 | 13.1 | 243 |
| max_tokens=500 | gemini-3-flash | 4401 | 4342 | 2 | 38.2 | 154 |
| max_tokens=500 | qwen3-next-80b-a3b-instruct | 2670 | 306 | 266 | 8.9 | 783 |
| max_tokens=1000 | gpt-5-4-nano | 1681 | 1047 | 92 | 6.5 | 259 |
| max_tokens=1000 | gpt-5-2 | 1853 | 760 | 86 | 12.2 | 244 |
| max_tokens=1000 | gemini-3-flash | 5322 | 4319 | 6 | 217.5 | 646 |
| max_tokens=1000 | qwen3-next-80b-a3b-instruct | 3167 | 457 | 305 | 8.8 | 830 |
| max_tokens=10000 | gpt-5-4-nano | 1446 | 538 | 138 | 6.3 | 412 |
| max_tokens=10000 | gpt-5-2 | 1946 | 900 | 81 | 12.5 | 239 |
| max_tokens=10000 | gemini-3-flash | 5623 | 4813 | 5 | 209.4 | 583 |
| max_tokens=10000 | qwen3-next-80b-a3b-instruct | 2546 | 388 | 242 | 8.9 | 680 |

## Cross-Config Comparison - All 10 Models (Avg Total Time ms)

| Model | no_limit | max_tokens=500 | max_tokens=1000 | max_tokens=10000 |
|-------|------:|------:|------:|------:|
| gpt-5-4-mini | 959 | 1328 | 1080 | 1206 |
| gpt-5-4-nano | 1136 | 1472 | 1681 | 1446 |
| gpt-5-4 | 1511 | 1455 | 1727 | 1664 |
| gpt-5-2 | 1768 | 2396 | 1853 | 1946 |
| qwen3-next-80b-a3b-instruct | 6599 | 2670 | 3167 | 2546 |
| claude-3-7-sonnet | 3953 | 4009 | 4402 | 4294 |
| claude-opus-4-6 | 6110 | 5491 | 5216 | 4964 |
| gemini-3-flash | 5620 | 4401 | 5322 | 5623 |
| gemini-3-1-pro | 11443 | 7909 | 7040 | 6730 |
| gemini-3-1-flash-lite | ERROR | ERROR | ERROR | ERROR |

## Cross-Config Comparison - All 10 Models (Avg TTFT ms)

| Model | no_limit | max_tokens=500 | max_tokens=1000 | max_tokens=10000 |
|-------|------:|------:|------:|------:|
| qwen3-next-80b-a3b-instruct | 3375 | 306 | 457 | 388 |
| gpt-5-4-mini | 525 | 880 | 722 | 806 |
| gpt-5-4-nano | 588 | 543 | 1047 | 538 |
| gpt-5-4 | 626 | 648 | 822 | 696 |
| gpt-5-2 | 740 | 1206 | 760 | 900 |
| claude-3-7-sonnet | 832 | 918 | 951 | 937 |
| claude-opus-4-6 | 2379 | 2559 | 2047 | 2004 |
| gemini-3-flash | 4635 | 4342 | 4319 | 4813 |
| gemini-3-1-pro | 9502 | 7619 | 5985 | 5585 |
| gemini-3-1-flash-lite | ERROR | ERROR | ERROR | ERROR |

## Key Observations

1. **GPT family dominates speed**: gpt-5-4-mini, gpt-5-4-nano, and gpt-5-4 are all under 1.7s total with TTFT ~500-700ms
2. **Qwen3 has the fastest TTFT** (~300ms with max_tokens set) but high variance without limits (first run had 15s TTFT)
3. **Gemini models batch output**: Only 4-6 chunks total vs 60-140 for other models — they accumulate the full response then dump it
4. **Claude models are consistent**: Low stdev across runs, ~50ms inter-chunk delay, moderate TTFT
5. **max_output_tokens has minimal impact** on latency for this prompt (response is naturally short)
6. **gemini-3-1-flash-lite is broken**: Returns 502 on all requests (streaming and non-streaming)
7. **For mock agent calibration**: MOCK_CHUNK_DELAY_MS=5, MOCK_CHUNK_COUNT=15 remains a good lower-bound representing fast GPT-class models

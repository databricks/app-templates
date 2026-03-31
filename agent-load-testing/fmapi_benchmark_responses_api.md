# Databricks FMAPI Benchmark — DatabricksOpenAI Responses API

**Date:** 2026-03-31
**Host:** eng-ml-agent-platform.staging.cloud.databricks.com
**Client:** `DatabricksOpenAI` (databricks-openai package, from [databricks-ai-bridge](https://github.com/databricks/databricks-ai-bridge))
**API:** `client.responses.create(stream=True)` (Responses API)
**Prompt:** "Calculate the 10th fibonacci number using python code and execute it."
**Runs per config:** 5

## Methodology

This benchmark uses the official **`DatabricksOpenAI`** client from the
[databricks-ai-bridge](https://github.com/databricks/databricks-ai-bridge) package
with the **Responses API** (`client.responses.create(stream=True)`). Unlike the
raw HTTP benchmark (see `fmapi_benchmark_all_models_summary.md`), this measures
end-to-end latency through the recommended SDK abstraction layer, which is how
application code (e.g., Databricks Apps agents) actually calls these models.

```python
from databricks_openai import DatabricksOpenAI

client = DatabricksOpenAI()
stream = client.responses.create(
    model="databricks-gpt-5-4",
    input=[{"role": "user", "content": "..."}],
    max_output_tokens=1000,
    stream=True,
)
for event in stream:
    if event.type == "response.output_text.delta":
        # process chunk
```

**Important limitation:** As of 2026-03-31, the Responses API passthrough only
supports GPT models on Databricks FMAPI. All non-GPT models (Claude, Gemini,
Qwen) return `400 BAD_REQUEST: "Responses API passthrough is not supported for
this model"`. For those models, use the Chat Completions API via raw HTTP or
`client.chat.completions.create()` instead (see `fmapi_benchmark_all_models_summary.md`).

For comparison between the two approaches on GPT models, the Responses API
consistently shows **lower TTFT** (~230-380ms vs ~540-900ms via raw HTTP),
likely because it connects to the `/responses` endpoint directly rather than
going through the Chat Completions SSE translation layer.

## Summary Table

| Config | Model | Avg Total (ms) | Avg TTFT (ms) | Avg Chunks | Avg Inter-Chunk (ms) | Avg Resp Len |
|--------|-------|---------------:|-------------:|----------:|--------------------:|------------:|
| no_limit | claude-3-7-sonnet | ERROR | ERROR | ERROR | ERROR | ERROR |
| no_limit | gpt-5-4 | 1345 | 275 | 69 | 14.8 | 189 |
| no_limit | gpt-5-4-mini | 1448 | 749 | 80 | 8.1 | 244 |
| no_limit | gpt-5-4-nano | 1482 | 378 | 110 | 9.8 | 316 |
| no_limit | gpt-5-2 | 1544 | 268 | 78 | 15.5 | 218 |
| no_limit | claude-opus-4-6 | ERROR | ERROR | ERROR | ERROR | ERROR |
| no_limit | gemini-3-1-pro | ERROR | ERROR | ERROR | ERROR | ERROR |
| no_limit | gemini-3-flash | ERROR | ERROR | ERROR | ERROR | ERROR |
| no_limit | gemini-3-1-flash-lite | ERROR | ERROR | ERROR | ERROR | ERROR |
| no_limit | qwen3-next-80b-a3b-instruct | ERROR | ERROR | ERROR | ERROR | ERROR |
| max_tokens=500 | claude-3-7-sonnet | ERROR | ERROR | ERROR | ERROR | ERROR |
| max_tokens=500 | gpt-5-4 | 1607 | 262 | 69 | 19.6 | 192 |
| max_tokens=500 | gpt-5-4-mini | 980 | 263 | 75 | 8.7 | 224 |
| max_tokens=500 | gpt-5-4-nano | 1165 | 236 | 138 | 6.6 | 384 |
| max_tokens=500 | gpt-5-2 | 1881 | 475 | 80 | 16.7 | 226 |
| max_tokens=500 | claude-opus-4-6 | ERROR | ERROR | ERROR | ERROR | ERROR |
| max_tokens=500 | gemini-3-1-pro | ERROR | ERROR | ERROR | ERROR | ERROR |
| max_tokens=500 | gemini-3-flash | ERROR | ERROR | ERROR | ERROR | ERROR |
| max_tokens=500 | gemini-3-1-flash-lite | ERROR | ERROR | ERROR | ERROR | ERROR |
| max_tokens=500 | qwen3-next-80b-a3b-instruct | ERROR | ERROR | ERROR | ERROR | ERROR |
| max_tokens=1000 | claude-3-7-sonnet | ERROR | ERROR | ERROR | ERROR | ERROR |
| max_tokens=1000 | gpt-5-4 | 1443 | 241 | 81 | 14.0 | 225 |
| max_tokens=1000 | gpt-5-4-mini | 886 | 253 | 79 | 7.5 | 247 |
| max_tokens=1000 | gpt-5-4-nano | 950 | 236 | 103 | 6.3 | 293 |
| max_tokens=1000 | gpt-5-2 | 1531 | 255 | 68 | 17.1 | 169 |
| max_tokens=1000 | claude-opus-4-6 | ERROR | ERROR | ERROR | ERROR | ERROR |
| max_tokens=1000 | gemini-3-1-pro | ERROR | ERROR | ERROR | ERROR | ERROR |
| max_tokens=1000 | gemini-3-flash | ERROR | ERROR | ERROR | ERROR | ERROR |
| max_tokens=1000 | gemini-3-1-flash-lite | ERROR | ERROR | ERROR | ERROR | ERROR |
| max_tokens=1000 | qwen3-next-80b-a3b-instruct | ERROR | ERROR | ERROR | ERROR | ERROR |
| max_tokens=10000 | claude-3-7-sonnet | ERROR | ERROR | ERROR | ERROR | ERROR |
| max_tokens=10000 | gpt-5-4 | 1478 | 245 | 78 | 15.1 | 216 |
| max_tokens=10000 | gpt-5-4-mini | 825 | 241 | 80 | 6.7 | 241 |
| max_tokens=10000 | gpt-5-4-nano | 923 | 228 | 103 | 6.1 | 292 |
| max_tokens=10000 | gpt-5-2 | 1610 | 224 | 83 | 16.1 | 244 |
| max_tokens=10000 | claude-opus-4-6 | ERROR | ERROR | ERROR | ERROR | ERROR |
| max_tokens=10000 | gemini-3-1-pro | ERROR | ERROR | ERROR | ERROR | ERROR |
| max_tokens=10000 | gemini-3-flash | ERROR | ERROR | ERROR | ERROR | ERROR |
| max_tokens=10000 | gemini-3-1-flash-lite | ERROR | ERROR | ERROR | ERROR | ERROR |
| max_tokens=10000 | qwen3-next-80b-a3b-instruct | ERROR | ERROR | ERROR | ERROR | ERROR |

## Config: no_limit

### databricks-claude-3-7-sonnet

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 136 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 68 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 73 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 52 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 72 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

### databricks-gpt-5-4

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 1324 | 358 | 56 | 16.1 | 155 | OK |
| 2 | 1293 | 304 | 56 | 15.8 | 155 | OK |
| 3 | 1445 | 218 | 87 | 13.4 | 233 | OK |
| 4 | 1238 | 252 | 59 | 15.3 | 171 | OK |
| 5 | 1424 | 241 | 86 | 13.2 | 229 | OK |
| **Avg** | **1345** | **275** | **69** | **14.8** | **189** | 5/5 OK |
| **Stdev** | 88 | 56 | 16 | - | 39 | - |

### databricks-gpt-5-4-mini

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 1315 | 565 | 87 | 7.8 | 268 | OK |
| 2 | 778 | 256 | 54 | 9.3 | 142 | OK |
| 3 | 837 | 244 | 90 | 5.9 | 286 | OK |
| 4 | 3285 | 2417 | 86 | 9.2 | 268 | OK |
| 5 | 1027 | 265 | 84 | 8.2 | 254 | OK |
| **Avg** | **1448** | **749** | **80** | **8.1** | **244** | 5/5 OK |
| **Stdev** | 1048 | 942 | 15 | - | 58 | - |

### databricks-gpt-5-4-nano

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 1036 | 358 | 102 | 6.0 | 287 | OK |
| 2 | 1258 | 438 | 127 | 6.0 | 362 | OK |
| 3 | 983 | 261 | 110 | 6.0 | 313 | OK |
| 4 | 3127 | 566 | 102 | 24.8 | 283 | OK |
| 5 | 1009 | 269 | 109 | 6.3 | 333 | OK |
| **Avg** | **1482** | **378** | **110** | **9.8** | **316** | 5/5 OK |
| **Stdev** | 926 | 127 | 10 | - | 33 | - |

### databricks-gpt-5-2

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 1688 | 289 | 85 | 15.9 | 242 | OK |
| 2 | 1520 | 230 | 85 | 14.5 | 252 | OK |
| 3 | 2082 | 294 | 106 | 16.2 | 310 | OK |
| 4 | 1250 | 279 | 60 | 15.5 | 149 | OK |
| 5 | 1181 | 247 | 55 | 15.4 | 137 | OK |
| **Avg** | **1544** | **268** | **78** | **15.5** | **218** | 5/5 OK |
| **Stdev** | 363 | 28 | 21 | - | 73 | - |

### databricks-claude-opus-4-6

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 52 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 59 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 57 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 57 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 50 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

### databricks-gemini-3-1-pro

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 49 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 55 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 55 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 47 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 53 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

### databricks-gemini-3-flash

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 55 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 55 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 45 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 43 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 59 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

### databricks-gemini-3-1-flash-lite

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 61 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 58 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 55 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 58 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 71 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

### databricks-qwen3-next-80b-a3b-instruct

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 52 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 61 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 54 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 50 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 48 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

## Config: max_tokens=500

### databricks-claude-3-7-sonnet

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 83 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 51 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 70 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 56 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 60 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

### databricks-gpt-5-4

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 2654 | 287 | 56 | 41.0 | 155 | OK |
| 2 | 1180 | 270 | 56 | 15.0 | 155 | OK |
| 3 | 1479 | 247 | 87 | 13.3 | 245 | OK |
| 4 | 1351 | 238 | 76 | 13.7 | 210 | OK |
| 5 | 1371 | 271 | 70 | 14.9 | 194 | OK |
| **Avg** | **1607** | **262** | **69** | **19.6** | **192** | 5/5 OK |
| **Stdev** | 595 | 20 | 13 | - | 38 | - |

### databricks-gpt-5-4-mini

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 1243 | 224 | 86 | 11.5 | 264 | OK |
| 2 | 989 | 351 | 56 | 9.3 | 153 | OK |
| 3 | 1095 | 268 | 92 | 8.6 | 286 | OK |
| 4 | 825 | 241 | 86 | 6.0 | 278 | OK |
| 5 | 748 | 233 | 56 | 8.3 | 141 | OK |
| **Avg** | **980** | **263** | **75** | **8.7** | **224** | 5/5 OK |
| **Stdev** | 200 | 52 | 18 | - | 71 | - |

### databricks-gpt-5-4-nano

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 1669 | 222 | 237 | 5.9 | 605 | OK |
| 2 | 935 | 278 | 75 | 8.0 | 190 | OK |
| 3 | 1000 | 221 | 119 | 6.2 | 349 | OK |
| 4 | 1197 | 232 | 142 | 6.4 | 424 | OK |
| 5 | 1026 | 225 | 116 | 6.3 | 351 | OK |
| **Avg** | **1165** | **236** | **138** | **6.6** | **384** | 5/5 OK |
| **Stdev** | 298 | 24 | 60 | - | 150 | - |

### databricks-gpt-5-2

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 1492 | 224 | 80 | 15.2 | 230 | OK |
| 2 | 1174 | 266 | 60 | 14.1 | 149 | OK |
| 3 | 2915 | 1438 | 93 | 15.4 | 290 | OK |
| 4 | 1838 | 235 | 85 | 17.3 | 226 | OK |
| 5 | 1985 | 211 | 80 | 21.7 | 237 | OK |
| **Avg** | **1881** | **475** | **80** | **16.7** | **226** | 5/5 OK |
| **Stdev** | 658 | 539 | 12 | - | 50 | - |

### databricks-claude-opus-4-6

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 54 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 45 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 63 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 60 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 62 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

### databricks-gemini-3-1-pro

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 54 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 72 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 53 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 74 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 54 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

### databricks-gemini-3-flash

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 50 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 55 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 66 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 68 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 54 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

### databricks-gemini-3-1-flash-lite

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 48 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 47 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 83 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 81 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 51 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

### databricks-qwen3-next-80b-a3b-instruct

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 51 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 47 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 74 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 49 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 48 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

## Config: max_tokens=1000

### databricks-claude-3-7-sonnet

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 56 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 45 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 51 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 50 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 54 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

### databricks-gpt-5-4

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 1310 | 242 | 73 | 14.0 | 194 | OK |
| 2 | 1523 | 255 | 87 | 13.9 | 245 | OK |
| 3 | 1417 | 239 | 71 | 15.6 | 197 | OK |
| 4 | 1522 | 232 | 89 | 13.6 | 245 | OK |
| 5 | 1443 | 239 | 87 | 13.2 | 245 | OK |
| **Avg** | **1443** | **241** | **81** | **14.0** | **225** | 5/5 OK |
| **Stdev** | 88 | 8 | 9 | - | 27 | - |

### databricks-gpt-5-4-mini

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 741 | 218 | 54 | 8.9 | 140 | OK |
| 2 | 946 | 256 | 84 | 7.5 | 265 | OK |
| 3 | 889 | 246 | 86 | 7.0 | 278 | OK |
| 4 | 926 | 275 | 89 | 6.8 | 284 | OK |
| 5 | 926 | 271 | 84 | 7.2 | 267 | OK |
| **Avg** | **886** | **253** | **79** | **7.5** | **247** | 5/5 OK |
| **Stdev** | 84 | 23 | 14 | - | 60 | - |

### databricks-gpt-5-4-nano

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 982 | 216 | 115 | 6.1 | 358 | OK |
| 2 | 785 | 251 | 69 | 6.7 | 168 | OK |
| 3 | 999 | 237 | 105 | 6.9 | 261 | OK |
| 4 | 924 | 222 | 104 | 6.1 | 315 | OK |
| 5 | 1063 | 255 | 124 | 5.8 | 361 | OK |
| **Avg** | **950** | **236** | **103** | **6.3** | **293** | 5/5 OK |
| **Stdev** | 105 | 17 | 21 | - | 81 | - |

### databricks-gpt-5-2

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 1284 | 246 | 60 | 16.0 | 149 | OK |
| 2 | 1302 | 216 | 60 | 16.5 | 149 | OK |
| 3 | 1245 | 289 | 60 | 14.5 | 149 | OK |
| 4 | 2467 | 227 | 98 | 22.5 | 248 | OK |
| 5 | 1359 | 296 | 60 | 16.3 | 149 | OK |
| **Avg** | **1531** | **255** | **68** | **17.1** | **169** | 5/5 OK |
| **Stdev** | 524 | 36 | 17 | - | 44 | - |

### databricks-claude-opus-4-6

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 51 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 45 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 64 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 51 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 53 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

### databricks-gemini-3-1-pro

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 52 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 46 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 62 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 45 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 56 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

### databricks-gemini-3-flash

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 53 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 48 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 45 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 46 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 45 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

### databricks-gemini-3-1-flash-lite

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 46 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 43 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 50 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 50 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 74 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

### databricks-qwen3-next-80b-a3b-instruct

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 58 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 55 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 48 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 60 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 56 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

## Config: max_tokens=10000

### databricks-claude-3-7-sonnet

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 51 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 49 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 54 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 45 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 52 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

### databricks-gpt-5-4

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 1220 | 239 | 56 | 16.4 | 155 | OK |
| 2 | 1424 | 231 | 81 | 14.0 | 230 | OK |
| 3 | 1497 | 212 | 70 | 17.5 | 194 | OK |
| 4 | 1642 | 316 | 87 | 14.4 | 233 | OK |
| 5 | 1605 | 226 | 98 | 13.3 | 269 | OK |
| **Avg** | **1478** | **245** | **78** | **15.1** | **216** | 5/5 OK |
| **Stdev** | 168 | 41 | 16 | - | 43 | - |

### databricks-gpt-5-4-mini

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 746 | 228 | 86 | 5.3 | 262 | OK |
| 2 | 743 | 227 | 57 | 8.3 | 150 | OK |
| 3 | 841 | 268 | 86 | 5.8 | 266 | OK |
| 4 | 916 | 238 | 86 | 7.1 | 267 | OK |
| 5 | 882 | 245 | 85 | 6.8 | 258 | OK |
| **Avg** | **825** | **241** | **80** | **6.7** | **241** | 5/5 OK |
| **Stdev** | 79 | 17 | 13 | - | 51 | - |

### databricks-gpt-5-4-nano

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 797 | 235 | 86 | 5.8 | 212 | OK |
| 2 | 801 | 213 | 82 | 6.1 | 209 | OK |
| 3 | 1125 | 222 | 142 | 6.0 | 458 | OK |
| 4 | 914 | 226 | 83 | 7.0 | 213 | OK |
| 5 | 980 | 244 | 122 | 5.6 | 370 | OK |
| **Avg** | **923** | **228** | **103** | **6.1** | **292** | 5/5 OK |
| **Stdev** | 137 | 12 | 27 | - | 115 | - |

### databricks-gpt-5-2

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 1863 | 229 | 86 | 18.5 | 262 | OK |
| 2 | 1300 | 214 | 60 | 16.5 | 149 | OK |
| 3 | 1468 | 221 | 79 | 15.6 | 239 | OK |
| 4 | 1693 | 231 | 94 | 14.9 | 280 | OK |
| 5 | 1725 | 226 | 97 | 15.0 | 289 | OK |
| **Avg** | **1610** | **224** | **83** | **16.1** | **244** | 5/5 OK |
| **Stdev** | 224 | 7 | 15 | - | 56 | - |

### databricks-claude-opus-4-6

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 56 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 53 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 56 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 53 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 51 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

### databricks-gemini-3-1-pro

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 54 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 49 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 44 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 53 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 50 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

### databricks-gemini-3-flash

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 50 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 46 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 60 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 48 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 58 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

### databricks-gemini-3-1-flash-lite

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 52 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 69 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 49 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 61 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 69 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

### databricks-qwen3-next-80b-a3b-instruct

| Run | Total (ms) | TTFT (ms) | Chunks | Inter-Chunk Mean (ms) | Resp Length | Status |
|----:|-----------:|----------:|-------:|---------------------:|------------:|--------|
| 1 | 68 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 2 | 51 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 3 | 43 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 4 | 57 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |
| 5 | 47 | - | - | - | - | ERROR: Error code: 400 - {'error_code': 'BAD_REQUEST', 'message': ' |

## Cross-Config Comparison (Avg Total Time ms)

| Model | no_limit | max_tokens=500 | max_tokens=1000 | max_tokens=10000 |
|-------|------:|------:|------:|------:|
| claude-3-7-sonnet | ERROR | ERROR | ERROR | ERROR |
| gpt-5-4 | 1345 | 1607 | 1443 | 1478 |
| gpt-5-4-mini | 1448 | 980 | 886 | 825 |
| gpt-5-4-nano | 1482 | 1165 | 950 | 923 |
| gpt-5-2 | 1544 | 1881 | 1531 | 1610 |
| claude-opus-4-6 | ERROR | ERROR | ERROR | ERROR |
| gemini-3-1-pro | ERROR | ERROR | ERROR | ERROR |
| gemini-3-flash | ERROR | ERROR | ERROR | ERROR |
| gemini-3-1-flash-lite | ERROR | ERROR | ERROR | ERROR |
| qwen3-next-80b-a3b-instruct | ERROR | ERROR | ERROR | ERROR |

## Cross-Config Comparison (Avg TTFT ms)

| Model | no_limit | max_tokens=500 | max_tokens=1000 | max_tokens=10000 |
|-------|------:|------:|------:|------:|
| claude-3-7-sonnet | ERROR | ERROR | ERROR | ERROR |
| gpt-5-4 | 275 | 262 | 241 | 245 |
| gpt-5-4-mini | 749 | 263 | 253 | 241 |
| gpt-5-4-nano | 378 | 236 | 236 | 228 |
| gpt-5-2 | 268 | 475 | 255 | 224 |
| claude-opus-4-6 | ERROR | ERROR | ERROR | ERROR |
| gemini-3-1-pro | ERROR | ERROR | ERROR | ERROR |
| gemini-3-flash | ERROR | ERROR | ERROR | ERROR |
| gemini-3-1-flash-lite | ERROR | ERROR | ERROR | ERROR |
| qwen3-next-80b-a3b-instruct | ERROR | ERROR | ERROR | ERROR |

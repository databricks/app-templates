"""Minimal server-side validation + diagnosis for a load-test run: pull the agent's
MLflow traces and report (1) reliability (from trace state), (2) latency (successful
traces only), and (3) a span breakdown to find bottlenecks (model vs tools, per-tool).

Reliability is the source of truth here — Locust can miss server errors that still
stream a response (FM 429s) and count infra failures that never created a trace. The
span breakdown shows *where* time goes under load, which a QPS/latency number can't.

  DATABRICKS_CONFIG_PROFILE=<profile> uv run python validate_with_mlflow.py \
      /Shared/<your-experiment> [minutes]
"""

import sys
import time
from collections import defaultdict

import mlflow
import pandas as pd
from mlflow.entities import Trace

exp_path = sys.argv[1] if len(sys.argv) > 1 else "/Shared/<your-experiment>"
minutes = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0

mlflow.set_tracking_uri("databricks")
exp = mlflow.get_experiment_by_name(exp_path)
# `locations` is current (experiment_ids is deprecated in mlflow 3.x).
df = mlflow.search_traces(locations=[exp.experiment_id], max_results=5000,
                          order_by=["timestamp DESC"])

cutoff_ms = time.time() * 1000 - minutes * 60_000
ms = pd.to_numeric(df["request_time"], errors="coerce")   # request_time is epoch ms
win = df[ms >= cutoff_ms]
ok = win[win["state"].astype(str).str.contains("OK")]
dur = pd.to_numeric(ok["execution_duration"], errors="coerce").dropna()   # ms

n = len(win)
if n == 0:
    print(f"no traces in the last {minutes} min — widen the window or run some load")
else:
    print(f"traces={n}  error_rate={round(1 - len(ok) / n, 3)}")
    if len(dur):
        print(f"latency ms (successful): median={dur.median():.0f} "
              f"p95={dur.quantile(.95):.0f} p99={dur.quantile(.99):.0f}")

# --- Where does time go? span breakdown (bottleneck analysis) ---
# No second query: each `win` row already carries the full trace JSON in the "trace"
# column, so rehydrate it to walk the spans — reusing the same time window as above.
# Use LEAF work spans (CHAT_MODEL, TOOL) for the split; CHAIN/AGENT spans wrap their
# children, so summing every span type would double-count nested time.
model_ms, tool_ms = 0.0, defaultdict(list)
for trace_json in win["trace"]:
    for s in (Trace.from_json(trace_json).data.spans or []):
        d = (s.end_time_ns - s.start_time_ns) / 1e6
        if str(s.span_type) == "CHAT_MODEL":
            model_ms += d
        elif str(s.span_type) == "TOOL":
            tool_ms[s.name].append(d)
tools_ms = sum(sum(v) for v in tool_ms.values())
print(f"time split (leaf spans): model={model_ms:.0f}ms  tools={tools_ms:.0f}ms")
for name, xs in sorted(tool_ms.items(), key=lambda kv: -(max(kv[1]) if kv[1] else 0)):
    print(f"  tool {name}: calls={len(xs)} p95={pd.Series(xs).quantile(0.95):.0f}ms")

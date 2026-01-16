## Trace Analysis Patterns

### Pattern 1: Basic Trace Search

```python
import mlflow

# All traces in current experiment
all_traces = mlflow.search_traces()

# Successful traces only
ok_traces = mlflow.search_traces(
    filter_string="attributes.status = 'OK'"
)

# Error traces only
error_traces = mlflow.search_traces(
    filter_string="attributes.status = 'ERROR'"
)

# Recent traces (last hour)
import time
one_hour_ago = int((time.time() - 3600) * 1000)
recent = mlflow.search_traces(
    filter_string=f"attributes.timestamp_ms > {one_hour_ago}"
)

# Slow traces (> 5 seconds)
slow = mlflow.search_traces(
    filter_string="attributes.execution_time_ms > 5000"
)
```

---

### Pattern 2: Filter by Tags and Metadata

```python
# By environment tag
prod_traces = mlflow.search_traces(
    filter_string="tags.environment = 'production'"
)

# By trace name (note backticks for dotted names)
specific_app = mlflow.search_traces(
    filter_string="tags.`mlflow.traceName` = 'my_app_function'"
)

# By user
user_traces = mlflow.search_traces(
    filter_string="metadata.`mlflow.user` = 'alice@company.com'"
)

# Combined filters (AND only - no OR support)
filtered = mlflow.search_traces(
    filter_string="""
        attributes.status = 'OK' AND
        tags.environment = 'production' AND
        attributes.execution_time_ms < 2000
    """
)
```

---

### Pattern 3: Trace Analysis for Quality Issues

```python
import mlflow
import pandas as pd

def analyze_trace_quality(experiment_id=None, days=7):
    """Analyze trace quality patterns."""
    
    import time
    cutoff = int((time.time() - days * 86400) * 1000)
    
    traces = mlflow.search_traces(
        filter_string=f"attributes.timestamp_ms > {cutoff}",
        experiment_ids=[experiment_id] if experiment_id else None
    )
    
    if len(traces) == 0:
        return {"error": "No traces found"}
    
    # Calculate metrics
    analysis = {
        "total_traces": len(traces),
        "success_rate": (traces['status'] == 'OK').mean(),
        "avg_latency_ms": traces['execution_time_ms'].mean(),
        "p50_latency_ms": traces['execution_time_ms'].median(),
        "p95_latency_ms": traces['execution_time_ms'].quantile(0.95),
        "p99_latency_ms": traces['execution_time_ms'].quantile(0.99),
    }
    
    # Error analysis
    errors = traces[traces['status'] == 'ERROR']
    if len(errors) > 0:
        analysis["error_count"] = len(errors)
        # Sample error inputs
        analysis["sample_errors"] = errors['request'].head(5).tolist()
    
    return analysis
```

---

### Pattern 4: Extract Failing Cases for Regression Tests

```python
import mlflow

def extract_failures_for_eval(run_id: str, scorer_name: str):
    """
    Extract inputs that failed a specific scorer to create regression tests.
    """
    traces = mlflow.search_traces(run_id=run_id)
    
    failures = []
    for _, row in traces.iterrows():
        for assessment in row.get('assessments', []):
            if (assessment['assessment_name'] == scorer_name and
                assessment['feedback']['value'] in ['no', False]):
                failures.append({
                    "inputs": row['request'],
                    "outputs": row['response'],
                    "failure_reason": assessment.get('rationale', 'Unknown')
                })
    
    return failures

# Usage
failures = extract_failures_for_eval(
    run_id=results.run_id, 
    scorer_name="concise_communication"
)

# Create regression test dataset from failures
regression_dataset = [
    {"inputs": f["inputs"]} for f in failures
]
```

---

### Pattern 5: Trace-Based Performance Profiling

```python
import mlflow
from mlflow.entities import SpanType

def profile_trace_performance(trace_id: str):
    """Profile a single trace's performance by span type."""
    
    # Get the trace
    traces = mlflow.search_traces(
        filter_string=f"tags.`mlflow.traceId` = '{trace_id}'",
        return_type="list"
    )
    
    if not traces:
        return {"error": "Trace not found"}
    
    trace = traces[0]
    
    # Analyze by span type
    span_analysis = {}
    
    for span_type in [SpanType.CHAT_MODEL, SpanType.RETRIEVER, SpanType.TOOL]:
        spans = trace.search_spans(span_type=span_type)
        if spans:
            durations = [
                (s.end_time_ns - s.start_time_ns) / 1e9 
                for s in spans
            ]
            span_analysis[span_type.name] = {
                "count": len(spans),
                "total_time": sum(durations),
                "avg_time": sum(durations) / len(durations),
                "max_time": max(durations)
            }
    
    return span_analysis
```

---

### Pattern 6: Build Diverse Evaluation Dataset

```python
def build_diverse_eval_dataset(traces_df, sample_size=50):
    """
    Build a diverse evaluation dataset from traces.
    Samples across different characteristics.
    """
    
    samples = []
    
    # Sample by status
    ok_traces = traces_df[traces_df['status'] == 'OK']
    error_traces = traces_df[traces_df['status'] == 'ERROR']
    
    # Sample by latency buckets
    fast = ok_traces[ok_traces['execution_time_ms'] < 1000]
    medium = ok_traces[(ok_traces['execution_time_ms'] >= 1000) & 
                       (ok_traces['execution_time_ms'] < 5000)]
    slow = ok_traces[ok_traces['execution_time_ms'] >= 5000]
    
    # Proportional sampling
    samples_per_bucket = sample_size // 4
    
    if len(fast) > 0:
        samples.append(fast.sample(min(samples_per_bucket, len(fast))))
    if len(medium) > 0:
        samples.append(medium.sample(min(samples_per_bucket, len(medium))))
    if len(slow) > 0:
        samples.append(slow.sample(min(samples_per_bucket, len(slow))))
    if len(error_traces) > 0:
        samples.append(error_traces.sample(min(samples_per_bucket, len(error_traces))))
    
    # Combine and convert to eval format
    combined = pd.concat(samples, ignore_index=True)
    
    eval_data = []
    for _, row in combined.iterrows():
        eval_data.append({
            "inputs": row['request'],
            "outputs": row['response']
        })
    
    return eval_data
```

---

### Pattern 7: Daily Quality Report from Traces

```python
import mlflow
import time
from datetime import datetime

def daily_quality_report():
    """Generate daily quality report from traces."""
    
    # Yesterday's traces
    now = int(time.time() * 1000)
    yesterday_start = now - (24 * 60 * 60 * 1000)
    yesterday_end = now
    
    traces = mlflow.search_traces(
        filter_string=f"""
            attributes.timestamp_ms >= {yesterday_start} AND
            attributes.timestamp_ms < {yesterday_end}
        """
    )
    
    if len(traces) == 0:
        return "No traces found for yesterday"
    
    report = {
        "date": datetime.now().strftime("%Y-%m-%d"),
        "total_requests": len(traces),
        "success_rate": (traces['status'] == 'OK').mean(),
        "error_count": (traces['status'] == 'ERROR').sum(),
        "latency": {
            "mean": traces['execution_time_ms'].mean(),
            "p50": traces['execution_time_ms'].median(),
            "p95": traces['execution_time_ms'].quantile(0.95),
        }
    }
    
    # Hourly distribution
    traces['hour'] = pd.to_datetime(traces['timestamp_ms'], unit='ms').dt.hour
    report["hourly_volume"] = traces.groupby('hour').size().to_dict()
    
    return report
```
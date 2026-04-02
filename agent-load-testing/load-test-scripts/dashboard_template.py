"""
Generate an interactive HTML dashboard from Locust load test results.

Reads results_stats.csv and results_stats_history.csv from each test's output
directory and produces a single self-contained dashboard.html with Chart.js.

Used by run_load_test.py when --dashboard is passed, or can be run standalone:

    # Generate dashboard from existing results directory:
    python dashboard_template.py results_r3/

    # Point at specific subdirectories:
    python dashboard_template.py results_r3/medium_2w results_r3/large_8w

    # With custom labels:
    python dashboard_template.py results_r3/ --label medium-2w --label medium-4w

Labels default to subdirectory names (e.g., results_r3/large_6w/ -> "large_6w").
Ramp chart grouping splits labels on the first "-" or "_" to find a prefix
(e.g., "medium_2w" -> group "medium", "large_8w" -> group "large").
"""

from __future__ import annotations

import csv
import json
import sys
from collections import defaultdict
from pathlib import Path


def extract_aggregate(result_dir: Path) -> dict:
    """Extract aggregate metrics from results_stats.csv."""
    stats_file = result_dir / "results_stats.csv"
    if not stats_file.exists():
        return {}

    with open(stats_file) as f:
        rows = list(csv.DictReader(f))

    agg = {}
    stream_rows = [r for r in rows if "/invocations" in r.get("Name", "") and "Aggregated" not in r.get("Name", "")]
    ttft_rows = [r for r in rows if r.get("Name") == "TTFT"]

    if stream_rows:
        r = stream_rows[0]
        total = int(r["Request Count"])
        fails = int(r["Failure Count"])
        agg.update({
            "total_requests": total,
            "failures": fails,
            "fail_pct": round(fails / total * 100, 1) if total else 0,
            "qps": round(float(r["Requests/s"]), 1),
            "p50": int(r["50%"]),
            "p95": int(r["95%"]),
            "p99": int(r["99%"]),
        })

    if ttft_rows:
        r = ttft_rows[0]
        agg.update({
            "ttft_p50": int(r["50%"]),
            "ttft_p95": int(r["95%"]),
            "ttft_p99": int(r["99%"]),
        })

    return agg


def extract_ramp_data(result_dir: Path, step_size: int = 20) -> list[dict]:
    """Extract per-step ramp data from results_stats_history.csv.

    Groups rows by User Count and takes the last sample at each level.
    Returns a list of dicts with users, qps, p50, p95 — one per step.
    """
    history_file = result_dir / "results_stats_history.csv"
    if not history_file.exists():
        return []

    with open(history_file) as f:
        rows = list(csv.DictReader(f))

    by_users = defaultdict(list)
    for r in rows:
        uc = int(r["User Count"])
        qps_str = r["Requests/s"]
        p50 = r["50%"]
        if uc > 0 and qps_str != "N/A" and p50 != "N/A":
            qps = float(qps_str)
            if qps > 0:
                by_users[uc].append({
                    "qps": round(qps, 1),
                    "p50": int(p50),
                    "p95": int(r["95%"]) if r["95%"] != "N/A" else 0,
                })

    steps = []
    for uc in sorted(by_users.keys()):
        if uc % step_size == 0:
            last = by_users[uc][-1]
            steps.append({"users": uc, **last})

    return steps


def generate_dashboard(
    results: list[dict],
    output_dir: Path,
    app_urls: list[str],
    labels: list[str],
    ramp_data: dict[str, list[dict]] | None = None,
    metadata: dict | None = None,
) -> Path:
    """Generate dashboard.html from load test results.

    Args:
        results: List of summary dicts (from parse_summary), each with keys:
            label, status, qps, p50, p95, p99, total_requests, fail_pct,
            ttft_p50, ttft_p95, ttft_p99
        output_dir: Directory to write dashboard.html into.
        app_urls: List of app URLs that were tested.
        labels: List of human-readable labels (same order as app_urls).
        ramp_data: Optional dict of {label: [{users, qps, p50, p95}, ...]}.
            If None, extracted automatically from output_dir/{label}/ subdirs.
        metadata: Optional dict with extra info for the dashboard header,
            e.g. {"mock_chunk_delay_ms": 10, "mock_chunk_count": 80,
                   "max_users": 500, "step_size": 20, "step_duration": 45}

    Returns:
        Path to the generated dashboard.html.
    """
    metadata = metadata or {}

    # Filter to successful results only
    ok_results = [r for r in results if r.get("status") == "OK"]
    if not ok_results:
        print("  No successful results to generate dashboard.")
        return None

    # Extract ramp data from history CSVs if not provided
    if ramp_data is None:
        ramp_data = {}
        step_size = metadata.get("step_size", 20)
        for r in ok_results:
            label = r["label"]
            result_subdir = output_dir / label
            if result_subdir.exists():
                ramp_data[label] = extract_ramp_data(result_subdir, step_size)

    # --- Compute per-config peak QPS and users at peak ---
    peak_info = {}  # label -> {peak_qps, users_at_peak}
    for label, steps in ramp_data.items():
        if steps:
            best_step = max(steps, key=lambda s: s["qps"])
            peak_info[label] = {"peak_qps": best_step["qps"], "users_at_peak": best_step["users"]}
        else:
            peak_info[label] = {"peak_qps": 0, "users_at_peak": 0}

    # For configs without ramp data, fall back to aggregate QPS
    for r in ok_results:
        if r["label"] not in peak_info:
            peak_info[r["label"]] = {"peak_qps": r["qps"], "users_at_peak": 0}

    # Best config = highest peak QPS from ramp data
    best_config = max(ok_results, key=lambda r: peak_info[r["label"]]["peak_qps"])
    best_peak = peak_info[best_config["label"]]

    # Global peak across all configs
    global_peak_label = max(peak_info, key=lambda l: peak_info[l]["peak_qps"])
    global_peak_qps = peak_info[global_peak_label]["peak_qps"]
    global_peak_users = peak_info[global_peak_label]["users_at_peak"]

    lowest_latency = min(ok_results, key=lambda r: int(r["p50"]))
    total_requests = sum(r.get("total_requests", 0) for r in ok_results)

    # --- Build ramp chart groups ---
    # Try to group labels by prefix (e.g., "medium-*" vs "large-*")
    # If all labels share the same prefix, use a single group
    groups = defaultdict(dict)
    for label in ramp_data:
        # Split on first hyphen or underscore to find group prefix
        for sep in ["-", "_"]:
            if sep in label:
                prefix = label.split(sep)[0]
                break
        else:
            prefix = "all"
        groups[prefix][label] = ramp_data[label]

    # If only one group, just use "all"
    if len(groups) == 1:
        groups = {"all": ramp_data}

    # Custom sort: medium before large, then alphabetical
    COMPUTE_ORDER = {"small": 0, "medium": 1, "large": 2, "xlarge": 3, "all": 99}

    def compute_sort_key(name: str) -> tuple:
        return (COMPUTE_ORDER.get(name.lower(), 50), name)

    # Sort ok_results by group prefix (medium before large)
    def result_sort_key(r: dict) -> tuple:
        label = r["label"]
        for sep in ["-", "_"]:
            if sep in label:
                prefix = label.split(sep)[0]
                return compute_sort_key(prefix)
        return (50, label)

    ok_results.sort(key=result_sort_key)

    # --- Build subtitle from app URLs ---
    url_list_html = ""
    for i, url in enumerate(app_urls):
        lbl = labels[i] if i < len(labels) else ""
        if lbl:
            url_list_html += f'<span style="color:var(--accent)">{lbl}</span>: <code>{url}</code>'
        else:
            url_list_html += f'<code>{url}</code>'
        if i < len(app_urls) - 1:
            url_list_html += " &nbsp;|&nbsp; "

    # Metadata subtitle
    meta_parts = []
    if metadata.get("mock_chunk_delay_ms"):
        meta_parts.append(f'{metadata["mock_chunk_count"]} chunks @ {metadata["mock_chunk_delay_ms"]}ms delay')
    if metadata.get("max_users"):
        meta_parts.append(f'Ramp: {metadata.get("step_size", 20)} users/step, '
                          f'{metadata.get("step_duration", 45)}s/step, '
                          f'max {metadata["max_users"]} users')
    meta_html = " &mdash; ".join(meta_parts) if meta_parts else ""

    # --- Build results table rows ---
    # Best row = highest peak QPS, highlighted with bold
    table_rows_html = ""
    for r in ok_results:
        is_best = r["label"] == best_config["label"]
        row_class = ' class="best"' if is_best else ""
        bold = lambda v: f"<strong>{v}</strong>" if is_best else str(v)

        fail_pct = r.get("fail_pct", 0)
        pi = peak_info[r["label"]]

        table_rows_html += f"""
      <tr{row_class}>
        <td>{bold(r['label'])}</td>
        <td>{bold(f"{pi['peak_qps']:.1f}")}</td>
        <td>{bold(pi['users_at_peak'])}</td>
        <td>{bold(f"{r.get('total_requests', 0):,}")}</td>
        <td>{bold(r.get('ttft_p50', 'N/A'))}</td>
        <td>{bold(r.get('ttft_p95', 'N/A'))}</td>
        <td>{bold(r['p50'])}</td>
        <td>{bold(r['p95'])}</td>
        <td>{bold(r['p99'])}</td>
        <td>{bold(f"{fail_pct:.1f}%")}</td>
      </tr>"""

    # --- Build ramp chart HTML sections ---
    ramp_charts_html = ""
    ramp_charts_js = ""

    if len(groups) == 1 and "all" in groups:
        # Single chart for all configs
        ramp_charts_html = """
<div class="card" style="margin-bottom: 20px;">
  <h2>QPS Ramp Progression</h2>
  <div class="tab-bar">
    <button class="tab-btn active" onclick="toggleRamp('all', 'qps', this)">QPS</button>
    <button class="tab-btn" onclick="toggleRamp('all', 'latency', this)">Latency</button>
  </div>
  <div class="chart-container-tall">
    <canvas id="chartRamp_all"></canvas>
  </div>
</div>"""
    else:
        # One chart per group
        cards = []
        for group_name in sorted(groups.keys(), key=compute_sort_key):
            display_name = group_name.capitalize() if group_name != "all" else "All"
            cards.append(f"""
  <div class="card">
    <h2>{display_name} Compute &mdash; QPS vs Users</h2>
    <div class="tab-bar">
      <button class="tab-btn active" onclick="toggleRamp('{group_name}', 'qps', this)">QPS</button>
      <button class="tab-btn" onclick="toggleRamp('{group_name}', 'latency', this)">Latency</button>
    </div>
    <div class="chart-container-tall">
      <canvas id="chartRamp_{group_name}"></canvas>
    </div>
  </div>""")
        ramp_charts_html = f'<div class="grid grid-{min(len(cards), 2)}" style="margin-bottom: 20px;">{"".join(cards)}\n</div>'

    # Build JS ramp data object
    ramp_js_data = {}
    for group_name, group_configs in groups.items():
        ramp_js_data[group_name] = {}
        for label, steps in group_configs.items():
            ramp_js_data[group_name][label] = {
                "qps": [s["qps"] for s in steps],
                "p50": [s["p50"] for s in steps],
                "p95": [s["p95"] for s in steps],
            }

    # Get all user counts (use first non-empty config)
    all_user_counts = []
    for steps in ramp_data.values():
        if steps:
            all_user_counts = [s["users"] for s in steps]
            break

    # --- Chart data arrays ---
    chart_labels = [r["label"] for r in ok_results]
    chart_peak_qps = [peak_info[r["label"]]["peak_qps"] for r in ok_results]
    chart_p50 = [int(r["p50"]) for r in ok_results]
    chart_p95 = [int(r["p95"]) for r in ok_results]
    chart_ttft_p50 = [int(r.get("ttft_p50", 0)) for r in ok_results]
    chart_ttft_p95 = [int(r.get("ttft_p95", 0)) for r in ok_results]
    chart_reqs = [r.get("total_requests", 0) for r in ok_results]

    # Color assignment: cycle through palette
    palette = ["#6366f1", "#06b6d4", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#ec4899", "#14b8a6"]
    bar_colors = [palette[i % len(palette)] for i in range(len(ok_results))]
    bar_colors_alpha = [c + "99" for c in bar_colors]

    # --- Assemble HTML ---
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Databricks Apps Load Testing Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
  :root {{
    --bg: #0f1117;
    --card: #1a1d2e;
    --border: #2a2d3e;
    --text: #e1e4ed;
    --muted: #8b8fa3;
    --accent: #6366f1;
    --green: #22c55e;
    --amber: #f59e0b;
    --red: #ef4444;
    --blue: #3b82f6;
    --purple: #a855f7;
    --cyan: #06b6d4;
  }}
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    padding: 24px;
    line-height: 1.5;
  }}
  h1 {{ font-size: 28px; font-weight: 700; margin-bottom: 4px; }}
  .subtitle {{ color: var(--muted); font-size: 13px; margin-bottom: 8px; line-height: 1.7; }}
  .subtitle code {{ background: #111322; padding: 2px 6px; border-radius: 4px; font-size: 12px; }}
  .meta {{ color: var(--muted); font-size: 12px; margin-bottom: 32px; }}
  .grid {{ display: grid; gap: 20px; }}
  .grid-2 {{ grid-template-columns: 1fr 1fr; }}
  @media (max-width: 900px) {{ .grid-2 {{ grid-template-columns: 1fr; }} }}

  .card {{
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
  }}
  .card h2 {{
    font-size: 14px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 16px;
  }}

  .kpi-grid {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }}
  @media (max-width: 900px) {{ .kpi-grid {{ grid-template-columns: repeat(2, 1fr); }} }}
  .kpi {{
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px 20px;
  }}
  .kpi-label {{ font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }}
  .kpi-value {{ font-size: 32px; font-weight: 700; margin: 4px 0; }}
  .kpi-detail {{ font-size: 12px; color: var(--muted); }}
  .kpi-green .kpi-value {{ color: var(--green); }}
  .kpi-blue .kpi-value {{ color: var(--blue); }}
  .kpi-amber .kpi-value {{ color: var(--amber); }}
  .kpi-purple .kpi-value {{ color: var(--purple); }}

  .chart-container {{ position: relative; height: 340px; }}
  .chart-container-tall {{ position: relative; height: 400px; }}

  table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
  th {{
    text-align: left;
    padding: 10px 12px;
    border-bottom: 2px solid var(--border);
    color: var(--muted);
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }}
  td {{ padding: 10px 12px; border-bottom: 1px solid var(--border); }}
  tr.best {{ background: rgba(99, 102, 241, 0.1); }}
  tr.best td {{ font-weight: 600; }}
  .section-title {{
    font-size: 20px;
    font-weight: 700;
    margin: 36px 0 16px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }}

  .tab-bar {{
    display: flex;
    gap: 4px;
    margin-bottom: 16px;
    background: var(--bg);
    border-radius: 8px;
    padding: 4px;
    border: 1px solid var(--border);
  }}
  .tab-btn {{
    padding: 8px 16px;
    border: none;
    background: none;
    color: var(--muted);
    font-size: 13px;
    font-weight: 500;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
  }}
  .tab-btn:hover {{ color: var(--text); background: var(--border); }}
  .tab-btn.active {{ background: var(--accent); color: white; }}
</style>
</head>
<body>

<h1>Databricks Apps Load Testing Dashboard</h1>
<p class="subtitle">Apps tested: {url_list_html}</p>
{"<p class='meta'>" + meta_html + "</p>" if meta_html else ""}

<!-- KPIs -->
<div class="kpi-grid">
  <div class="kpi kpi-green">
    <div class="kpi-label">Best Config (Peak QPS)</div>
    <div class="kpi-value">{best_config['label']}</div>
    <div class="kpi-detail">{best_peak['peak_qps']:.1f} QPS @ {best_peak['users_at_peak']} users</div>
  </div>
  <div class="kpi kpi-purple">
    <div class="kpi-label">Peak QPS</div>
    <div class="kpi-value">{global_peak_qps:.1f}</div>
    <div class="kpi-detail">queries/sec &mdash; {global_peak_label} @ {global_peak_users} users</div>
  </div>
  <div class="kpi kpi-blue">
    <div class="kpi-label">Lowest Latency (p50)</div>
    <div class="kpi-value">{lowest_latency['p50']}ms</div>
    <div class="kpi-detail">{lowest_latency['label']}</div>
  </div>
  <div class="kpi kpi-amber">
    <div class="kpi-label">Total Requests</div>
    <div class="kpi-value">{total_requests:,}</div>
    <div class="kpi-detail">across {len(ok_results)} configs</div>
  </div>
</div>

<!-- Charts Row 1: QPS + Latency -->
<div class="grid grid-2" style="margin-bottom: 20px;">
  <div class="card">
    <h2>Peak QPS by Config</h2>
    <div class="chart-container">
      <canvas id="chartQPS"></canvas>
    </div>
  </div>
  <div class="card">
    <h2>Latency by Config (Median &amp; p95)</h2>
    <div class="chart-container">
      <canvas id="chartLatency"></canvas>
    </div>
  </div>
</div>

<!-- Charts Row 2: TTFT + Total Requests -->
<div class="grid grid-2" style="margin-bottom: 20px;">
  <div class="card">
    <h2>TTFT (Time to First Token) by Config</h2>
    <div class="chart-container">
      <canvas id="chartTTFT"></canvas>
    </div>
  </div>
  <div class="card">
    <h2>Total Requests Served</h2>
    <div class="chart-container">
      <canvas id="chartReqs"></canvas>
    </div>
  </div>
</div>

<!-- Ramp Charts -->
<div class="section-title">QPS Ramp Progression</div>
{ramp_charts_html}

<!-- Summary Table -->
<div class="section-title">Full Results Table</div>
<div class="card" style="margin-bottom: 24px;">
  <table>
    <thead>
      <tr>
        <th>Config</th>
        <th>Peak QPS</th>
        <th>Users at Peak</th>
        <th>Total Reqs</th>
        <th>TTFT p50</th>
        <th>TTFT p95</th>
        <th>Latency p50</th>
        <th>Latency p95</th>
        <th>Latency p99</th>
        <th>Fail Rate</th>
      </tr>
    </thead>
    <tbody>{table_rows_html}
    </tbody>
  </table>
</div>

<!-- Load Test Parameters -->
<div class="section-title">Load Test Parameters <span style="font-size:14px;font-weight:400;color:var(--muted)">(test_config.json)</span></div>
<div class="card" style="margin-bottom: 24px;">
  <table>
    <tr><td style="color:var(--muted);width:220px">Max Concurrent Users</td><td>{metadata.get("max_users") or (max(s["users"] for steps in ramp_data.values() for s in steps) if ramp_data else "N/A")}</td></tr>
    <tr><td style="color:var(--muted)">Step Size (users/step)</td><td>{metadata.get("step_size") or (all_user_counts[1] - all_user_counts[0] if len(all_user_counts) >= 2 else "N/A")}</td></tr>
    <tr><td style="color:var(--muted)">Step Duration (sec/step)</td><td>{metadata.get("step_duration", "N/A")}</td></tr>
    <tr><td style="color:var(--muted)">Number of Steps</td><td>{len(all_user_counts)}</td></tr>
    <tr><td style="color:var(--muted)">Ramp Shape</td><td>{all_user_counts[0] if all_user_counts else "N/A"} &rarr; {all_user_counts[-1] if all_user_counts else "N/A"} users</td></tr>
    <tr><td style="color:var(--muted)">Configs Tested</td><td>{len(ok_results)}</td></tr>
    <tr><td style="color:var(--muted)">Total Requests (all configs)</td><td>{total_requests:,}</td></tr>
  </table>
</div>

<script>
const COLORS = {{
  muted:  '#8b8fa3',
  grid:   'rgba(255,255,255,0.06)',
}};

const chartDefaults = {{
  responsive: true,
  maintainAspectRatio: false,
  plugins: {{ legend: {{ labels: {{ color: '#e1e4ed', padding: 16, usePointStyle: true, pointStyle: 'circle' }} }} }},
  scales: {{
    x: {{ ticks: {{ color: COLORS.muted }}, grid: {{ color: COLORS.grid }} }},
    y: {{ ticks: {{ color: COLORS.muted }}, grid: {{ color: COLORS.grid }} }},
  }},
}};

const labels = {json.dumps(chart_labels)};
const barColors = {json.dumps(bar_colors)};
const barColorsAlpha = {json.dumps(bar_colors_alpha)};

// --- Peak QPS Bar Chart ---
new Chart(document.getElementById('chartQPS'), {{
  type: 'bar',
  data: {{
    labels: labels,
    datasets: [{{
      label: 'Peak QPS',
      data: {json.dumps(chart_peak_qps)},
      backgroundColor: barColorsAlpha,
      borderColor: barColors,
      borderWidth: 2,
      borderRadius: 6,
    }}]
  }},
  options: {{
    ...chartDefaults,
    plugins: {{
      ...chartDefaults.plugins,
      tooltip: {{ callbacks: {{ label: ctx => ctx.parsed.y + ' QPS' }} }},
    }},
    scales: {{
      ...chartDefaults.scales,
      x: {{ ...chartDefaults.scales.x, title: {{ display: true, text: 'Config', color: COLORS.muted }} }},
      y: {{ ...chartDefaults.scales.y, title: {{ display: true, text: 'QPS (queries/sec)', color: COLORS.muted }}, beginAtZero: true }},
    }}
  }}
}});

// --- Latency Bar Chart (p50 + p95 side by side) ---
new Chart(document.getElementById('chartLatency'), {{
  type: 'bar',
  data: {{
    labels: labels,
    datasets: [
      {{
        label: 'Median (p50)',
        data: {json.dumps(chart_p50)},
        backgroundColor: barColorsAlpha,
        borderColor: barColors,
        borderWidth: 2,
        borderRadius: 6,
      }},
      {{
        label: 'p95',
        data: {json.dumps(chart_p95)},
        backgroundColor: 'rgba(168,85,247,0.25)',
        borderColor: '#a855f7',
        borderWidth: 1.5,
        borderRadius: 6,
      }}
    ]
  }},
  options: {{
    ...chartDefaults,
    scales: {{
      ...chartDefaults.scales,
      x: {{ ...chartDefaults.scales.x, title: {{ display: true, text: 'Config', color: COLORS.muted }} }},
      y: {{ ...chartDefaults.scales.y, title: {{ display: true, text: 'Latency (ms)', color: COLORS.muted }}, beginAtZero: true }},
    }}
  }}
}});

// --- TTFT Bar Chart (p50 + p95 side by side) ---
new Chart(document.getElementById('chartTTFT'), {{
  type: 'bar',
  data: {{
    labels: labels,
    datasets: [
      {{
        label: 'TTFT p50',
        data: {json.dumps(chart_ttft_p50)},
        backgroundColor: barColorsAlpha,
        borderColor: barColors,
        borderWidth: 2,
        borderRadius: 6,
      }},
      {{
        label: 'TTFT p95',
        data: {json.dumps(chart_ttft_p95)},
        backgroundColor: 'rgba(168,85,247,0.25)',
        borderColor: '#a855f7',
        borderWidth: 1.5,
        borderRadius: 6,
      }}
    ]
  }},
  options: {{
    ...chartDefaults,
    scales: {{
      ...chartDefaults.scales,
      x: {{ ...chartDefaults.scales.x, title: {{ display: true, text: 'Config', color: COLORS.muted }} }},
      y: {{ ...chartDefaults.scales.y, title: {{ display: true, text: 'TTFT (ms)', color: COLORS.muted }}, beginAtZero: true }},
    }}
  }}
}});

// --- Total Requests Bar Chart ---
new Chart(document.getElementById('chartReqs'), {{
  type: 'bar',
  data: {{
    labels: labels,
    datasets: [{{
      label: 'Total Requests',
      data: {json.dumps(chart_reqs)},
      backgroundColor: barColorsAlpha,
      borderColor: barColors,
      borderWidth: 2,
      borderRadius: 6,
    }}]
  }},
  options: {{
    ...chartDefaults,
    plugins: {{
      ...chartDefaults.plugins,
      tooltip: {{ callbacks: {{ label: ctx => ctx.parsed.y.toLocaleString() + ' requests' }} }},
    }},
    scales: {{
      ...chartDefaults.scales,
      x: {{ ...chartDefaults.scales.x, title: {{ display: true, text: 'Config', color: COLORS.muted }} }},
      y: {{ ...chartDefaults.scales.y, title: {{ display: true, text: 'Total Requests', color: COLORS.muted }}, beginAtZero: true }},
    }}
  }}
}});

// --- Ramp Charts ---
const rampGroups = {json.dumps(ramp_js_data)};
const rampUsers = {json.dumps(all_user_counts)};
const rampPalette = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#ec4899', '#14b8a6'];

function makeRampChart(canvasId, data, mode) {{
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (canvas._chart) canvas._chart.destroy();

  const datasets = Object.entries(data).map(([label, d], i) => ({{
    label: label,
    data: mode === 'qps' ? d.qps : d.p50,
    borderColor: rampPalette[i % rampPalette.length],
    backgroundColor: rampPalette[i % rampPalette.length] + '22',
    borderWidth: 2.5,
    pointRadius: 3,
    pointHoverRadius: 6,
    tension: 0.3,
    fill: false,
  }}));

  canvas._chart = new Chart(canvas, {{
    type: 'line',
    data: {{ labels: rampUsers, datasets }},
    options: {{
      ...chartDefaults,
      interaction: {{ mode: 'index', intersect: false }},
      scales: {{
        ...chartDefaults.scales,
        x: {{ ...chartDefaults.scales.x, title: {{ display: true, text: 'Concurrent Users', color: COLORS.muted }} }},
        y: {{
          ...chartDefaults.scales.y,
          title: {{ display: true, text: mode === 'qps' ? 'QPS (queries/sec)' : 'p50 Latency (ms)', color: COLORS.muted }},
          beginAtZero: true,
        }},
      }},
      plugins: {{
        ...chartDefaults.plugins,
        tooltip: {{
          callbacks: {{
            label: ctx => ctx.dataset.label + ': ' + ctx.parsed.y + (mode === 'qps' ? ' QPS' : 'ms')
          }}
        }}
      }}
    }}
  }});
}}

function toggleRamp(group, mode, btn) {{
  btn.parentElement.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  makeRampChart('chartRamp_' + group, rampGroups[group], mode);
}}

// Initialize all ramp charts
Object.keys(rampGroups).forEach(group => {{
  makeRampChart('chartRamp_' + group, rampGroups[group], 'qps');
}});
</script>
</body>
</html>"""

    dashboard_path = output_dir / "dashboard.html"
    dashboard_path.parent.mkdir(parents=True, exist_ok=True)
    dashboard_path.write_text(html)
    return dashboard_path


# --- Standalone CLI ---
def main():
    """Generate dashboard from existing result directories."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Generate an interactive HTML dashboard from Locust load test results.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # From a results directory with subdirectories per config:
  python dashboard_template.py results_r3/

  # From specific subdirectories:
  python dashboard_template.py results_r3/medium_2w results_r3/large_8w

Labels are derived from subdirectory names automatically.
        """,
    )

    parser.add_argument(
        "result_dirs", nargs="+",
        help="Result directory (parent with subdirs, or individual result dirs)",
    )
    parser.add_argument("--output", type=str, default=None, help="Output directory for dashboard.html")

    args = parser.parse_args()

    # Resolve result directories
    result_dirs = []
    for rd in args.result_dirs:
        p = Path(rd)
        if not p.exists():
            print(f"ERROR: {rd} does not exist")
            sys.exit(1)

        # Check if this is a parent dir with subdirectories containing results
        stats_file = p / "results_stats.csv"
        if stats_file.exists():
            # It's a single result dir
            result_dirs.append(p)
        else:
            # It's a parent dir — find subdirectories with results
            for sub in sorted(p.iterdir()):
                if sub.is_dir() and (sub / "results_stats.csv").exists():
                    result_dirs.append(sub)

    if not result_dirs:
        print("ERROR: No result directories found with results_stats.csv")
        sys.exit(1)

    # Labels come from subdirectory names
    labels = [d.name for d in result_dirs]

    # Output dir
    output_dir = Path(args.output) if args.output else result_dirs[0].parent

    # Load test_config.json if it exists (written by run_load_test.py)
    metadata = {}
    config_file = output_dir / "test_config.json"
    if config_file.exists():
        with open(config_file) as f:
            metadata = json.load(f)
        print(f"  Loaded test config from {config_file}")

    # Use app URLs from config if available, otherwise use directory paths
    app_urls = metadata.get("app_urls", [f"(from {d})" for d in result_dirs])

    # Extract data
    results = []
    ramp_data = {}
    step_size = metadata.get("step_size", 20)
    for i, rd in enumerate(result_dirs):
        label = labels[i]
        agg = extract_aggregate(rd)
        if agg:
            agg["label"] = label
            agg["status"] = "OK"
            results.append(agg)
            ramp = extract_ramp_data(rd, step_size)
            if ramp:
                ramp_data[label] = ramp

    if not results:
        print("ERROR: No valid results found")
        sys.exit(1)

    dashboard_path = generate_dashboard(
        results=results,
        output_dir=output_dir,
        app_urls=app_urls,
        labels=labels,
        ramp_data=ramp_data,
        metadata=metadata,
    )

    if dashboard_path:
        print(f"Dashboard generated: {dashboard_path}")
        print(f"  open {dashboard_path}")


if __name__ == "__main__":
    main()

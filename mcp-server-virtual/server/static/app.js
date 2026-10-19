// Explorer UI for the virtual MCP server. All data comes from /api/*.
"use strict";

const MCP_URL = `${location.origin}/mcp`;
const SEARCH_URL = `${location.origin}/mcp/search`;
const POLL_INTERVAL_MS = 3000;
const POLL_ATTEMPTS = 40;

let services = [];
let loginUrl = "";
let selected = null;

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const resp = await fetch(path, { ...options, signal: controller.signal });
    let data = null;
    try { data = await resp.json(); } catch { /* non-JSON body */ }
    return { ok: resp.ok, status: resp.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

function postJson(path, body) {
  return api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function signInHref(name) {
  return `${loginUrl}?name=${encodeURIComponent(name)}`;
}

function shortToolName(namespaced) {
  return namespaced.split("__").slice(1).join("__");
}

function stripAliasPrefix(description) {
  return (description || "").replace(/^\[[^\]]*\]\s*/, "");
}

function statePill(service) {
  if (service.state === "NEEDS_LOGIN") return '<span class="pill warn">needs sign-in</span>';
  if (service.state === "ERROR") return '<span class="pill err">error</span>';
  if (service.credential === "NOT_REQUIRED") return '<span class="pill none">no sign-in needed</span>';
  return '<span class="pill ok">signed in</span>';
}

function descriptionCell(description) {
  const text = stripAliasPrefix(description);
  return text
    ? `<details class="description"><summary>${esc(text)}</summary></details>`
    : '<span class="muted">—</span>';
}

async function load() {
  const resp = await api("/api/services");
  if (!resp.ok) {
    const reason = resp.data?.error || `HTTP ${resp.status}`;
    $("service-list").innerHTML = `<div class="note">Could not load services: ${esc(reason)}</div>`;
    $("detail").innerHTML = "";
    return;
  }
  services = resp.data.services;
  loginUrl = resp.data.login_url;
  $("config-source").textContent = resp.data.config_source;
  $("revoke-all").hidden = !services.some((s) => s.credential === "ACTIVE");
  if (!selected && services.length) selected = services[0].name;
  renderServiceList();
  renderService();
}

function renderServiceList() {
  const list = $("service-list");
  if (!services.length) {
    list.innerHTML = '<div class="muted pad">No services configured.</div>';
    return;
  }
  list.innerHTML = services.map((s) => `
    <button class="service-row${s.name === selected ? " selected" : ""}" data-name="${esc(s.name)}">
      <span><span class="service-name">${esc(s.alias)}</span><br><span class="service-fqn">${esc(s.name)}</span></span>
      ${statePill(s)}
    </button>`).join("");
  list.querySelectorAll(".service-row").forEach((row) => row.addEventListener("click", () => {
    selected = row.dataset.name;
    renderServiceList();
    renderService();
  }));
}

function renderService() {
  const detail = $("detail");
  const service = services.find((s) => s.name === selected);
  if (!service) {
    detail.innerHTML = '<div class="pad-lg muted">Select a service.</div>';
    return;
  }
  let action = "";
  if (service.state === "NEEDS_LOGIN") {
    action = `<a class="btn btn-primary btn-sm" id="sign-in" target="_blank" rel="noopener" href="${esc(signInHref(service.name))}">Sign in</a>`;
  } else if (service.credential === "ACTIVE") {
    action = '<button class="btn btn-secondary btn-sm" id="revoke">Revoke</button>';
  }
  const tools = service.tools;
  const rows = tools.map((t) => `
    <tr><td class="tool-name" title="${esc(t.name)}">${esc(shortToolName(t.name))}</td>
    <td>${descriptionCell(t.description)}</td></tr>`).join("");
  let toolsSection = '<div class="muted">No tools.</div>';
  if (service.state === "NEEDS_LOGIN") {
    toolsSection = '<div class="note">Sign in to this service to see and use its tools.</div>';
  } else if (service.error) {
    toolsSection = `<div class="note">Could not list tools: ${esc(service.error)}</div>`;
  } else if (tools.length) {
    toolsSection = `
      <table><colgroup><col style="width:300px"><col></colgroup>
        <thead><tr><th>Tool</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table>
      ${invokeFormHtml(tools)}`;
  }
  detail.innerHTML = `<div class="pad-lg">
    <div class="detail-head"><h2 class="detail-title">${esc(service.alias)}</h2>${statePill(service)}${action}</div>
    <p class="detail-sub">${esc(service.name)}</p>
    <dl><dt>Tool prefix</dt><dd><code>${esc(service.alias)}__</code></dd>
        <dt>Tools exposed</dt><dd>${tools.length}</dd></dl>
    <div class="section-title">Tools</div>
    ${toolsSection}
  </div>`;
  $("sign-in")?.addEventListener("click", () => pollUntilSignedIn(service.name).then(load));
  $("revoke")?.addEventListener("click", () => revoke([service.name]));
  if (tools.length && !service.error) wireInvokeForm(tools);
}

function invokeFormHtml(tools) {
  const options = tools.map((t) => `<option value="${esc(t.name)}">${esc(shortToolName(t.name))}</option>`).join("");
  return `
    <div class="section-title">Try a tool</div>
    <div class="field"><label for="tool-select">Tool</label><select id="tool-select">${options}</select></div>
    <div class="field"><label for="tool-args">Arguments (JSON)</label><textarea id="tool-args">{}</textarea></div>
    <button class="btn btn-primary btn-sm" id="run-tool">Run</button>
    <div id="tool-output"></div>`;
}

function argumentTemplate(tool) {
  const properties = tool?.input_schema?.properties || {};
  return JSON.stringify(Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, v?.type || ""])), null, 2);
}

function wireInvokeForm(tools) {
  const select = $("tool-select");
  const args = $("tool-args");
  const fill = () => { args.value = argumentTemplate(tools.find((t) => t.name === select.value)); };
  select.addEventListener("change", fill);
  fill();
  $("run-tool").addEventListener("click", async () => {
    const output = $("tool-output");
    let parsed;
    try {
      parsed = JSON.parse(args.value || "{}");
    } catch (e) {
      output.innerHTML = `<div class="output">Invalid JSON: ${esc(e.message)}</div>`;
      return;
    }
    const button = $("run-tool");
    button.disabled = true;
    output.innerHTML = '<div class="muted" style="margin-top:10px">Running…</div>';
    const resp = await postJson("/api/call", { name: select.value, arguments: parsed });
    button.disabled = false;
    const data = resp.data || {};
    if (data.needs_login) {
      output.innerHTML = '<div class="note">Not signed in to this service. Sign in, then run again.</div>';
    } else if (!resp.ok || data.error) {
      output.innerHTML = `<div class="output">${esc(data.error || `HTTP ${resp.status}`)}</div>`;
    } else {
      output.innerHTML = `<div class="output">${esc(data.text || "(no output)")}</div>`;
    }
  });
}

async function runSearch(event) {
  event.preventDefault();
  const query = $("search-query").value.trim();
  if (!query) return;
  selected = null;
  renderServiceList();
  const detail = $("detail");
  detail.innerHTML = `<div class="pad-lg muted">Searching for “${esc(query)}”…</div>`;
  const resp = await api(`/api/search?q=${encodeURIComponent(query)}&n=${$("search-top-n").value}`);
  if (!resp.ok) {
    detail.innerHTML = `<div class="pad-lg"><div class="note">Search failed: ${esc(resp.data?.error || `HTTP ${resp.status}`)}</div></div>`;
    return;
  }
  const hits = resp.data.tools;
  const rows = hits.map((t, i) => `
    <tr><td class="tool-name" title="${esc(t.name)}">${i + 1}. ${esc(t.name)}</td>
    <td>${descriptionCell(t.description)}</td>
    <td class="score">${esc(t.score)}</td>
    <td><button class="btn btn-secondary btn-sm" data-tool="${esc(t.name)}">Try</button></td></tr>`).join("");
  detail.innerHTML = `<div class="pad-lg">
    <h2 class="detail-title">Top ${hits.length} for “${esc(query)}”</h2>
    <p class="detail-sub">What <code>search_tools</code> returns on <code>/mcp/search</code> (${esc(resp.data.backend)} index).</p>
    ${hits.length ? `<table><colgroup><col style="width:300px"><col><col style="width:64px"><col style="width:64px"></colgroup>
      <thead><tr><th>Tool</th><th>Description</th><th>Score</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
      : '<div class="muted">No matches. Sign in to services so their tools get indexed, then retry.</div>'}
  </div>`;
  detail.querySelectorAll("button[data-tool]").forEach((b) => b.addEventListener("click", () => openTool(b.dataset.tool)));
}

function openTool(name) {
  const service = services.find((s) => s.alias === name.split("__")[0]);
  if (!service) return;
  selected = service.name;
  renderServiceList();
  renderService();
  const select = $("tool-select");
  if (select) {
    select.value = name;
    select.dispatchEvent(new Event("change"));
    select.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

async function revoke(names) {
  for (const name of names) {
    const resp = await postJson("/api/revoke", { name });
    if (!resp.data?.ok) {
      alert(`Revoke failed for ${name} (HTTP ${resp.data?.status ?? resp.status}): ${resp.data?.detail || resp.data?.error || ""}`);
      break;
    }
  }
  await load();
}

async function pollUntilSignedIn(name) {
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const resp = await api(`/api/services?name=${encodeURIComponent(name)}`);
    const service = resp.data?.services?.[0];
    if (service && service.state !== "NEEDS_LOGIN") return true;
  }
  return false;
}

async function signInAll() {
  // Open one popup inside the click (so it isn't blocked) and walk it through each
  // service's sign-in page. The workspace sign-in page won't redirect back to this
  // app's origin, so wait for each sign-in by polling instead.
  const popup = window.open("about:blank", "mcp_sign_in", "width=560,height=720");
  if (!popup) {
    alert("Your browser blocked the sign-in window. Allow popups for this app and try again.");
    return;
  }
  const pending = services.filter((s) => s.state === "NEEDS_LOGIN");
  const button = $("sign-in-all");
  button.disabled = true;
  for (const [i, service] of pending.entries()) {
    if (popup.closed) break;
    popup.location.href = signInHref(service.name);
    button.textContent = `Signing in ${i + 1}/${pending.length}…`;
    await pollUntilSignedIn(service.name);
    await load();
  }
  popup.close();
  button.disabled = false;
  button.textContent = "Sign in to all";
}

document.addEventListener("DOMContentLoaded", () => {
  $("mcp-url").textContent = MCP_URL;
  $("search-url").textContent = SEARCH_URL;
  document.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => {
    navigator.clipboard?.writeText($(b.dataset.copy).textContent);
  }));
  $("sign-in-all").addEventListener("click", signInAll);
  $("revoke-all").addEventListener("click", () => revoke(services.filter((s) => s.credential === "ACTIVE").map((s) => s.name)));
  $("search-form").addEventListener("submit", runSearch);
  load();
});

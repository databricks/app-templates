# appkit-lakeflow-designer

The published Lakeflow Designer app: a Vite + React client and a Node/AppKit server. One published
Databricks App is deployed per published Designer flow, all sharing this single source, deployed
git-backed (the app points at this repo; Databricks pulls, builds, and runs it).

Per-app differences are injected at deploy time rather than baked into the source:

- **Runner job** — bound as an app resource named `job`, surfaced to the server as the
  `DATABRICKS_JOB_ID` env var via `app.yaml`'s `valueFrom`. The App service principal needs
  `CAN_MANAGE` on this Job to grant submitters permission to view runs.
- **Manifest** (`designerApp.json`, which operators/parameters/markdown to render) — written by the
  publish flow beside the runner notebook in its publisher-owned workspace folder. The server
  derives that folder from the bound job's notebook path; no shared manifest root is needed.

## Run attribution and usage reporting

Every App submission uses Jobs `job_parameters`. The server records the submitting user's
`X-Forwarded-User` ID and `X-Forwarded-Email`, together with the runtime App ID and a unique submission
ID. Numeric `user@workspace` ingress subjects are recorded as the user ID. When the preferred-name
header contains only an email, the server uses the forwarded user token to read that user's profile
and snapshot their display name. An unavailable profile falls back to the ingress email.
Submissions without authenticated ingress identity, an ingress email or a runtime App ID are refused
before starting a Job. These headers must come from the trusted Apps ingress in production.

The server starts the saved runner Job with `runNow`. Before starting it, the server uses the
verified ingress email as `user_name` to grant the submitter `CAN_VIEW` on that Job. Existing user
permissions, including owner and manager grants, are retained; other principals' ACL entries are
preserved by an incremental permissions update. The server reads the ACL again to confirm the grant;
a failed read, grant or confirmation prevents the run from starting. The update uses SDK authentication
with a native HTTP PATCH because `sdk-experimental` 0.17.0 omits PATCH request bodies. Both the local
bundle and the Designer publish flow must bind the `job` resource with
`CAN_MANAGE`; existing published Apps need their Job resource grant upgraded before adopting this
template version.

This permission allows the user to view every run of this App's runner Job in Databricks Jobs,
including other users' runs and results. It persists independently of App access, so removing a
user's App access does not revoke their Job permission. History, results, cancellation and downloads
inside the App continue to enforce per-viewer ownership.

The explicit `DATABRICKS_APP_ID` takes precedence. Standalone Apps on older runtimes expose only
`DATABRICKS_CLIENT_ID`; their App service principal uses the App UUID, so that OAuth client ID is
the fallback. This template targets standalone Apps; App-space service principals have a different
identity relationship.

The reserved parameters are `_lb_app_id`, `_lb_app_user_id`, `_lb_app_user_name`,
`_lb_app_user_email`, `_lb_app_submission_id` and `_lb_app_parameters`. The last contains a JSON
map of exposed Designer inputs with their labels, types and resolved values, including defaults
and explicit empty multi-selects. File inputs report the uploaded filename; the actual execution
parameter remains the validated UC file path. Consumer parameters cannot override `_lb_` metadata.
Names and input labels reflect the time of submission, so republishing does not rewrite past runs.

Designer can create a workspace-scoped UC reporting view and AI/BI dashboard when publishing.
The source is `system.lakeflow.job_run_timeline`, which retains job-level parameters; no OTel
delivery is required for a run to be attributed. The report combines timeline slices into one
row per Job run and derives elapsed time from timestamps. Owners can query the reporting view
with SQL. Dashboard access is separate from App access and publishing does not embed credentials.
System-table updates are delayed and retain 365 days of history. This is a greenfield run contract;
there is no reader for deprecated notebook-parameter runs or historical backfill.

## Layout

- `server/server.ts` — the Node/AppKit server (TypeScript). Type-checked and bundled by
  `build:server` (`tsc -b` + `tsdown`) to `dist/server.js`, which `start` runs.
- `server/uploads.ts` / `server/outputFiles.ts` — upload, uploaded-input download, and native
  Output-file download routes. Both download paths share `server/fileDownloads.ts` for streaming.
  Backend-only AppKit Files adapters enforce separate upload and read-only output policies.
- `client/` — the React client, built by Vite to `client/dist`.
- `app.yaml` — start command and env bindings (`command: ['npm', 'run', 'start']`).
- `tsconfig.shared.json` / `tsconfig.server.json` / `tsconfig.client.json` — a strict shared base
  with a server (Node) and a client (DOM) project, referenced by the root `tsconfig.json`.
- `package.json` — `build` (`build:server` then `build:client`) and `start`
  (`node ./dist/server.js`). Everything the server needs at build and run time is under
  `dependencies` (Databricks Apps skips `devDependencies` when `NODE_ENV=production`).

## Local build

    npm install
    npm run build   # build:server (tsc -b + tsdown -> dist/server.js) + build:client (vite -> client/dist)
    npm run typecheck
    npm run dev    # client-only development; API requests still require the AppKit server
    npm start       # node ./dist/server.js

## Result previews

The app reads each run's exported notebook display results and sends at most 1,000 rows per output
to the client. Tables and charts use this same bounded preview. The notebook's `overflow` flag is
preserved; it can indicate a row or byte limit, so the app does not label it as sampling or guess
which limit was reached. Missing overflow metadata means completeness is unknown, not complete.

The table footer shows result counts on one line. Complete results show `268 rows`.
Truncated results with an exact total show `Showing 1,000 of 93,997 rows`; without a known
total they show `1,000 preview rows · Truncated`. Missing completeness metadata uses `returned rows`
without claiming truncation or completeness. Filtering changes the count to matching rows
within the returned result; a truncated preview retains its full-result total when available.
Charts warn when they use a truncated result.

A complete export capped only by the app can use its original length as the exact total.
When the notebook export itself overflowed, an exact total comes from the runner's structured
row-count result when available; otherwise it remains unknown. App runs request counts for
published output nodes. The shared Python runtime emits those counts after the table displays.

The app does not trigger a new count query or rerun the job when loading results. Full-data
downloads are not implemented by the preview path.

Result tables support ascending/descending header sorting, case-insensitive search across all
columns (including hidden columns), a column visibility menu, and resizable columns. Drag a column
header's right edge to resize it, or focus the edge and use Left/Right arrows. Double-click the
edge or press Enter to restore its measured width. Resized widths stay set while sorting,
filtering, or hiding columns. All returned rows appear in a scrollable table with sticky headers.
These controls apply to the returned preview only; they do not fetch omitted rows or rerun the job.
The truncation notice and original result counts remain visible. Row numbers identify the original
returned row even after sorting or filtering. At least one data column remains visible.

AppKit UI supplies the table and controls. TanStack React Table 8.21.3 (MIT, already a transitive
AppKit UI dependency) manages sorting, filtering, column visibility, and column sizing over the
job-result rows; it is pinned as a direct dependency with its integrity hash in the lockfile.
AppKit's packaged `DataTable` currently requires an analytics query rather than accepting supplied
data. Sorting uses schema types and preserves
the precision of string-encoded integers and decimals. Run `npm test` to validate sorting,
filtering, visibility, unusual SQL column aliases, and bounded-preview rendering.

## Chart rendering

Published bar, line, area, and pie charts use Vega-Lite/Vega, the same chart engine family as
Designer's standard charts. `chartTranslation.ts` validates the manifest's Databricks chart spec;
`chartData.ts` prepares typed, long-format rows and sorted domains; `chartSpec.ts` builds a
Vega-Lite spec; `OutputChart.tsx` embeds it as responsive SVG. Charts use Designer's default
visualization palette. AppKit still supplies the surrounding UI and theme-aware axis/grid colors.
The renderer stays in a lazy-loaded client chunk.
Chart frame titles are hidden, matching Designer; the output block's heading remains visible.

Bars retain their declared orientation and use Designer's band spacing. Color series default to
stacked bars/areas; explicit grouped, layered, and percent-stacked layouts are supported. Lines
map `smooth` to monotone interpolation and `step` to step-after. Pies use Designer's 50% donut
hole by default and honor `mark.innerRadius` (0–100%). Axes honor titles, visibility, label angles,
numeric domain bounds and reversal. Categorical X labels rotate when space is tight. Numeric and
temporal coordinates remain continuous; category labels are never inferred as dates.

Categorical axes and series honor `scale.sort`: natural/reversed, original/reversed, custom lists,
and sorting by X, Y, angle, or a numeric measure present in the result. With no explicit sort,
categories use Designer's schema-aware natural order (lexicographic for strings, numeric for
numbers); pie slices default to descending angle totals. Unlisted custom-order values follow in
natural order. Measure-based sorting ranks category totals without pivoting or aggregating the
returned rows, keeping data aligned and category colors stable across explicit sort changes. Horizontal categories read
top to bottom. Continuous X coordinates remain ascending.

This is not a full Designer visualization renderer. Measure sorting uses sums of the returned
rows: the published result does not include Designer's column-transform metadata or separate
grouping results needed for more advanced aggregation semantics, such as custom MIN/MAX sorts.
Designer-specific formatters, advanced color mappings, custom legends/tooltips, annotations,
facets, additional encoding channels and chart types are not reproduced. Default label rotation
uses an estimated text width, not Designer's measured text layout. This is closer to Designer,
not pixel-identical. Unsupported chart types, unrecognized sort settings, missing sort fields,
and runtime rendering failures fall back to the result table.

Run `npm test` with Node 22.18+ to check translation, sorting, and real Vega-Lite compilation/Vega
SVG rendering, including resizing, stacked totals, category colors, and empty results. No
Playwright tests or additional test dependencies are required.

The renderer pins [Vega](https://github.com/vega/vega) 6.2.0,
[Vega-Lite](https://github.com/vega/vega-lite) 6.4.3, and
[Vega Embed](https://github.com/vega/vega-embed) 7.0.2. All three use the BSD-3-Clause license;
the lockfile records package integrity hashes. Installs during development use the internal
package proxy, but the committed lockfile must use `https://registry.npmjs.org/` for all
package URLs so published apps do not depend on corporate network access. After dependency
updates, normalize any proxy URLs in the lockfile without changing versions or integrity
hashes; changing npm's registry setting alone does not rewrite existing lockfile URLs.
Chart rendering does not change the manifest or runner-job contracts.

## App upload storage and file parameters

Manifest v6 uses an optional storage declaration for uploads:

```json
{
  "version": 6,
  "storage": {
    "volume": "main.apps.shared",
    "path": "/Volumes/main/apps/shared/designer_apps/my_app",
    "maxUploadFileSizeBytes": 5368709120
  }
}
```

The server/client accept v6 only. Apps without file parameters may omit upload storage; a file
parameter without valid storage is rejected. File inputs are never downgraded
to text or the author's original source path.
The template and publisher use this single current manifest contract. Uploads and volume switching
share Designer's existing `enableDesignerApps` gate.

The author selects a UC volume in Designer; publishing binds it without creating another volume.
The existing `designer_uploads` App resource with `WRITE_VOLUME` gives the app service
principal read/write access; the runner job's run-as principal also needs read access. Uploads
use AppKit's Files plugin, not workspace files or app-container disk. No operator code changes are needed.
The plugin is initialized lazily from the manifest in a backend-only AppKit instance (no server plugin).
Its generic file-browser routes are never mounted; the Designer routes enforce viewer/parameter ownership.
Upload, bounded sidecar reads, metadata, directory creation, and deletion all use the plugin API.

Viewers stage files up to 5 GiB in the browser. Clicking Run streams the staged files through the app
server to the configured Unity Catalog volume before starting the job. Bytes are capped while reading, and the
server limits concurrent upload requests to four. A completed upload gets an immutable generated
directory preserving the original filename and a persisted sidecar; only completed uploads can become
job input. The browser holds an opaque upload reference, not an arbitrary volume path. Publishing
records each upload parameter's static Source formats in `fileFormats`. The picker filters known
extensions; browser and server reject mismatched filenames before upload, and run submission rechecks
retained uploads against the current manifest. A parameter used by multiple Sources must match all
their static constraints. Text/binary readers, inferred formats, unknown providers and formats
parameterized at runtime have no filename restriction.
This is extension validation, not content or schema validation: renamed or malformed files still
reach the reader. Uploading never changes the Source format, read options (including Excel
sheet/range), or expected columns. Parse/schema errors are reported by the normal Job run.

Apps with uploads or file Outputs require the authenticated `x-forwarded-user` header supplied by Databricks Apps ingress.
Do not expose this server directly to untrusted traffic that can supply its own identity headers.
There is no anonymous/local-development fallback. Uploads are partitioned by job, viewer and
parameter. Run submissions carry a server-owned `_lb_app_viewer` parameter; history, result reads,
and cancellation enforce it even if upload controls are later removed. Existing users with
direct Jobs or UC permissions, and volume owners/admins, are outside this in-app isolation boundary.

Uploaded files are retained until the volume owner deletes them. There is no automatic expiration, consumer
delete action, or deletion of storage when an App is deleted. The app does not expose retained files
for selection; viewers select a local file for each browser session. Manual cleanup must account for queued, running, retrying jobs.
Uploads use `<storage.path>/uploads/<viewer-hash>/<parameter-hash>/<upload-id>/<filename>`.

Uploaded filenames in last-run and selected-run parameter summaries are download links.
Downloads stream the original bytes through AppKit Files after checking the authenticated viewer,
current file parameter, completion record and recorded size. They do not start a Job, copy files
or delete the upload. Changing the upload root or removing the file parameter makes old links
unavailable; retained files still require volume-owner cleanup. Interrupted downloads can be retried.

File Outputs write directly to their author-configured destinations. Separate backend-only Files
plugin policies restrict uploads to their subtree and native downloads to approved output volumes.
Existing files are not moved or deleted; viewers upload a new file after the app adopts the new root.
The Files plugin refreshes its handle and path policy when either the volume or root changes;
no restart is needed. Overlapping requests retain their own manifest's policy. Requests already
using the old volume may finish or fail if publishing removes its access.

Authors can change the upload volume in Designer and apply it on Publish.
The publisher prepares access to both volumes,
confirms the new manifest, and then reconciles `designer_uploads`. Old volume access needed
for file Outputs is retained. Unconfirmed publication retains both grants; confirmed publication
with incomplete cleanup shows a warning and the next Publish repairs it. No files are copied
or deleted, and the App identity, runner Job, and Jobs run records remain.

The browser refreshes configuration on focus, before uploading, and before Run. An observed
volume, root, or file-input change clears file selections and cached upload references while
preserving valid non-file inputs. Late upload completions are ignored. The server rejects a
reference missing from the current root with `UPLOAD_UNAVAILABLE`; the browser refreshes
configuration and asks for fresh files. It never retries a Job submission automatically. An entirely unobserved
A-to-B-to-A cycle can retain an A reference; no persistent upload generation is introduced.

`npm test` covers storage completion/partial failures, limits, parameter resolution and ownership
policy with an in-memory storage boundary, plus server-route access checks, volume switches,
stale-reference refusal before Job submission, upload cache invalidation, and history hydration.
Download tests use real HTTP responses and cover original bytes/names, ownership isolation,
missing or changed files, completed and interrupted transfers, and run-summary parameter links.
Actual Apps ingress, UC provisioning/grants and Jobs
execution still require a deployed smoke test, including resource read-back versus effective
grant propagation and Jobs running as the App principal. Complete these checks before deploying
the authoring and template changes.

## Native Output-file downloads

Authors publish file-configured Output v4 operators to offer downloads. CSV, JSON and XLSX use
the operator's existing writer, including workbook sheets/ranges and split files. Table and
materialized-view Outputs are not supported. Ordinary operators still publish previews and
full row counts but no longer offer generic full-data export generation.

Each selected file Output has an explicit volume allowlist in the trusted Workspace manifest:

```json
{
  "type": "output",
  "id": "output_0_result",
  "nodeId": "output_0",
  "port": "result",
  "label": "Saved report",
  "fileOutput": { "volumes": ["main.apps.reports", "main.apps.team_reports"] }
}
```

Consumers may parameterize directories, filenames and destinations within those approved volumes.
The runner resolves parameters and validates actual destination paths when the run executes. The App
server passes `_lb_file_outputs` as a server-owned node-to-policy map, plus viewer ownership and execution revision.
Neither browser parameters nor recorded metadata can add an unapproved destination.
Publishing grants the App service principal read access to the selected output volumes. The Job's
run-as identity independently needs permission to write there; App resource bindings do not grant
the publisher extra permissions. Running the App has write side effects with that identity.
Approval covers the **entire volume**, not a directory prefix. Only recorded Output artifacts are
downloadable through the App, but shared append/workbook destinations may target existing files anywhere in an approved volume.
Use dedicated volumes for isolation. Append and Excel range/sheet writes can preserve prior file
contents; downloading the resulting file exposes those prior rows or other sheets as well.

Ordinary overwrite Outputs generate a separate file for each execution beneath
`<configured directory>/_designer_apps/<submission namespace>/<attempt>/<node>/<filename>`.
The App server generates a fresh reserved `_lb_output_namespace` UUID for every submitted run with
file outputs; the Python runtime adds an attempt UUID and node ID. Consumer parameters cannot supply
the namespace. Direct runs of the published Job mint a runtime namespace when the server parameter
is absent. Filename/directory parameters are evaluated first, and split filenames retain their
native suffixes within that run's directory. Later App runs do not overwrite these artifacts.
Append Outputs keep their configured destination. Excel range updates also keep the configured
workbook, even when the operator's write mode is overwrite, because they preserve its other contents.

After a successful write, the Python runtime emits a structured MIME receipt
(`application/vnd.databricks.lakeflow-designer.files+json`) naming the exact written files and recording
the effective behavior: `run_artifact`, `shared_append`, or `shared_workbook_update`.
These receipts are read separately from previews/counts so files remain available if a later preview
or sibling branch fails. A single file appears as a filename download link. Multiple files use a
searchable AppKit UI selector and a Download button, with up to 50 files. Storage paths are hidden.
There is no ZIP or second format conversion. An empty split result has no downloadable files.
Excel downloads contain the entire workbook, and append downloads include the entire saved
destination, not only new rows.

The authenticated endpoint accepts only run/output/index IDs. It verifies viewer ownership, Job,
completed run, selected Output, matching recorded policy/revision, and the current content-addressed
runner notebook path before resolving the recorded canonical file path. Presentation-only manifest
changes do not invalidate downloads. Changed execution configuration requires another App run.
Treat generated runner files as immutable deployment artifacts; edit in Designer and republish.

The App server streams UC bytes through backend-only AppKit Files handles using its service principal.
No storage credentials or presigned URLs reach the browser. No new Job, SQL warehouse, second file,
staging volume, export cache, or deletion is involved. Upload storage is not required for file-only Apps.
Completed and interrupted downloads retain the original file for repeated and concurrent downloads.

The historical UI labels run-generated files separately from shared append/workbook destinations
using that run's receipt, never the current manifest. Older receipts without behavior metadata remain
conservative: they do not claim run isolation. Downloads always read the recorded path; external
writes or deletion can still change a run-generated artifact. Shared destinations return their
**current contents**, including changes after the selected run. They need deliberate concurrency and
overwrite policy; append mode does not provide atomicity or retry deduplication.
Receipt availability follows Jobs output retention. A missing/deleted file produces a readable error.
Native writer size and format limits apply; downloads do not silently truncate or reserialize files.

Full row counts remain enabled by `_lb_collect_row_counts` and `ld_display_outputs_for`, using the
same shared Python helper and structured count results as before. Visualizations hide the count label.
File receipts are emitted before result readback/counting and do not consume a preview-table ordinal.
Shared-file outputs explain that previews/counts are as of the selected run, not necessarily the
current downloaded file. The count is the operator's result count, not a count of rows newly appended.

There is no automatic TTL, cleanup Job, or consumer DELETE endpoint. Volume owners manage retention.
Upgrading removes the generic export endpoints but does not delete previously staged exports, cache
metadata, uploads, Output files or published helper versions. Republish and run again after upgrading.

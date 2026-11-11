# Lakeflow Designer

`designer()` serves published Lakeflow Designer Apps: manifest loading, Job submission,
run history and cancellation, notebook results, and uploaded/generated file transfers.
The app template owns the React interface, charts, tables, HTML sandbox, and browser recovery.

## Install

```bash
pnpm exec appkit add designer --allow-unverified
```

The item is unverified until reviewed by an AppKit maintainer. Inspect its source before
allowing installation. The CLI copies this folder into `server/plugins/designer`, installs
the declared dependencies, synchronizes the manifest, and registers the plugin:

```ts
import { createApp, server } from '@databricks/appkit';
import { designer } from './plugins/designer';

await createApp({ plugins: [designer(), server()] });
```

This source works with the published AppKit 0.89.0 SDK. No SDK fork or package release is
needed. It uses the public plugin lifecycle, route registration, telemetry, and shared
`ServiceContext` workspace client. It does not create nested AppKit instances.

The Designer publisher must provision a matching runner Job, `designerApp.json`, and
permissions. An arbitrary Job is insufficient. Installing the plugin does not create
a Designer flow or grant resource permissions.

## Runtime contract

All endpoints are relative to `/api/designer`; the manifest contract is version 8.

| Endpoint                                                 | Behavior                                             |
| -------------------------------------------------------- | ---------------------------------------------------- |
| `GET /config`                                            | Read the current manifest and check runner readiness |
| `POST /run`                                              | Validate inputs and submit the bound Job             |
| `GET /run/:jobRunId`                                     | Read an authorized run and its outputs               |
| `DELETE /run/:jobRunId`                                  | Cancel an authorized run                             |
| `GET /last-run`, `GET /runs`                             | Read the viewer's active run and history             |
| `POST /uploads/:parameterName`                           | Stream an immutable parameter upload                 |
| `GET /uploads/:parameterName/:reference/download`        | Download an owned upload                             |
| `GET /run/:jobRunId/files/:outputId/:fileIndex/download` | Download a declared file from an authorized run      |

Run submissions use JSON `{ params: { ... } }`. Uploads use `application/octet-stream`
with the URL-encoded filename in `X-File-Name`.

`DATABRICKS_JOB_ID` identifies the publisher-owned Job. Its notebook path locates the
manifest, outside publicly served assets. Missing or incompatible manifests keep Run
unavailable. Republishing refreshes the manifest without requiring a restart; submissions
pause while the manifest and runner revision disagree.

`DATABRICKS_APP_ID`, falling back to `DATABRICKS_CLIENT_ID`, identifies the App for run
attribution. Databricks Apps ingress supplies trusted `X-Forwarded-User` and email headers.
`DATABRICKS_APP_URL` identifies the public origin when ingress rewrites Host. A custom
deployment must provide an equally trusted ingress; end users cannot supply these identities.
Jobs, Workspace, and Files operations use the App service principal. A forwarded user token
is used only to look up the submitting user's display name.

The Job resource retains the publisher's `CAN_MANAGE` permission. It is optional in the
plugin manifest so `/config` can explain an incomplete publication. Optional upload/output
volumes come from the validated Designer manifest and can change on republish. The publisher
owns their grants; the plugin does not register generic Jobs or Files routes. File transfers
use the public workspace client, with upload-subtree and declared-output path checks.

Run reads, cancellation, history, and downloads enforce Job and viewer ownership. File
downloads additionally check the publication and recorded receipt. Browser-origin checks
and private response headers apply throughout. Cached outputs belong to the plugin instance,
authorization precedes cache reads, and shutdown clears them. Disabled nodes and groups use
existing exported notebook metadata and manifest hints without changing code generation.

## Run attribution and usage reporting

Every App submission uses Jobs `job_parameters`. The server records the submitting user's
`X-Forwarded-User` ID and `X-Forwarded-Email`, together with the runtime App ID and a unique submission
ID. Numeric `user@workspace` ingress subjects are recorded as the user ID. When the preferred-name
header contains only an email, the server uses the forwarded user token to read that user's profile
and snapshot their display name. An unavailable profile falls back to the ingress email.
Submissions without authenticated ingress identity, an ingress email or a runtime App ID are refused
before starting a Job. These headers must come from the trusted Apps ingress in production.

The server starts the saved runner Job with `runNow` and stamps every submission with a
server-owned viewer identity. History, results, cancellation and downloads within the App require
that identity to match the current viewer, including Apps without file inputs or outputs.
The consumer UI keeps run access within the App. Submitting a run grants no direct Job permissions;
independent Job permissions remain effective and can expose runs outside the App's viewer controls.
Authors retain the Job-management link in Designer.

`DATABRICKS_APP_ID` supplies the runtime App ID. The OAuth client ID fallback is specific to
standalone runtimes whose principal shares the App UUID; App Space deployments need the explicit
App ID for accurate attribution.

The reserved parameters are `_lb_app_id`, `_lb_app_user_id`, `_lb_app_user_name`,
`_lb_app_user_email`, `_lb_app_submission_id` and `_lb_app_parameters`. The last contains a JSON
map of exposed Designer inputs with their labels, types and resolved values, including defaults
and explicit empty multi-selects. File inputs report the uploaded filename; the actual execution
parameter remains the validated UC file path. Consumer parameters cannot override `_lb_` metadata.
Names and input labels reflect the time of submission, so republishing does not rewrite past runs.

Owners can build usage reports from `system.lakeflow.job_run_timeline`, which retains job-level
parameters. Reporting access is separate from App access, and system-table delivery is delayed.
The publisher records run metadata; reporting views and dashboards are separately managed.

## Republishing and concurrent runs

Each publication records an immutable `runner-<sha256>.designer.py` notebook and a snapshot of all
execution defaults in `designerApp.json`. The server compares this snapshot with the bound Job
before accepting a submission and passes the complete snapshot with each run. Hidden defaults
stay on the server. A revision check in the first notebook cell rejects requests racing changes to
workflow code or parameter defaults before any workflow code executes.

Republishing prepares volume grants and the template before changing the active runner. New
submissions pause with an “App is updating” message until the manifest and Job agree; existing runs
continue. A failure between changing the Job and updating the manifest keeps submissions paused
until the author retries. This protocol detects mixed configurations; it does not serialize
concurrent publishers.

Ordinary Apps allow five concurrent runs. Apps with file Outputs allow one run at a time to protect
shared append and workbook updates. Both explicitly enable Jobs queueing. The UI retains an
accepted run through temporary status failures, retries reads, and exposes cancellation failures
so the consumer can retry. The browser never retries Job submission automatically. SDK transport
retries reuse the submission ID as the Jobs idempotency token to avoid starting duplicate runs.

History filters every run by viewer and returns a continuation cursor when a bounded scan has not
reached the end. “Load older runs” continues beyond pages filled by other viewers. The last-successful
run search follows those cursors automatically.

## Browser imports

Import schemas, run/result types, response parsers, and route helpers from `plugins/designer/client`, adjusting the
relative path for your app:

```ts
import { appManifestSchema, type AppManifest } from '../../server/plugins/designer/client';
```

The client barrel includes only shared code and Zod. Never import the server entry in a
browser bundle. Commit all installed plugin files with the consuming template so client
and server contracts advance together.

## Development and testing

In the registry checkout:

```bash
pnpm install --frozen-lockfile
pnpm typecheck:designer
pnpm test:designer
pnpm registry:build
pnpm test:designer-install
```

The shared-contract tests cover manifest validation, file formats, multi-selects, and run-summary
parsing. The backend tests use AppKit's public test kit and real HTTP/streaming implementations;
only remote Databricks services are simulated. The installation test runs the released
`appkit add` CLI against the locally built item and checks the copied source and bootstrap.
Its fixture replaces only the two registry URLs, allowing a pre-merge test without publishing.

For template maintenance, run `appkit add designer --force --no-register --no-resources`
after the registry change lands (add `--allow-unverified` while the item is unverified).
Review the source diff and commit it with dependency/lockfile changes. Record the originating
registry commit in the template's update documentation. Run the template's tests, browser checks,
and production build. Advance the Designer publisher's pinned template
revision and republish Apps that should receive the update. The publisher does not call
`appkit add` at deployment time.

While iterating, edit the installed plugin with the template's `pnpm dev`, then move the
changes back to this folder and rebuild the registry item. Keep the installed source identical
to that item before merging. No local package links or unpublished SDK tarballs are necessary.

A deployment test must also verify the real Apps ingress and App service principal's Job,
Workspace, and UC permissions. Check config readiness, successful table/chart/HTML results,
both conditional branches, uploads and repeated downloads, history, cancellation, a second
viewer, and republishing with changed storage. Simulated tests cannot establish those grants.

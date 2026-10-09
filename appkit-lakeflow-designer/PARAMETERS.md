# Parameter controls

The published manifest supports `text`, `number`, `dropdown`, `combobox`, `multiselect`, and
`file` parameters. Dropdown choices are an allowlist; combobox choices are
optional suggestions. A combobox accepts arbitrary strings, including defaults
and submitted values outside its suggestions.

The client and server preserve combobox suggestions from `designerApp.json`.
The form uses an AppKit input with a themed suggestion popover. Typing filters
suggestions; the arrow button shows all choices. Arrow keys and Enter select a
suggestion, while values entered without selecting a suggestion stay editable.
Empty or invalid suggestions leave the input editable. The run API forwards
custom values without applying dropdown validation.

Older template readers treat unknown types as text, so values continue to work
without suggestions. Publish with a combobox-capable template to enable the control.

Multi-select parameters use labelled AppKit checkboxes. Their choices are an
allowlist, not suggestions. Defaults and submitted selections use Designer's
comma-separated string format, preserving selection order and whitespace within
choices. Choices must be non-empty strings without commas; every default
selection must be offered. Both manifest readers reject an invalid multi-select
configuration rather than silently dropping or demoting the parameter.

Omitting a multi-select value uses its default. Submitting `""` deliberately
selects nothing, even when the default is non-empty. Arrays, nulls, unoffered
choices, and empty segments in a non-empty value are rejected before a Job starts.
Last-run restoration preserves an empty selection and falls back to the current
default if the recorded selection is no longer offered.

Deploy a multi-select-capable reader, form, and run validator before enabling
Designer Apps or publishing these parameters. Existing apps acquire the control
on republish. Do not downgrade their template to a reader that treats the type as
text and cannot validate individual selections.

File parameters stage a local file and upload it when Run is clicked. A completed upload shows
**Download** beside the file picker, including while the Job is running. Replacing the file hides
that link until the replacement finishes uploading. Uploaded filenames in run summaries also
download the original file, so the input remains accessible after refreshing the App. These
downloads enforce the current viewer, file parameter and upload storage; another user's uploads
and files from a previous upload root are unavailable through the App.

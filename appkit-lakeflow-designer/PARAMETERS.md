# Parameter controls

The published manifest supports `text`, `number`, `dropdown`, `combobox`, and
`file` parameters. Dropdown choices are an allowlist; combobox choices are
optional suggestions. A combobox accepts arbitrary strings, including defaults
and submitted values outside its suggestions.

The client and server preserve combobox suggestions from `designerApp.json`.
The form uses the AppKit input with a browser-native suggestion list. Empty or
invalid suggestions leave the input editable. The run API forwards custom values
without applying dropdown validation.

Older template readers treat unknown types as text, so values continue to work
without suggestions. Publish with a combobox-capable template to enable the control.

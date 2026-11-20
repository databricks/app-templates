# Dependency patches

`body-parser@1.20.8.patch` backports the `lib/read.js` fix from upstream commit
[`1260c3845f54502a05a87594f09a334786bb34d7`](https://github.com/expressjs/body-parser/commit/1260c3845f54502a05a87594f09a334786bb34d7)
for [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828).
The original package is MIT licensed; its license and attribution remain in the installed package.

The patch validates the charset before opening a decompression stream and cleans up that stream
after reading. pnpm applies it during installation; `pnpm-lock.yaml` records the patch hash.
Both AppKit's Express dependency and the HTTP test server use this patched package.

The fixed 1.20.9 release was published on October 22, 2026 and was unavailable through the internal
package proxy when this patch was added on October 28. Once available, pin `body-parser` to 1.20.9
or a later compatible patched release, remove this patch and its `patchedDependencies` entry,
then regenerate the lockfile and run the tests and audit.

`pnpm audit --prod` still reports the advisory because it checks the 1.20.8 version rather than the
patched source. The finding is intentionally not suppressed. The HTTP tests cover ordinary and
compressed submissions; the existing browser tests cover input validation and run recovery.

---
name: Browser verification
description: Why browser tests use the system Chromium wrapper in this Replit environment.
---

Use the system-provided Chromium wrapper for browser tests in this environment,
while keeping test configuration portable to ordinary developer machines.

**Why:** Playwright's downloaded Linux browser expects conventional shared-library
paths that are absent in Nix. The system wrapper supplies its library environment.

**How to apply:** Prefer the configured system browser rather than repeatedly
downloading browser binaries or changing the application's runtime. Browser caches
and test results are disposable generated files and must stay out of Git and deployment.

Playwright runs test-file imports through Node's ESM loader, not Vite's bundler.

**Why:** A workspace barrel that imports bare JSON can work in the app and Vitest
yet fail before Playwright discovers tests because Node requires JSON import
attributes.

**How to apply:** Keep browser-test workspace imports type-only or JSON-free.
Check library metadata in Vitest or in the browser instead of importing its raw
JSON-dependent barrel into the Playwright runner.

Do not use performance-timeline marks as acknowledgments in tests that install
Playwright's clock.

**Why:** The installed fake clock stubs `performance.mark` and returns an empty
array from `getEntriesByName`, so signal-count assertions can pass as `0 === 0`
even after the event occurs.

**How to apply:** Use a clock-independent acknowledgment counter in clock tests.
Re-probe this behavior after upgrading Playwright rather than assuming it changed.

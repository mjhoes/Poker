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

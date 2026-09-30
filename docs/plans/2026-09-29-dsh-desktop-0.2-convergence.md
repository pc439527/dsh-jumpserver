# DSH Desktop 0.2.x Convergence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Convert dsh-jumpserver from a Desktop-compatible legacy plugin into a secure, native DSH Desktop 0.2.x plugin.

**Architecture:** Keep the existing conversation-scoped core and bridge policy surface, but remove bearer-token exposure, make the loopback console stable, route settings/sidebar integration through DSH 0.2 native services, and fail closed when conversation identity is unavailable. Treat the current WorkBuddy import as core/function synchronization rather than UI parity.

**Tech Stack:** TypeScript, Cordis/DSH 0.2.0-rc.1, Node.js 22.19+, Electron Desktop, Vitest, GitHub Actions.

---

### Task 1: Secure and stabilize the loopback console
- Change the default console port to 8766.
- Bootstrap authentication with an HttpOnly SameSite cookie from the loopback page.
- Remove tokens from URL factories, HTML, logs, state files, schemas, and tool results.
- Keep optional conversation selection outside server-visible credentials.
- Flip console and audit tests to assert token absence.

### Task 2: Unify effective configuration
- Introduce one effectiveConfig resolver used by getConfig, configView, and connectionSource.
- Remove overlay writes from the bridge once native configForms is wired.
- Keep credential values in the DSH credentials service only.

### Task 3: Adopt native DSH Desktop surfaces
- Register settings through ctx.configForms for the jumpserver entry.
- Open the loopback console through ctx.sidebarRight browser tabs.
- Remove the dsh-better-sidebar dependency and stale client inject metadata.

### Task 4: Fail closed and align declared capability
- Reject tool calls without an authoritative conversation session id.
- Remove or implement console tab declarations so types match rendered UI.
- Correct concurrency descriptions to preserve one-conversation/one-PTY semantics.

### Task 5: Align release engineering and repository hygiene
- Set DSH Desktop 0.2.x / Node 22.19+ as the supported baseline.
- Run CI on Ubuntu and Windows with Node 22.
- Remove the committed Git bundle and ignore future submission bundles.
- Sanitize machine-specific paths and clarify WorkBuddy source provenance.

### Task 6: Validate behavior
- Run focused console, settings, session isolation, jobs, interrupt, and manifest tests.
- Run typecheck/build/full test suite on the local Windows environment.
- Inspect the final diff for leaked tokens, stale overlay APIs, Better Sidebar references, and local paths.

---
description: Implement one small whisperlane milestone slice with a verify loop
---

Implement one small slice: $ARGUMENTS.

Loop rules:
1. Read docs/07-roadmap.md acceptance criteria for the slice first; build only that.
2. Load the whisperlane-craft skill and follow it while writing code.
3. Implement the smallest change that satisfies the slice. No extras, no phase-two work, Windows only.
3. Run /wl-verify. Fix failures and re-verify until green.
4. Commit the slice with an English commit message.
5. Summarize in Turkish: what changed, file list, verify results, commit hash.

Never widen scope to close an acceptance gap with extra features; record the gap in docs/08-decisions.md instead.

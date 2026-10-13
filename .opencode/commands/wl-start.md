---
description: Run whisperlane milestone slices in order with a verify loop
---

Run the whisperlane build loop for: $ARGUMENTS (default M0).

Setup first:
1. Read docs/README.md, docs/07-roadmap.md, docs/08-decisions.md, and the skill bodies of whisperlane-docs, whisperlane-mvp, and whisperlane-craft.
2. Confirm the milestone acceptance criteria and list its slices in roadmap order.

Loop rules, one slice at a time:
1. Implement the smallest change that satisfies the slice. Windows only, no agent integration, no extras.
2. Verify: typecheck the changed packages, run their tests, build the desktop shell if touched. Fix failures and re-verify until green.
3. Report the slice in Turkish: what changed, file list, verify results. Then continue to the next slice without asking for continuation permission.

Do not ask "shall I continue" between slices; the report is the handoff. Stop only at the gates below.

Gates — stop and report to the user, do not push through:
- Any verify failure you cannot resolve after three fix attempts.
- Any step that needs a decision recorded in docs/08-decisions.md.
- End of the milestone: summarize all slices and stop. Never start the next milestone without explicit user approval.

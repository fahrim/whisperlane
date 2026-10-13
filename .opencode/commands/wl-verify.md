---
description: Verify whisperlane slice with typecheck, tests, and build
---

Verify the current whisperlane slice, in this order, stopping at the first failure:

1. Typecheck the changed packages.
2. Run the unit tests for the changed packages.
3. Build the desktop shell if the slice touches it.

Report each step as pass or fail with the failing output quoted briefly. Do not fix; just report. The slice owner fixes and re-runs this command.

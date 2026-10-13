# ADR-003: Device Event Filter for the Global Hotkey

Status: approved.

## Context

The dictation hotkey runs on a low-level keyboard hook installed by the
desktop core. On the M0 development machine the hotkey fired reliably while
another application was focused and delivered nothing at all while the
whisperlane window itself was focused: the hook callback was never invoked,
and the observed chord state stayed false. No hook code path explains zero
callbacks, so the cause was one layer up.

The wry repository documents the same behavior in issue 1761: a host
application's global low-level keyboard hook receives no key events while
one of the app's own WebView2 windows has focus. Two independent users
confirm that setting the device event filter to always restores delivery,
including across focus changes and shortcut delivery to target
applications.

## Options considered

- Keep the default focused filter and work around it in the interface
  layer, where the hotkey is re-implemented as a document key listener.
  Works, but splits one behavior across two layers and leaves every
  non-interface host unaware.
- Change the device event filter to always so the core owns the hotkey
  end to end, independent of window focus. One mechanism, one place.

## Decision

Set the device event filter to always.

## Consequences

- The core owns the hotkey on every focus state; the interface layer never
  re-implements it.
- Device events keep arriving while no window is focused. The skeleton has
  no use for them, and the window-less tray presence planned for the product
  depends on this behavior anyway.
- The reference issue stays open upstream; this record notes the workaround
  so a future framework upgrade re-tests it deliberately.

## Related

- Proposal: `../08-decisions.md` item 7 (binding and its delivery)
- Structure: `../05-architecture.md`
- Delivery: `../07-roadmap.md`
- Source plan: `../plan/pre-start-intro-plan.md`
# Idea Bank — Parked for Later

Future candidates, explicitly not v1. Each entry records the source, why
it is parked, and what would trigger re-evaluation. Nothing here is
promised or scheduled.

## Transcription history and library

Source: external UI brief, Handy reference. A stored list of past takes
for review, search, and reuse.

Parked: v1 non-goal; history implies retention and deletion duties the
MVP does not take on. Re-evaluate post-MVP with a privacy story
(retention window, deletion controls, local-only guarantee) attached.

## Live transcription card

Source: external mockup streaming state. A larger card showing text as it
arrives during longer takes.

Parked: needs the streaming decision first (docs/08-decisions.md item 2).
The pill's own card exists and shows the last finished take, because that
is what record-then-transcribe can honestly produce; nothing on it implies
words are arriving while the user is still speaking. Re-evaluate if
record-then-transcribe feels slow on long takes.

## Pause and resume

Source: external brief, proposed as optional. Parked: pause only exists
if supported end to end through capture, transcription, and insertion.
Re-evaluate if hold and toggle prove insufficient for long takes.

## Pin pill

Source: external mockup quick actions. Parked: the tray already covers
the at-rest home. Re-evaluate on real user requests.

## Auto-paste and auto-send

Source: external brief settings, competitor behavior. Parked: pasting
without an explicit user action needs a reliability proof per target
first. Re-evaluate in phase two alongside agent destinations.

## Appearance tuning

Source: external brief settings (glass intensity, pill size, position
memory excepted — position memory is adopted in v1). Parked: v1 settings
stay minimal. Re-evaluate after the visual direction proves itself.

## Mobile targets

Source: external brief cross-platform section. Parked: mobile is a
non-goal; a floating pill cannot behave identically under mobile
permissions and background limits. Re-evaluate only as a dedicated
milestone, never as an extension of the desktop work.

## Settling the pill back to quiet

Source: M2 polish. A finished take can be put away without beginning
another one — the pill hides and the tray becomes the home again.

Parked: the pill's main control now starts the next take from a finished
state, exactly as the chord has always done, so the back-to-back case
costs nothing on either input path. Settling to quiet is the rarer
intent and has no surface; it was briefly a row in the pill's menu and
was removed because the menu should hold the doors out of the
application, not the ones back. Re-evaluate if the transcript panel
lands, since settling and reviewing are then the same gesture rather
than two.

## Custom words and translate-to-English

Source: architecture reference candidates. Parked with the rest of the
post-v1 list in docs/05-architecture.md. Re-evaluate post-MVP.

## Related

- v1 boundaries: docs/03-product.md
- Visual direction: docs/04-experience.md
- Open questions: docs/08-decisions.md
- Order of work: docs/07-roadmap.md

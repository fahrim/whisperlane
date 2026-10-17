// The window's own controls, in the same language as the pill's.
//
// The pill shows a choice as a row of rounded segments and a yes-or-no as
// a filled pill. This window is a calm flat plane, but it is the same
// product, so a choice here is a rounded bordered field and a yes-or-no is
// a switch that slides rather than a box that fills.
//
// Nothing here is a platform control. The window is frameless and sized to
// its content, and a native dropdown ignores both: it paints its list
// outside the window and is clipped at the edge, and it paints it in the
// platform's own colours over a surface chosen to look quiet. Drawing the
// list is the only way to keep it inside the window and on the surface.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

export interface PickerOption {
  code: string;
  label: string;
}

export interface PickerProps {
  value: string;
  options: PickerOption[];
  /** Plain-language name of the setting, for the accessible name. */
  label: string;
  onChange: (value: string) => void;
}

/** Where the list has room to open, and how much of it. */
interface Placement {
  top: number;
  left: number;
  maxHeight: number;
  above: boolean;
}

/** Room around the list, kept clear of the window's own edge. */
const GUTTER = 8;

/**
 * One setting chosen from a list.
 *
 * The list opens inside the window by measuring what is left below the
 * field and, when that is not enough, opening upward instead. A list that
 * ran past the edge would be worse than the native one it replaces: the
 * options below the fold are options the user cannot see exist.
 */
export function Picker({ value, options, label, onChange }: PickerProps) {
  const [open, setOpen] = useState(false);
  // Which row the keyboard is on. Kept as the chosen row's index so
  // opening the list lands on the answer rather than the first row.
  const [active, setActive] = useState(() =>
    Math.max(0, options.findIndex((option) => option.code === value)),
  );
  const [placement, setPlacement] = useState<Placement | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.code === value);

  function show(from: "first" | "chosen") {
    setActive(
      from === "chosen"
        ? Math.max(0, options.findIndex((option) => option.code === value))
        : 0,
    );
    setPlacement(null);
    setOpen(true);
  }

  function choose(code: string) {
    // Choosing the answer that is already the answer closes without
    // writing, as it did when the platform drew this.
    if (code !== value) onChange(code);
    setOpen(false);
    button.current?.focus();
  }

  // Measured after the list is on screen, because how tall it wants to be
  // is the thing being asked. The first paint is unclamped and may overflow
  // for a frame; nothing visible happens in that frame.
  //
  // Keyed on being open rather than on the options, which are rebuilt on
  // every render at most call sites: measuring again each time would set
  // state again each time, and a measure that re-measures is a loop.
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = button.current?.getBoundingClientRect();
    const panel = list.current;
    if (!anchor || !panel) return;
    const below = window.innerHeight - anchor.bottom - GUTTER;
    const above = anchor.top - GUTTER;
    const wanted = panel.scrollHeight;
    const upwards = wanted > below && above > below;
    const room = Math.max(upwards ? above : below, 120);
    setPlacement({
      top: upwards ? anchor.top - GUTTER - Math.min(wanted, room) : anchor.bottom + 6,
      left: Math.min(anchor.left, window.innerWidth - anchor.width - GUTTER),
      maxHeight: room,
      above: upwards,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Focus moves to the list while it is open. That is the whole point:
  // with the button still focused, Enter is both "choose" and the button's
  // own activation, so one press would pick an option and then close the
  // list the picking had just opened. Off the button, Enter is only one
  // thing, because a div has no activation of its own.
  useEffect(() => {
    if (open) list.current?.focus();
  }, [open]);

  // Any press elsewhere dismisses it, and Escape does too. A list that can
  // only be closed by choosing something is a list that can trap.
  useEffect(() => {
    if (!open) return;
    function away(event: PointerEvent) {
      if (
        !button.current?.contains(event.target as Node) &&
        !list.current?.contains(event.target as Node)
      ) {
        setOpen(false);
        button.current?.focus();
      }
    }
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  // Closed, the arrow keys open the list onto an end; Enter and Space are
  // left to the button, which already does the right thing with them.
  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      show("chosen");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      show("first");
      setActive(options.length - 1);
    }
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" || event.key === "Tab") {
      setOpen(false);
      button.current?.focus();
      return;
    }
    const last = options.length - 1;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, last));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(last);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(options[active].code);
    }
  }

  // The row the keyboard is on is kept in view, so arrowing past the fold
  // scrolls to it rather than moving the highlight somewhere invisible.
  useEffect(() => {
    if (!open) return;
    list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  return (
    <div className="picker">
      <button
        type="button"
        ref={button}
        className="picker-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? setOpen(false) : show("chosen"))}
        onKeyDown={onButtonKeyDown}
      >
        <span className="picker-value">{selected?.label ?? label}</span>
        <span className={`picker-chevron${open ? " picker-chevron-open" : ""}`} />
      </button>
      {open && (
        <div
          ref={list}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          className="picker-list"
          style={
            placement
              ? {
                  top: placement.top,
                  left: placement.left,
                  maxHeight: placement.maxHeight,
                }
              : undefined
          }
          onKeyDown={onListKeyDown}
        >
          {options.map((option, index) => (
            <div
              key={option.code}
              role="option"
              aria-selected={option.code === value}
              className={`picker-option${
                index === active ? " picker-option-active" : ""
              }`}
              onPointerEnter={() => setActive(index)}
              onClick={() => choose(option.code)}
            >
              <span className="picker-option-label">{option.label}</span>
              {option.code === value && (
                <span className="picker-tick" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface SwitchProps {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

/**
 * A preference that is either on or off.
 *
 * A checkbox asks the question "is this box ticked"; a switch states the
 * setting and offers to change it. The state lives on the element as
 * aria-checked, so the control reads the same to a screen reader as it
 * looks, and the label is passed in because a button is not a labelable
 * control and would otherwise be announced with nothing but its value.
 */
export function Switch({ checked, label, disabled, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  );
}

export interface SegmentProps {
  value: string;
  options: PickerOption[];
  onChange: (next: string) => void;
}

/**
 * One setting with a small number of answers, all of them on screen.
 *
 * Not a switch: a switch states where the setting is, and this is asked
 * because the answer is not known yet. A switch sitting at its default
 * reads as an answer nobody gave. These two buttons say so.
 *
 * Arrow keys are not wired, which a radiogroup is expected to have. Tab
 * reaches each button and Space picks it, so the pair is operable without
 * them; a two-answer question does not earn the arrow-key handling that a
 * long list would.
 */
export function Segmented({ value, options, onChange }: SegmentProps) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((option) => (
        <button
          key={option.code}
          type="button"
          role="radio"
          aria-checked={option.code === value}
          className="segment"
          onClick={() => onChange(option.code)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
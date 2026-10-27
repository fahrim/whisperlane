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
import { createPortal } from "react-dom";
import type { KeyboardEvent, ReactNode, RefObject } from "react";

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
  leadingIcon?: ReactNode;
  renderValue?: (selected: PickerOption | undefined) => ReactNode;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  /** Locked while something else owns the value, such as a fetch in flight. */
  disabled?: boolean;
}

/** Where the list has room to open, and how much of it. */
interface Placement {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  above: boolean;
}

/** Room around the list, kept clear of the window's own edge. */
const GUTTER = 10;

/**
 * One setting chosen from a list.
 *
 * The list is portaled to document.body so that ancestor backdrop-filter or
 * transform layers on cards never hijack position:fixed coordinates, and
 * measured against .window-frame so it stays inside the visible card.
 */
export function Picker({
  value,
  options,
  label,
  onChange,
  leadingIcon,
  renderValue,
  buttonRef,
  disabled = false,
}: PickerProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() =>
    Math.max(0, options.findIndex((option) => option.code === value)),
  );
  const [placement, setPlacement] = useState<Placement | null>(null);
  const internalButton = useRef<HTMLButtonElement>(null);
  const button = buttonRef ?? internalButton;
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
    if (code !== value) onChange(code);
    setOpen(false);
    button.current?.focus();
  }

  useLayoutEffect(() => {
    if (!open) return;

    const updatePlacement = () => {
      const anchor = button.current?.getBoundingClientRect();
      const panel = list.current;
      if (!anchor || !panel) return;

      const frameEl = button.current?.closest(".window-frame");
      const bounds = frameEl
        ? frameEl.getBoundingClientRect()
        : {
            top: 0,
            left: 0,
            right: window.innerWidth,
            bottom: window.innerHeight,
            width: window.innerWidth,
            height: window.innerHeight,
          };

      const below = bounds.bottom - anchor.bottom - GUTTER;
      const above = anchor.top - bounds.top - GUTTER;
      const wanted = panel.scrollHeight;
      const upwards = wanted > below && above > below;
      const room = Math.max(upwards ? above : below, 120);
      const maxAvailableWidth = Math.max(120, bounds.width - GUTTER * 2);
      const width = Math.min(Math.max(anchor.width, 160), maxAvailableWidth);
      const unclampedLeft = anchor.left;
      const left = Math.max(
        bounds.left + GUTTER,
        Math.min(unclampedLeft, bounds.right - width - GUTTER),
      );
      const top = upwards
        ? anchor.top - 6 - Math.min(wanted, room)
        : anchor.bottom + 6;

      setPlacement({
        top,
        left,
        width,
        maxHeight: room,
        above: upwards,
      });
    };

    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) list.current?.focus();
  }, [open]);

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
  }, [open, button]);

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
    } else if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const char = event.key.toLowerCase();
      const nextIndex = options.findIndex(
        (opt, idx) => idx > active && opt.label.toLowerCase().startsWith(char),
      );
      const matchIndex =
        nextIndex !== -1
          ? nextIndex
          : options.findIndex((opt) => opt.label.toLowerCase().startsWith(char));
      if (matchIndex !== -1) {
        event.preventDefault();
        setActive(matchIndex);
      }
    }
  }

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
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show("chosen"))}
        onKeyDown={onButtonKeyDown}
      >
        <span className="picker-button-lead">
          {leadingIcon && (
            <span className="picker-leading-icon" aria-hidden="true">
              {leadingIcon}
            </span>
          )}
          <span className="picker-value">
            {renderValue ? renderValue(selected) : (selected?.label ?? label)}
          </span>
        </span>
        <span className={`picker-chevron${open ? " picker-chevron-open" : ""}`} />
      </button>
      {open &&
        createPortal(
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
                    width: placement.width,
                    maxHeight: placement.maxHeight,
                  }
                : { visibility: "hidden" }
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
          </div>,
          document.body,
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

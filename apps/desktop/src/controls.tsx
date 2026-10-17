// The window's own controls, in the same language as the pill's.
//
// The pill shows a choice as a row of rounded segments and a yes-or-no as
// a filled pill. This window is a calm flat plane, but it is the same
// product, so a choice here is a rounded bordered field and a yes-or-no is
// a switch that slides rather than a box that fills. Both draw their own
// affordance: the native Windows dropdown arrow belongs to a dialog from
// the nineteen-nineties, not to a surface drawn to look this quiet.

import type { ReactNode } from "react";

export interface PickerProps {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}

/** A chosen option, drawn with a chevron rather than the platform's own. */
export function Picker({ value, onChange, children }: PickerProps) {
  return (
    <span className="picker">
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </span>
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
  options: { code: string; label: string }[];
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
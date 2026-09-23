import React, { useRef, useState } from "react";
import { AirplaneTilt } from "@phosphor-icons/react";

/**
 * AirplaneButton — primary CTA with an airplane that takes off when clicked.
 *
 * Wrap any "Save", "Advance", "Submit", "Proceed" action with this. The
 * airplane icon flies to the right with a contrail before invoking the
 * provided onClick, giving the user a small joyful "departure" cue.
 *
 *   <AirplaneButton onClick={save}>Save Project</AirplaneButton>
 */
export default function AirplaneButton({
  children,
  onClick,
  type = "button",
  className = "",
  disabled = false,
  iconWeight = "fill",
  iconSize = 14,
  testid,
  ...rest
}) {
  const btnRef = useRef(null);
  const [taking, setTaking] = useState(false);

  const fly = (e) => {
    if (disabled || taking) return;
    // For submit buttons, let the native form submit fire FIRST. We just play
    // the visual takeoff after, without interfering with the submit.
    if (type === "submit") {
      // Defer state update until after the native submit event has dispatched
      Promise.resolve().then(() => setTaking(true));
      setTimeout(() => setTaking(false), 700);
      return;
    }
    e?.preventDefault?.();
    setTaking(true);
    setTimeout(() => {
      try {
        if (onClick) onClick(e);
      } finally {
        setTimeout(() => setTaking(false), 420);
      }
    }, 220);
  };

  return (
    <button
      ref={btnRef}
      type={type}
      onClick={fly}
      disabled={disabled}
      className={`btn-airplane ${taking ? "is-taking-off" : ""} ${className}`}
      data-testid={testid}
      {...rest}
    >
      <span className="font-medium">{children}</span>
      <span className="plane-icon" aria-hidden>
        <AirplaneTilt size={iconSize} weight={iconWeight} />
      </span>
    </button>
  );
}

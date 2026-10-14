import React, { useRef, useState } from "react";
import { AirplaneTilt } from "@phosphor-icons/react";

/**
 * AirplaneButton — the CTA for moving work forward (stage advance, submit for approval): the airplane icon
 * takes off as the action runs. Routine saves use a plain .btn-primary.
 *
 *   <AirplaneButton onClick={() => advance(next)}>Advance to Operations</AirplaneButton>
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
    // the action runs at once; the take-off plays alongside it (skipped when the user prefers reduced motion)
    const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!still) {
      setTaking(true);
      setTimeout(() => setTaking(false), 700);
    }
    if (type !== "submit" && onClick) onClick(e);
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

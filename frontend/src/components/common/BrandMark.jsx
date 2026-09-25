import React from "react";
import { ChartLineUp } from "@phosphor-icons/react";

/** The WAISL FinSight mark (same as the favicon): a navy chart line on the gold tile. */
export default function BrandMark({ size = 32, className = "" }) {
  return (
    <div className={`flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size, background: "var(--gold, #FFC000)" }}>
      <ChartLineUp weight="bold" size={Math.round(size * 0.58)} className="text-[#0A1628]" />
    </div>
  );
}

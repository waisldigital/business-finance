import React from "react";

import { STAGES } from "@/config/stages";

export default function StageTracker({ current, onStageClick }) {
  const idx = STAGES.indexOf(current);
  return (
    <div className="flex w-full" data-testid="stage-tracker">
      {STAGES.map((s, i) => {
        const cls = i === idx ? "active" : i < idx ? "completed" : "";
        return (
          <div
            key={s}
            className={`stage-block ${cls}`}
            onClick={() => onStageClick && onStageClick(s)}
            data-testid={`stage-${s.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}`}
            style={{ cursor: onStageClick ? "pointer" : "default" }}
          >
            <div className="text-[9px] opacity-60 mb-0.5">STEP {i + 1}</div>
            {s}
          </div>
        );
      })}
    </div>
  );
}


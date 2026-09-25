// Project lifecycle stages, in order (the backend's models.STAGES).
export const STAGES = ["Pipeline", "Deal P&L", "Customer PO", "Operations", "Closure"];

// stages an approval rule can gate (moving into any stage after Pipeline); "" = any stage
export const RULE_STAGES = ["", ...STAGES.slice(1)];

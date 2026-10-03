"""Workspace sections — the one list the API uses for role permissions (the frontend mirrors it in
frontend/src/config/sections.js). AOP_SECTIONS are the Annual Operating Plan screens; aop_payroll is confidential
and also gates resource-cost lines in the P&L."""

WORKSPACE = ["dashboard", "pipeline", "projects", "change_requests", "customer_profile", "wbs_budget"]
AOP_SECTIONS = ["aop_pnl", "aop_inputs", "aop_revenue", "aop_opex", "aop_overheads", "aop_payroll", "aop_capex", "aop_reports", "aop_review"]
SECTIONS = WORKSPACE + AOP_SECTIONS

import React from "react";
import { Table } from "@phosphor-icons/react";
import PageHeader from "@/components/PageHeader";
import PnLView from "@/aop/PnLView";

export default function PnLPage({ admin = false }) {
  return (
    <div data-testid="aop-pnl-page">
      <PageHeader compact icon={Table} title={admin ? "P&L check" : "P&L"}
              subtitle={admin ? "Reconcile imported data against the approved workbook — same engine users see, unmasked"
                              : "WAISL P&L · actuals from the single actual source, forecast and budget from the AOP"} />
      <div className="p-3"><PnLView /></div>
    </div>
  );
}

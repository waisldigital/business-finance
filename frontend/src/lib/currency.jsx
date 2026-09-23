import React, { createContext, useContext, useEffect, useState } from "react";
import api from "@/lib/api";
import { formatCurrency as fmt } from "@/lib/format";

const CurrencyContext = createContext(null);

export function CurrencyProvider({ children }) {
  const [mode, setMode] = useState(() => localStorage.getItem("cp_currency") || "INR");
  const [inrPerUsd, setInrPerUsd] = useState(83);

  useEffect(() => {
    api.get("/settings").then((r) => {
      if (r.data?.inr_per_usd) setInrPerUsd(Number(r.data.inr_per_usd));
      if (!localStorage.getItem("cp_currency") && r.data?.default_currency) {
        setMode(r.data.default_currency);
      }
    }).catch(() => {});
  }, []);

  const update = (m) => {
    setMode(m);
    localStorage.setItem("cp_currency", m);
  };

  // Convenience: format value in current mode with admin rate
  const format = (value) => fmt(value, mode, inrPerUsd);

  return (
    <CurrencyContext.Provider value={{ mode, setMode: update, inrPerUsd, setInrPerUsd, format }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export const useCurrency = () => useContext(CurrencyContext);

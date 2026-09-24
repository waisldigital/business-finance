import React, { createContext, useContext, useEffect, useState } from "react";
import api from "@/lib/api";
import { formatCurrency as fmt } from "@/lib/format";
import { setUsdRate } from "@/aop/format";

const CurrencyContext = createContext(null);

export function CurrencyProvider({ children }) {
  const [mode, setMode] = useState(() => localStorage.getItem("cp_currency") || "INR");
  const [inrPerUsd, setInrPerUsd] = useState(83);
  // ₹ figures shown in Crore or Lakh; one toggle in the header drives every screen (₹ Crore · ₹ Lakh · $ Million)
  const [scale, setScale] = useState(() => localStorage.getItem("cp_inr_scale") || "cr");
  useEffect(() => { setUsdRate(inrPerUsd); }, [inrPerUsd]);

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

  // unit for AOP tables: "cr" | "lakh" | "usd"
  const unit = mode === "USD" ? "usd" : scale;
  const setUnit = (u) => {
    if (u === "usd") return update("USD");
    setScale(u);
    localStorage.setItem("cp_inr_scale", u);
    update("INR");
  };

  // Convenience: format value in current mode with admin rate
  const format = (value) => fmt(value, mode, inrPerUsd, scale);

  return (
    <CurrencyContext.Provider value={{ mode, setMode: update, inrPerUsd, setInrPerUsd, format, unit, setUnit }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export const useCurrency = () => useContext(CurrencyContext);

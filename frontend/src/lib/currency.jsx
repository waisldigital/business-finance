import React, { createContext, useContext, useEffect, useState } from "react";
import api from "@/lib/api";
import { formatMoney, setUsdRate } from "@/aop/format";

const CurrencyContext = createContext(null);

export function CurrencyProvider({ children }) {
  const [mode, setMode] = useState(() => localStorage.getItem("fs_currency") || "INR");
  const [inrPerUsd, setInrPerUsd] = useState(83);
  // ₹ figures shown in Crore or Lakh; one toggle in the header drives every screen (₹ Crore · ₹ Lakh · $ Million)
  const [scale, setScale] = useState(() => localStorage.getItem("fs_inr_scale") || "cr");
  useEffect(() => { setUsdRate(inrPerUsd); }, [inrPerUsd]);

  useEffect(() => {
    api.get("/settings").then((r) => {
      if (r.data?.inr_per_usd) setInrPerUsd(Number(r.data.inr_per_usd));
      if (!localStorage.getItem("fs_currency") && r.data?.default_currency) {
        setMode(r.data.default_currency);
      }
    }).catch(() => {});
  }, []);

  const update = (m) => {
    setMode(m);
    localStorage.setItem("fs_currency", m);
  };

  // unit for AOP tables: "cr" | "lakh" | "usd"
  const unit = mode === "USD" ? "usd" : scale;
  const setUnit = (u) => {
    if (u === "usd") return update("USD");
    setScale(u);
    localStorage.setItem("fs_inr_scale", u);
    update("INR");
  };

  // Convenience: a money amount in the selected unit (admin-set rate for $)
  const format = (value) => formatMoney(value, unit);

  return (
    <CurrencyContext.Provider value={{ mode, setMode: update, inrPerUsd, setInrPerUsd, format, unit, setUnit }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export const useCurrency = () => useContext(CurrencyContext);

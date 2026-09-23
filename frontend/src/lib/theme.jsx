import React, { createContext, useContext, useEffect, useState } from "react";

const THEMES = [
  { key: "alabaster", label: "Alabaster", mode: "light", swatch: ["#FAFAF8", "#A67C00", "#111110"] },
  { key: "beige", label: "Soft Beige", mode: "light", swatch: ["#F5F1E8", "#8B6914", "#3A2E1E"] },
  { key: "golden", label: "Golden", mode: "light", swatch: ["#FBF6E5", "#D4AF37", "#1F1A0B"] },
  { key: "royal", label: "Royal Purple", mode: "light", swatch: ["#FFFFFF", "#FFC000", "#5C2B84"] },
  { key: "charcoal", label: "Charcoal Gold", mode: "dark", swatch: ["#16151A", "#D4AF37", "#F2EFE6"] },
  { key: "midnight", label: "Midnight", mode: "dark", swatch: ["#0E1118", "#C9A227", "#E8EAF0"] },
];

const ThemeCtx = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => localStorage.getItem("cp_theme") || "alabaster");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("cp_theme", theme);
  }, [theme]);

  return <ThemeCtx.Provider value={{ theme, setTheme, themes: THEMES }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
export { THEMES };

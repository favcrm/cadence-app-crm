import { LocaleTextProvider } from "@cadence/screen-ui";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { zhTW } from "./localeCatalog";

type Locale = "en" | "zh-TW";
type LocaleValue = { formatDate: (value: number, options?: Intl.DateTimeFormatOptions) => string; t: (english: string) => string; formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string };
const identity = (english: string) => english;
const LocaleContext = createContext<LocaleValue>({ formatDate: (value, options) => new Intl.DateTimeFormat("en", options).format(value), t: identity, formatNumber: (value, options) => new Intl.NumberFormat("en", options).format(value) });

/** Host-selected display data only. No preferences, session or authority access. */
export function CrmLocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<LocaleValue>(() => ({
    t: locale === "zh-TW" ? english => zhTW[english] ?? english : identity,
    formatDate: (date, options) => new Intl.DateTimeFormat(locale, options).format(date),
    formatNumber: (number, options) => new Intl.NumberFormat(locale, options).format(number),
  }), [locale]);
  return <LocaleContext.Provider value={value}><LocaleTextProvider value={value.t}>{children}</LocaleTextProvider></LocaleContext.Provider>;
}
export const useLocale = () => useContext(LocaleContext);
export const useTranslate = () => useLocale().t;

"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { LEGACY_FORMAT_CODES } from "@/modules/content/core/content-options";
import { activeOptions, DEFAULT_CONTENT_SETTINGS, optionLabel, wordRangeLabel, type ContentOption, type ContentSettings } from "@/modules/content/core/content-settings";

const Context = createContext<ContentSettings>(DEFAULT_CONTENT_SETTINGS);

/** Gives the content screens the lists from "Cài đặt Kho content". */
export function ContentSettingsProvider({ settings, children }: { settings: ContentSettings; children: ReactNode }) {
  return <Context.Provider value={settings}>{children}</Context.Provider>;
}

type Choice = { value: string; label: string; hint?: string };
const choices = (list: ContentOption[]): Choice[] => list.map((option) => ({ value: option.code, label: option.label, hint: wordRangeLabel(option) ?? undefined }));

/** Lists for pickers (only entries switched on) and filters (all), plus label lookups. */
export function useContentLists() {
  const settings = useContext(Context);
  return useMemo(() => ({
    settings,
    departments: choices(activeOptions(settings.departments)),
    formats: choices(activeOptions(settings.formats)),
    languages: choices(activeOptions(settings.languages)),
    styles: choices(activeOptions(settings.styles)),
    allDepartments: choices(settings.departments),
    allFormats: choices(settings.formats),
    allLanguages: choices(settings.languages),
    departmentLabel: (value: string) => optionLabel(settings.departments, value),
    formatLabel: (value: string) => optionLabel(settings.formats, LEGACY_FORMAT_CODES[value] ?? value),
    languageLabel: (value: string) => optionLabel(settings.languages, value),
    styleLabel: (value: string) => optionLabel(settings.styles, value),
  }), [settings]);
}

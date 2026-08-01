import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { apiJson } from '../api';
import { translations } from './translations';
import type { Translations } from './translations';

type I18nContextValue = {
  lang: string;
  t: (key: string, ...args: string[]) => string;
  setLang: (lang: string) => void;
};

const I18nContext = createContext<I18nContextValue>({
  lang: 'en',
  t: (key: string) => key,
  setLang: () => {},
});

function resolveLang(raw: string): keyof typeof translations {
  if (raw === 'zh' || raw === 'Chinese') return 'zh';
  if (raw === 'ja' || raw === 'Japanese') return 'ja';
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<string>('en');

  useEffect(() => {
    let cancelled = false;
    apiJson<{ ui?: { language?: string } }>('/api/settings')
      .then((data) => {
        if (cancelled) return;
        const resolved = resolveLang(data?.ui?.language ?? 'en');
        document.documentElement.lang = resolved === 'en' ? 'en' : resolved === 'zh' ? 'zh-CN' : 'ja';
        setLang(resolved);
      })
      .catch(() => {
        if (!cancelled) setLang('en');
      });
    return () => { cancelled = true; };
  }, []);

  const t = (key: string, ...args: string[]): string => {
    const dict: Translations | undefined = translations[lang as keyof typeof translations];
    let value = dict?.[key];
    if (!value) {
      const enDict: Translations = translations.en;
      value = enDict?.[key];
    }
    if (!value) return key;
    if (args.length > 0) {
      value = value.replace(/\{n\}|\{tab\}|\{taskId\}|\{message\}/g, args[0]);
    }
    return value;
  };

  return (
    <I18nContext.Provider value={{ lang, t, setLang }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

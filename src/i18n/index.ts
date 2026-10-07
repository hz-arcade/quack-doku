import { en } from './en';
import { es } from './es';
import { zhCN } from './zh-CN';
import { zhTW } from './zh-TW';

export type StringKey = keyof typeof en;
export type Strings = Record<StringKey, string>;
export type Lang = 'en' | 'zh-CN' | 'zh-TW' | 'es';

export const LANGS: readonly Lang[] = ['en', 'zh-CN', 'zh-TW', 'es'];
export const LANG_NAMES: Record<Lang, string> = { en: 'English', 'zh-CN': '简体中文', 'zh-TW': '繁體中文', es: 'Español' };

export const TABLES: Record<Lang, Strings> = { en, 'zh-CN': zhCN, 'zh-TW': zhTW, es };
const LANG_STORAGE_KEY = 'quack-doku.lang';

let current: Lang = 'en';
const listeners = new Set<(lang: Lang) => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang, persist = true): void {
  current = lang;
  if (persist) {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  for (const l of listeners) l(lang);
}

export function onLangChange(fn: (lang: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Map any BCP-47 tag to one of the supported languages, or null if unrelated. */
export function matchLang(tag: string): Lang | null {
  const t = tag.toLowerCase();
  if (t.startsWith('zh')) {
    if (t.includes('hant') || t.includes('tw') || t.includes('hk') || t.includes('mo')) return 'zh-TW';
    return 'zh-CN';
  }
  if (t.startsWith('en')) return 'en';
  if (t.startsWith('es')) return 'es';
  return null;
}

/** Resolution order: ?lang= → localStorage → navigator.languages → en. */
export function detectLang(search: string = typeof location !== 'undefined' ? location.search : '', navLangs: readonly string[] = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []): Lang {
  const q = new URLSearchParams(search).get('lang');
  if (q) {
    const m = matchLang(q);
    if (m) return m;
  }
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (stored && (LANGS as readonly string[]).includes(stored)) return stored as Lang;
  } catch {
    /* ignore */
  }
  for (const tag of navLangs) {
    const m = matchLang(tag);
    if (m) return m;
  }
  return 'en';
}

/** Translate with `{param}` substitution. */
export function t(key: StringKey, params?: Record<string, string | number>): string {
  let s: string = TABLES[current][key] ?? en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

/** "a, b and c" in the current language (Intl.ListFormat, with a plain fallback). */
export function list(items: readonly string[]): string {
  try {
    return new Intl.ListFormat(current, { style: 'long', type: 'conjunction' }).format(items);
  } catch {
    return items.join(current.startsWith('zh') ? '、' : ', ');
  }
}

/** Pick the `.one` or `.other` form of a counted message. */
export function plural(base: 'game.left' | 'hint.mistakes', n: number): string {
  return t(`${base}.${n === 1 ? 'one' : 'other'}` as StringKey, { n });
}

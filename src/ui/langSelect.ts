import { LANGS, LANG_NAMES, getLang, onLangChange, setLang, type Lang } from '../i18n';

const SHORT: Record<Lang, string> = { en: 'EN', 'zh-CN': '简', 'zh-TW': '繁', es: 'ES' };

/** Header language dropdown: a native <select> (so phones get their own picker) behind a pill. */
export function bindLangSelect(): void {
  const sel = document.getElementById('lang') as HTMLSelectElement;
  const label = document.getElementById('lang-label') as HTMLSpanElement;
  for (const l of LANGS) {
    const o = document.createElement('option');
    o.value = l;
    o.textContent = LANG_NAMES[l];
    sel.appendChild(o);
  }
  const sync = () => {
    sel.value = getLang();
    label.textContent = SHORT[getLang()];
  };
  sel.addEventListener('change', () => setLang(sel.value as Lang));
  onLangChange(sync);
  sync();
}

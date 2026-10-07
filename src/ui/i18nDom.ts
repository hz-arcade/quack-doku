import { getLang, onLangChange, t, type StringKey } from '../i18n';

/**
 * Static copy lives in index.html as data-i18n="key" (textContent), data-i18n-aria="key"
 * (aria-label + title) and data-i18n-ph="key" (placeholder). Call once at boot; it re-applies
 * itself whenever the language changes.
 */
export function applyTranslations(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as StringKey);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    const s = t(el.dataset.i18nAria as StringKey);
    el.setAttribute('aria-label', s);
    el.title = s;
  });
  document.title = t('app.title');
  document.documentElement.lang = getLang();
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('app.description'));
}

export function bindTranslations(): void {
  applyTranslations();
  onLangChange(() => applyTranslations());
}

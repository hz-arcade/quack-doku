import { onLangChange } from '../i18n';
import { make } from './dom.ts';

/**
 * One modal panel at a time (settings, how to play, win card, confirmations). The builder
 * runs again when the language changes, so open panels translate in place.
 */
export class Sheet {
  private readonly root: HTMLElement;
  private build: ((panel: HTMLElement) => void) | null = null;
  private onClose: (() => void) | null = null;
  private lastFocus: Element | null = null;
  name = '';

  constructor(root: HTMLElement) {
    this.root = root;
    root.addEventListener('pointerdown', (e) => {
      if (e.target === root && this.name !== 'win') this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
    onLangChange(() => this.redraw());
  }

  get isOpen(): boolean {
    return this.build !== null;
  }

  open(name: string, build: (panel: HTMLElement) => void, onClose?: () => void): void {
    if (!this.isOpen) this.lastFocus = document.activeElement;
    this.name = name;
    this.build = build;
    this.onClose = onClose ?? null;
    this.root.className = `sheet sheet-${name}`;
    this.root.setAttribute('aria-hidden', 'false');
    this.redraw();
    const first = this.root.querySelector<HTMLElement>('[data-autofocus], button, input, select');
    first?.focus({ preventScroll: true });
  }

  redraw(): void {
    if (!this.build) return;
    const panel = make('div', 'panel');
    this.build(panel);
    this.root.replaceChildren(panel);
  }

  close(): void {
    if (!this.isOpen) return;
    const cb = this.onClose;
    this.build = null;
    this.onClose = null;
    this.name = '';
    this.root.className = 'sheet hidden';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.replaceChildren();
    if (this.lastFocus instanceof HTMLElement) this.lastFocus.focus({ preventScroll: true });
    cb?.();
  }
}

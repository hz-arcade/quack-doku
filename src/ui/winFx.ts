import { make } from './dom.ts';

/** Soap bubbles rising over the board after a solve. Purely decorative. */
export function bubbles(over: HTMLElement, count = 18, onPop?: () => void): void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const layer = make('div', 'bubbles');
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < count; i++) {
    const b = make('span', 'bubble');
    const size = 10 + Math.random() * 26;
    b.style.setProperty('--x', `${Math.random() * 100}%`);
    b.style.setProperty('--s', `${size}px`);
    b.style.setProperty('--d', `${1.6 + Math.random() * 1.6}s`);
    b.style.setProperty('--w', `${(Math.random() - 0.5) * 60}px`);
    b.style.animationDelay = `${Math.random() * 0.9}s`;
    if (onPop && i % 4 === 0) b.addEventListener('animationend', onPop, { once: true });
    layer.appendChild(b);
  }
  over.appendChild(layer);
  window.setTimeout(() => layer.remove(), 4200);
}

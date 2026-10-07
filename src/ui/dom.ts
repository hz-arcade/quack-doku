export function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e as T;
}

/** Create an element. Text always goes through textContent, never innerHTML. */
export function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

export function button(className: string, text: string, onClick: () => void, id = ''): HTMLButtonElement {
  const b = make('button', className, text);
  b.type = 'button';
  if (id) b.id = id;
  b.addEventListener('click', onClick);
  return b;
}

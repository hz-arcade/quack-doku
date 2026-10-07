/** Small line icons (24×24, currentColor). Static markup only. */
const PATHS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  gear: '<path d="M10.3 3.2h3.4l.5 2.4 1.8.8 2-1.4 2.4 2.4-1.4 2 .8 1.8 2.4.5v3.4l-2.4.5-.8 1.8 1.4 2-2.4 2.4-2-1.4-1.8.8-.5 2.4h-3.4l-.5-2.4-1.8-.8-2 1.4-2.4-2.4 1.4-2-.8-1.8-2.4-.5v-3.4l2.4-.5.8-1.8-1.4-2 2.4-2.4 2 1.4 1.8-.8z"/><circle cx="12" cy="12" r="3"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 00-3.6 10.8c.8.6 1.1 1.4 1.1 2.2h5c0-.8.3-1.6 1.1-2.2A6 6 0 0012 3z"/>',
  reset: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  share: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 01-8 0z"/><path d="M8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8 21h8M9.5 17h5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  flame: '<path d="M12 21c-4 0-6.5-2.6-6.5-6.2C5.5 10.5 9 8.5 9.5 4c2.5 1.6 4.2 3.7 4.5 6.3.9-.6 1.5-1.6 1.7-2.8 2 1.8 2.8 4.2 2.8 6.6C18.5 18 16 21 12 21z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, className = 'icon'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = PATHS[name];
  return svg;
}

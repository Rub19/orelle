// Renderer-side access to the preload API and shared helpers.
import type { NovaApi } from '../../preload/preload';
import { createTranslator, type Translator } from '../../shared/i18n';

declare global {
  interface Window {
    nova: NovaApi;
    __novaTestQuery?: (q: string) => void;
  }
}

export const nova = window.nova;

export let t: Translator = createTranslator('fr');
export function setLanguage(lang: 'fr' | 'en') {
  t = createTranslator(lang);
  document.documentElement.lang = lang;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string | number | boolean | EventListener>> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') node.className = String(v);
    else if (k === 'html') node.innerHTML = String(v);
    else if (k === 'text') node.textContent = String(v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

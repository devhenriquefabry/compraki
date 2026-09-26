/**
 * Carrega o Leaflet (CSS + JS da unpkg) só quando um mapa vai ser montado.
 *
 * Antes ele ficava no <head> do index.html: um script síncrono de outro domínio
 * que atrasava a primeira pintura de TODA abertura do site, só para servir o
 * mapa de usuários do admin.
 */
const VERSION = '1.9.4';
const CSS_SRI = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
const JS_SRI = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';

let loading: Promise<any> | null = null;

export function loadLeaflet(): Promise<any> {
  const w = window as any;
  if (w.L) return Promise.resolve(w.L);
  if (loading) return loading;

  loading = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `https://unpkg.com/leaflet@${VERSION}/dist/leaflet.css`;
    css.integrity = CSS_SRI;
    css.crossOrigin = '';
    document.head.appendChild(css);

    const js = document.createElement('script');
    js.src = `https://unpkg.com/leaflet@${VERSION}/dist/leaflet.js`;
    js.integrity = JS_SRI;
    js.crossOrigin = '';
    js.onload = () => resolve(w.L);
    js.onerror = () => { loading = null; reject(new Error('Falha ao carregar o Leaflet')); };
    document.head.appendChild(js);
  });
  return loading;
}

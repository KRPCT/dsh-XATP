/** Executed by Chromium in an isolated world. Reads rendered semantics without dispatching page events. */
export function inspectElement() {
  if (!(this instanceof Element) || !this.isConnected) return null;
  if (this.closest('[inert]') || this.matches('input[type=password i],input[type=file i],input[type=hidden i]')) return null;
  const form = this.form || this.closest('form');
  const anchor = this.closest('a[href]');
  const href = anchor && !anchor.search && !anchor.hash && !anchor.username && !anchor.password ? anchor.href : null;
  return {
    disabled: this.matches(':disabled') || Boolean(this.closest('[aria-disabled=true i]')),
    form: form ? {id: form.id, name: form.getAttribute('name') || '', method: form.method} : null,
    href,
  };
}

/** Runs only for a registered page operation. Includes rendered media and article links in the main document. */
export function readPageItems(operation, origins) {
  const entries = [];
  const media = [];
  let truncated = false;
  let examined = 0;
  const elements = document.querySelectorAll(operation === 'collect_assets' ? 'video,audio,img,a[href]' : 'a[href]');
  for (const element of elements) {
    if (++examined > 4000 || entries.length + media.length >= 500) { truncated = true; break; }
    if (!element.checkVisibility({opacityProperty:true, visibilityProperty:true}) || !element.getClientRects().length) continue;
    const kind = element.localName;
    const raw = kind === 'a' ? element.href : element.currentSrc || element.src;
    if (!raw) continue;
    let url;
    try { url = new URL(raw, document.baseURI); } catch { continue; }
    if (!origins.includes(url.origin)) continue;
    if (kind === 'video' || kind === 'audio') {
      const duration = element.duration;
      media.push({kind, hostname:url.hostname, duration:Number.isFinite(duration) ? duration : null,
        readyState:element.readyState, width:element.videoWidth || null, height:element.videoHeight || null});
    }
    // Never return signed or parameterized candidates, even as labels or unusable stripped locations.
    if (url.search || url.hash || url.username || url.password || !['https:', 'http:'].includes(url.protocol)) continue;
    if (operation === 'collect_assets' && kind === 'a' && !/\.(mp4|webm|mov|mp3|wav|ogg|png|jpe?g|webp|gif|avif)$/i.test(url.pathname)) continue;
    entries.push({kind, name: (element.getAttribute('aria-label') || element.getAttribute('alt') || element.getAttribute('title') || (kind === 'a' ? element.innerText : '') || '').slice(0, 200), url:url.href});
  }
  return {entries, media, truncated};
}

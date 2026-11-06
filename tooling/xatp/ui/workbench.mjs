import { mountCanvas } from './canvas.mjs';
import { mountBrowser } from './browser.mjs';
import { elements } from './dom.mjs';
import { promptEditor } from './prompt.mjs';
import { recordGraph } from './graph.mjs';
import { translator } from './locale.mjs';

const VIEWS = ['shots', 'flow', 'browser', 'assets'];
const KINDS = ['query', 'source', 'claim', 'concept', 'prompt', 'draft', 'run', 'asset', 'shot'];
const ASSET_KINDS = new Set(['asset', 'draft', 'concept', 'prompt']);
const PREVIEW_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif', 'image/svg+xml', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/ogg']);
const PAGE_SIZE = 24;

function needsReview(record) {
  return record.stale || record.data?.reviewStatus === 'needs-review';
}

function belongs(record, view) {
  return view === 'flow' || (view === 'shots' && record.kind === 'shot') || (view === 'assets' && ASSET_KINDS.has(record.kind));
}

/**
 * Mount an isolated inspector. Load workbench.css into the sheet scope containing root.
 * @param {HTMLElement} root Host-owned container.
 * @param {object} api Host actions read, listTabs, discover, inspect and optional same-origin previewURL.
 * @returns {{refresh: () => Promise<void>, destroy: () => void}} Lifecycle handle for the host.
 */
export function mountWorkbench(root, api) {
  return mountCanvas(root, api, mountRecords);
}

function mountRecords(root, api, initialView = 'shots') {
  const doc = root.ownerDocument;
  const t = translator(api.locale ?? doc.documentElement.lang ?? 'en');
  const ui = elements(doc);
  const { el, button, search, heading } = ui;
  const frame = el('section', 'x-workbench');
  if (['light', 'dark'].includes(api.theme)) frame.dataset.theme = api.theme;
  frame.setAttribute('aria-label', t('workbench'));
  const head = el('header', 'x-head');
  const identity = el('div', 'x-identity');
  const name = el('h1', '', t('workbench'));
  const badge = el('span', 'x-badge', t('demo'));
  badge.hidden = true;
  identity.append(el('span', 'x-wordmark', 'XATP'), name, badge);
  const reload = button(t('reload'), refresh);
  head.append(identity, reload);
  const nav = el('nav', 'x-nav');
  nav.setAttribute('aria-label', t('workbench'));
  const notice = el('div', 'x-live');
  notice.setAttribute('aria-live', 'polite');
  const body = el('div', 'x-grid');
  frame.append(head, nav, notice, body);
  root.replaceChildren(frame);

  let graph = recordGraph([]);
  let data;
  let view = initialView;
  let selected;
  let query = '';
  let kind = '';
  let page = 0;
  let history = [];
  let cursor = -1;
  let stopBrowser;
  let readToken = 0;
  let destroyed = false;

  const editPrompt = promptEditor(ui, t, api, async (before, saved) => {
    if (destroyed) return;
    await refresh();
    if (destroyed || view === 'browser' || !selected || graph.keyOf(selected) !== graph.keyOf(before)) return;
    const next = saved && graph.byVersion.get(graph.keyOf(saved));
    if (next) openRecord(next);
    else notice.textContent = t('savedRefresh');
  });

  for (const key of VIEWS) {
    const tab = button(t(key), () => {
      if (view === key) return;
      view = key;
      query = kind = '';
      page = 0;
      selected = undefined;
      history = [];
      cursor = -1;
      render();
    }, 'x-nav-item');
    tab.dataset.view = key;
    tab.addEventListener('keydown', (event) => {
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const index = VIEWS.indexOf(key);
      const destination = event.key === 'Home' ? 0 : event.key === 'End' ? VIEWS.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + VIEWS.length) % VIEWS.length;
      nav.children[destination].focus();
      nav.children[destination].click();
    });
    nav.append(tab);
  }

  function mediaURL(record) {
    if (!api.previewURL || !record || !PREVIEW_TYPES.has(record.data?.mime) || !/^[a-f0-9]{64}$/i.test(record.data?.blob ?? '')) return;
    const value = api.previewURL(record.data.blob);
    if (!value) return;
    const url = new URL(value, doc.baseURI);
    if (url.origin === doc.location.origin && /^https?:$/.test(url.protocol)) return url.href;
    // In a file-opened offline review the host may construct an object URL from embedded, hash-indexed bytes.
    if (url.protocol === 'blob:' && (url.origin === doc.location.origin ||
      (doc.location.protocol === 'file:' && url.origin === 'null'))) return url.href;
  }

  function openRecord(record, remember = true, keepFilter = false) {
    if (!record?.kind) return;
    if (remember) {
      history = history.slice(0, cursor + 1);
      if (history.at(-1)?.key !== graph.keyOf(record)) {
        history.push({ key: graph.keyOf(record), view: belongs(record, view) ? view : 'flow' });
        cursor = history.length - 1;
      }
    }
    if (!belongs(record, view)) view = 'flow';
    selected = record;
    if (!keepFilter) {
      query = kind = '';
      const matching = [...graph.latest.values()].filter((r) => belongs(r, view));
      page = Math.max(0, Math.floor(matching.findIndex((r) => r.id === record.id) / PAGE_SIZE));
    }
    render();
    body.querySelector('.x-title')?.focus();
  }

  function moveHistory(offset) {
    const entry = history[cursor + offset];
    if (entry && graph.byVersion.has(entry.key)) {
      cursor += offset;
      view = entry.view;
      openRecord(graph.byVersion.get(entry.key), false);
    }
  }

  function reference(record) {
    const row = button('', () => openRecord(record), 'x-ref');
    row.disabled = !record.kind;
    row.append(el('span', 'x-ref-kind', t(record.kind || 'missing')), el('span', 'x-ref-title', record.title || record.id), el('span', 'x-version', 'v' + record.version));
    if (needsReview(record)) row.append(el('span', 'x-stale', t('stale')));
    return row;
  }

  function related(label, records, empty) {
    const section = el('section', 'x-links');
    section.append(heading(t(label), records.length));
    if (!records.length) section.append(el('p', 'x-empty-inline', t(empty)));
    else for (const record of records) section.append(reference(record));
    return section;
  }

  function renderInspector(panel) {
    panel.replaceChildren();
    if (!selected) {
      panel.append(el('p', 'x-empty', t('inspectRecord')));
      return;
    }
    const record = selected;
    const bar = el('div', 'x-detail-head');
    const info = el('div', 'x-kicker');
    info.append(el('span', '', t(record.kind)), el('span', 'x-version', 'v' + record.version));
    if (record.kind === 'shot' && Number.isSafeInteger(record.data.startMs) && Number.isSafeInteger(record.data.endMs)) {
      const time = (ms) => String(Math.floor(ms / 60000)).padStart(2, '0') + ':' +
        String(Math.floor(ms / 1000) % 60).padStart(2, '0') + '.' + String(ms % 1000).padStart(3, '0');
      info.append(el('span', 'x-timecode', time(record.data.startMs) + ' – ' + time(record.data.endMs)));
    }
    if (record.kind === 'run' && record.data.status) info.append(el('span', 'x-badge', t(record.data.status)));
    if (needsReview(record)) info.append(el('span', 'x-stale', t('stale')));
    if (graph.latest.get(record.id) !== record) info.append(el('span', 'x-badge', t('historic')));
    const undo = button('←', () => moveHistory(-1), 'x-btn x-icon');
    const redo = button('→', () => moveHistory(1), 'x-btn x-icon');
    for (const [control, key, disabled] of [[undo, 'back', cursor < 1], [redo, 'forward', cursor >= history.length - 1]]) {
      control.setAttribute('aria-label', t(key));
      control.title = t(key);
      control.disabled = disabled;
    }
    const actions = el('div', 'x-actions');
    actions.append(undo, redo);
    bar.append(info, actions);
    const title = el('h3', 'x-title', record.title || record.id);
    title.tabIndex = -1;
    panel.append(bar, title);

    if (view === 'flow') {
      const canvas = el('section', 'x-canvas');
      canvas.setAttribute('aria-label', t('relationships'));
      const incoming = graph.inputs(record);
      const outgoing = graph.uses(record);
      for (const [label, nodes] of [['upstream', incoming], [null, [record]], ['downstream', outgoing]]) {
        const column = el('div', 'x-branch');
        column.append(el('span', 'x-branch-label', t(label || 'focus')));
        if (!nodes.length) column.append(el('span', 'x-node x-null', '—'));
        for (const item of nodes.slice(0, 3)) {
          const node = label ? button('', () => openRecord(item), 'x-node') : el('div', 'x-node x-node-focus');
          if (label && !item.kind) node.disabled = true;
          node.append(el('small', '', t(item.kind || 'missing') + ' · v' + item.version + (needsReview(item) ? ' · ' + t('stale') : '')), el('span', '', item.title || item.id));
          column.append(node);
        }
        if (nodes.length > 3) column.append(el('small', 'x-overflow', '+' + (nodes.length - 3)));
        canvas.append(column);
      }
      panel.append(canvas);
    }
    const preview = mediaURL(record) ? record : graph.walk(record, graph.inputs, (r) => Boolean(mediaURL(r)), true)[0];
    if (preview && view !== 'flow') {
      const figure = el('figure', 'x-preview');
      const type = preview.data.mime.split('/')[0];
      const media = el(type === 'image' ? 'img' : type);
      if (type === 'image') media.alt = preview.title || preview.id;
      else {
        media.controls = true;
        media.preload = 'metadata';
        media.setAttribute('aria-label', preview.title || preview.id);
        if (type === 'video') {
          const draft = graph.walk(preview, graph.inputs, (r) => r.kind === 'draft' && r.data?.mime === 'image/svg+xml' && Boolean(mediaURL(r)), true)[0];
          if (draft) media.poster = mediaURL(draft);
        }
      }
      media.addEventListener('error', () => media.replaceWith(el('p', 'x-empty-inline', t('unavailable'))), { once: true });
      media.src = mediaURL(preview);
      figure.append(media);
      if (preview !== record) {
        const caption = el('figcaption');
        caption.append(button(t(preview.kind) + ' · ' + (preview.title || preview.id) + ' · v' + preview.version, () => openRecord(preview), 'x-caption-link'));
        figure.append(caption);
      }
      panel.append(figure);
    }

    const descriptionKey = ['description', 'summary', 'question', 'statement', 'citation', 'text', 'promptText', 'dataBasis', 'rationale', 'method', 'notes'].find((k) => typeof record.data?.[k] === 'string' && record.data[k].trim());
    if (descriptionKey) panel.append(el('p', 'x-description', record.data[descriptionKey]));
    if (record.kind === 'source' && typeof record.data.doi === 'string' && /^10\.\d{4,9}\/\S+$/i.test(record.data.doi)) {
      const link = el('a', 'x-doi', 'DOI ' + record.data.doi);
      link.href = 'https://doi.org/' + record.data.doi.split('/').map(encodeURIComponent).join('/');
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      panel.append(link);
    }
    editPrompt(panel, record, graph.latest.get(record.id));
    const versions = graph.revisions.get(record.id);
    if (versions.length > 1) {
      const label = el('label', 'x-version-select', t('version'));
      const selector = el('select', 'x-input');
      for (const rev of [...versions].sort((a, b) => b.version - a.version)) {
        const option = el('option', '', 'v' + rev.version + (needsReview(rev) ? ' · ' + t('stale') : ''));
        option.value = graph.keyOf(rev);
        option.selected = rev === record;
        selector.append(option);
      }
      selector.addEventListener('change', () => openRecord(graph.byVersion.get(selector.value)));
      label.append(selector);
      panel.append(label);
    }
    const links = el('div', 'x-relations');
    links.setAttribute('aria-label', t('relationships'));
    links.append(related('upstream', graph.inputs(record), 'noInputs'), related('downstream', graph.uses(record), 'noUses'));
    panel.append(links);
    const queries = graph.walk(record, graph.inputs, (r) => r.kind === 'query');
    const shots = graph.walk(record, graph.uses, (r) => r.kind === 'shot');
    if (queries.length) panel.append(related('originalQueries', queries));
    if (shots.length) panel.append(related('affectedShots', shots));
    if (record.kind === 'prompt' && versions.length > 1 && record === graph.latest.get(record.id)) {
      const impacted = new Map();
      for (const earlier of versions.filter((r) => r !== record)) {
        const dependents = graph.walk(earlier, graph.uses, (r) => r.stale && r === graph.latest.get(r.id));
        for (const dependent of dependents) impacted.set(graph.keyOf(dependent), dependent);
      }
      if (impacted.size) panel.append(related('oldVersionUsers', [...impacted.values()]));
    }

    const meta = el('details', 'x-limits');
    meta.append(el('summary', '', t('recordData')));
    const fields = el('dl', 'x-fields');
    fields.append(el('dt', '', 'ID'), el('dd', '', record.id));
    for (const [key, value] of Object.entries(record.data ?? {})) {
      if (key === descriptionKey || value == null) continue;
      const formatted = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
      fields.append(el('dt', '', t(key === 'blob' ? 'hash' : key)), el('dd', '', ['status','reviewStatus'].includes(key) && typeof value === 'string' ? t(value) : formatted));
    }
    meta.append(fields);
    panel.append(meta);
  }

  function renderRecords() {
    const directory = el('section', 'x-directory');
    const panel = el('section', 'x-inspector');
    const records = [...graph.latest.values()].filter((r) => belongs(r, view));
    if (!selected && records.length) {
      selected = records[0];
      history = [{ key: graph.keyOf(selected), view }];
      cursor = 0;
    }
    directory.append(heading(t(view), records.length));
    const list = el('div', 'x-list');
    const pager = el('div', 'x-pager');
    const input = search(t('searchRecords'), (value) => { query = value; page = 0; drawList(); });
    input.value = query;
    directory.append(input);
    if (view !== 'shots') {
      const select = el('select', 'x-input');
      select.setAttribute('aria-label', t('allKinds'));
      const first = el('option', '', t('allKinds'));
      first.value = '';
      select.append(first);
      for (const k of KINDS.filter((k) => records.some((r) => r.kind === k))) {
        const option = el('option', '', t(k));
        option.value = k;
        select.append(option);
      }
      select.value = kind;
      select.addEventListener('change', () => { kind = select.value; page = 0; drawList(); });
      directory.append(select);
    }
    function drawList() {
      const term = query.toLocaleLowerCase().trim();
      const filtered = records.filter((r) => (!kind || kind === r.kind) && [r.id, r.title, t(r.kind)].some((s) => String(s).toLocaleLowerCase().includes(term)));
      const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      page = Math.min(page, pages - 1);
      list.replaceChildren();
      pager.replaceChildren();
      if (!filtered.length) list.append(el('p', 'x-empty-inline', t(query || kind ? 'noMatches' : view === 'shots' ? 'noShots' : view === 'assets' ? 'noAssets' : 'noRecords')));
      const start = page * PAGE_SIZE;
      for (const [i, record] of filtered.slice(start, start + PAGE_SIZE).entries()) {
        const row = button('', () => openRecord(record, true, true), 'x-row');
        row.setAttribute('aria-pressed', String(record.id === selected?.id));
        const thumb = mediaURL(record);
        if (view === 'assets' && thumb && record.data.mime.startsWith('image/')) {
          const img = el('img', 'x-thumb');
          img.src = thumb;
          img.loading = 'lazy';
          img.alt = '';
          row.append(img);
        } else {
          row.append(el('span', 'x-number', String(start + i + 1).padStart(2, '0')));
        }
        const copy = el('span', 'x-row-copy');
        copy.append(el('span', '', record.title || record.id), el('small', '', t(record.kind) + ' · v' + record.version + (needsReview(record) ? ' · ' + t('stale') : '')));
        row.append(copy);
        list.append(row);
      }
      if (pages > 1) {
        const prev = button(t('previous'), () => { page--; drawList(); pager.querySelector('button:not(:disabled)')?.focus(); });
        const next = button(t('next'), () => { page++; drawList(); pager.querySelector('button:not(:disabled)')?.focus(); });
        prev.disabled = page === 0;
        next.disabled = page + 1 >= pages;
        pager.append(prev, el('span', 'x-meta', (page + 1) + ' / ' + pages), next);
      }
    }
    directory.append(list, pager);
    body.append(directory, panel);
    drawList();
    renderInspector(panel);
  }

  function render() {
    stopBrowser?.();
    stopBrowser = undefined;
    body.replaceChildren();
    body.dataset.view = view;
    for (const tab of nav.children) {
      if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
    if (view === 'browser') stopBrowser = mountBrowser(body, api, t, ui);
    else if (data) renderRecords();
  }

  async function refresh() {
    if (destroyed) return;
    const token = ++readToken;
    reload.disabled = true;
    notice.textContent = t('loading');
    try {
      const snapshot = await api.read();
      if (token !== readToken || destroyed) return;
      const nextGraph = recordGraph(snapshot.records);
      selected = selected && nextGraph.byVersion.get(graph.keyOf(selected));
      graph = nextGraph;
      data = snapshot;
      name.textContent = snapshot.project.title || t('workbench');
      badge.hidden = snapshot.mode !== 'demo';
      notice.replaceChildren();
      render();
    } catch (error) {
      if (token !== readToken || destroyed) return;
      notice.textContent = t('loadError') + ' · ' + (error.message || String(error));
    } finally {
      if (token === readToken && !destroyed) reload.disabled = false;
    }
  }
  render();
  void refresh();
  return { refresh, destroy() { destroyed = true; readToken++; stopBrowser?.(); frame.remove(); } };
}

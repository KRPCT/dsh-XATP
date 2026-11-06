const READ_OPERATIONS = new Set(['inspect', 'read_link', 'collect_assets', 'collect_citations']);

/** Mount the page tool directory. Leaving a page invalidates pending results and document bindings. */
export function mountBrowser(root, api, t, { el, button, search, heading }) {
  const controls = el('section', 'x-directory');
  const inspector = el('section', 'x-inspector');
  inspector.setAttribute('aria-label', t('tools'));
  root.append(controls, inspector);
  let tabs = [];
  let tab;
  let catalog;
  let selected;
  let epoch = 0;
  let disposed = false;
  let searchText = '';
  const displayName = (tool) => tool.name || t(tool.role) || tool.toolId;
  const current = (request) => !disposed && request === epoch;

  function notice(container, title, error) {
    const notice = el('div', 'x-notice');
    notice.setAttribute('role', error ? 'alert' : 'status');
    notice.append(el('p', '', title));
    if (error) notice.append(el('p', 'x-meta', error.message || String(error)));
    container.append(notice);
  }

  function controlsForTab() {
    controls.replaceChildren(heading(t('tabs'), tabs.length));
    const chooser = el('select', 'x-input');
    chooser.setAttribute('aria-label', t('tabs'));
    chooser.append(el('option', '', t('selectTab')));
    chooser.options[0].value = '';
    for (const [i, item] of tabs.entries()) {
      const surface = item.surface === 'dsh_web_iframe' ? t('embeddedTab') + ' · ' : '';
      const option = el('option', '', surface + item.providerId + ' · ' + item.url);
      option.value = String(i);
      chooser.append(option);
      option.selected = tab === item;
    }
    chooser.disabled = !tabs.length;
    chooser.addEventListener('change', () => {
      epoch++;
      tab = chooser.value === '' ? undefined : tabs[Number(chooser.value)];
      catalog = selected = undefined;
      searchText = '';
      controlsForTab();
      inspector.replaceChildren();
    });
    controls.append(chooser);
    const actions = el('div', 'x-actions');
    const scan = button(t('scan'), () => discover(), 'x-btn x-primary');
    scan.disabled = !tab || !api.discover;
    const reload = button(t('reload'), listTabs);
    reload.disabled = !api.listTabs;
    actions.append(scan, reload);
    controls.append(actions);
  }

  function renderDetail() {
    inspector.replaceChildren();
    if (!selected) return notice(inspector, t('chooseTool'));
    const tool = selected;
    const info = el('div', 'x-kicker');
    info.append(el('span', '', t(tool.role)), el('span', 'x-badge', t(tool.disabled ? 'disabled' : 'readonly')));
    inspector.append(info, el('h3', 'x-title', displayName(tool)));
    const facts = el('dl', 'x-fields');
    for (const [key, value] of [['adapter', catalog.providerId], ['page', catalog.url], ['form', tool.form && [tool.form.name || tool.form.id, tool.form.method].filter(Boolean).join(' · ')]]) {
      if (value) facts.append(el('dt', '', t(key)), el('dd', '', value));
    }
    inspector.append(facts, heading(t('allowed')));
    const actions = el('div', 'x-actions');
    inspector.append(actions);
    const output = el('div', 'x-output');
    output.setAttribute('aria-live', 'polite');
    inspector.append(output);
    if (api.bindEditor && catalog.providerId === 'updream' && tool.operations?.includes('prepare_prompt') && !tool.disabled) {
      actions.append(button('绑定到当前节点', () => api.bindEditor({tabId:catalog.tabId, documentId:catalog.documentId, toolId:tool.toolId, surface:tool.surface}), 'x-btn x-primary'));
    }
    if (catalog.providerId === 'updream' && tool.surface === 'video_settings' && !tool.disabled) {
      const ref = {tabId:catalog.tabId,documentId:catalog.documentId,toolId:tool.toolId};
      const settings = async (method,mode) => {
        const request = ++epoch;
        for (const control of actions.querySelectorAll('button,select')) control.disabled = true;
        try {
          const result = await api.workflow[method](ref,...(mode ? [mode] : []));
          if (!current(request)) return;
          output.replaceChildren();
          if (mode) {
            if (result.mode !== mode || result.model !== 'MiniMax H3') throw new Error('站内模式读回不一致');
            tool.h3Modes.selected = result.mode;
            output.append(el('p','','站内已选 · '+result.mode));
          } else if (Number.isFinite(result.displayedCredits)) {
            output.append(el('p','',result.model+' · '+result.seconds+'s / '+result.resolution+' · '+result.displayedCredits+' 积分'));
            api.onSiteQuote?.(result,ref);
          } else output.append(el('p','','已选择 '+result.model));
        } catch(error) {
          if (!current(request)) return;
          catalog = selected = undefined;
          controlsForTab();
          inspector.replaceChildren();
          notice(inspector,t('inspectFailed'),error);
        } finally {
          if (current(request)) for (const control of actions.querySelectorAll('button,select')) control.disabled = false;
        }
      };
      for (const [op,method,label] of [
        ['select_h3','selectH3','选择 MiniMax H3'], ['inspect_h3_quote','quoteH3','读取站内报价'],
        ['configure_h3_minimum','configureH3Minimum','设置 5 秒 / 768P'],
      ]) {
        if (!api.workflow?.[method] || !tool.operations?.includes(op)) continue;
        actions.append(button(label,() => settings(method),'x-btn'));
      }
      const modes = tool.h3Modes;
      if (catalog.documentId && api.workflow?.selectH3Mode && tool.operations?.includes('select_h3_mode') &&
          Array.isArray(modes?.available) && modes.available.includes(modes.selected)) {
        const label = el('label','','站内模式 ');
        const mode = el('select','x-input');
        for (const name of modes.available) {
          const option = el('option','',name);
          option.value = name;
          mode.append(option);
        }
        mode.value = modes.selected;
        mode.addEventListener('change',() => settings('selectH3Mode',mode.value));
        label.append(mode);
        actions.append(label);
      }
    }
    const operations = (tool.operations ?? []).filter((op) => READ_OPERATIONS.has(op));
    if (!operations.length && !actions.children.length) notice(actions, t('noAllowed'));
    for (const operation of operations) {
      const run = button(t(operation), async () => {
        const request = ++epoch;
        const binding = { tabId: catalog.tabId, providerId: catalog.providerId, documentId: catalog.documentId, toolId: tool.toolId, operation };
        for (const action of actions.querySelectorAll('button')) action.disabled = true;
        output.replaceChildren();
        notice(output, t('reading'));
        try {
          const result = await api.inspect(binding);
          if (!current(request)) return;
          output.replaceChildren(heading(t('result')));
          if (Array.isArray(result?.items)) {
            if (!result.items.length) notice(output, t('noResults'));
            const list = el('ul', 'x-results');
            for (const item of result.items) {
              const row = el('li');
              row.append(el('span', '', item.name || item.kind), el('code', '', item.url));
              list.append(row);
            }
            output.append(list);
            if (result.media?.length) {
              const media = el('details', 'x-limits');
              media.append(el('summary', '', t('media') + ' · ' + result.media.length), el('pre', 'x-code', JSON.stringify(result.media, null, 2)));
              output.append(media);
            }
            if (result.truncated) notice(output, t('truncated'));
          } else {
            output.append(el('pre', 'x-code', JSON.stringify(result, null, 2)));
          }
          for (const action of actions.querySelectorAll('button')) action.disabled = Boolean(tool.disabled && action.dataset.operation !== 'inspect');
        } catch (error) {
          if (!current(request)) return;
          // A stale binding or disconnected page requires fresh discovery before another read.
          catalog = selected = undefined;
          controlsForTab();
          inspector.replaceChildren();
          notice(inspector, t('inspectFailed'), error);
        }
      });
      run.disabled = (tool.disabled && operation !== 'inspect') || !api.inspect || !catalog.documentId;
      run.dataset.operation = operation;
      actions.append(run);
    }
  }

  function showCatalog() {
    controlsForTab();
    controls.append(heading(t('tools'), catalog.tools.length));
    const input = search(t('findTool'), (value) => { searchText = value; renderList(); });
    input.value = searchText;
    const list = el('div', 'x-list');
    controls.append(input, list);
    function renderList() {
      const query = searchText.toLocaleLowerCase().trim();
      const tools = catalog.tools.filter((tool) => [tool.name, tool.role, tool.toolId, tool.form?.name].some((s) => String(s ?? '').toLocaleLowerCase().includes(query)));
      list.replaceChildren();
      if (!tools.length) notice(list, t(query ? 'noToolsMatch' : 'noTools'));
      for (const tool of tools) {
        const row = button('', () => {
          epoch++;
          selected = tool;
          renderList();
          renderDetail();
          inspector.querySelector('h3')?.setAttribute('tabindex', '-1');
          inspector.querySelector('h3')?.focus();
        }, 'x-row');
        row.setAttribute('aria-pressed', String(selected === tool));
        const label = el('span', 'x-row-copy');
        label.append(el('span', '', displayName(tool)), el('small', '', t(tool.role) + ' · ' + t(tool.disabled ? 'disabled' : 'available')));
        row.append(label);
        list.append(row);
      }
    }
    renderList();
    if (catalog.nextCursor) controls.append(button(t('moreTools'), () => discover(catalog)));
    if (catalog.unsupported && Object.keys(catalog.unsupported).length) {
      const limits = el('details', 'x-limits');
      const facts = el('dl', 'x-fields');
      for (const [key, value] of Object.entries(catalog.unsupported)) facts.append(el('dt', '', t(key)), el('dd', '', value));
      limits.append(el('summary', '', t('limits')), facts);
      controls.append(limits);
    }
    renderDetail();
  }

  function showObservation() {
    const evidence = api.observation;
    const report = evidence?.updream_node_cdp;
    if (!report) return;
    const section = el('section', 'x-observation');
    section.append(heading(t('publicObservation')));
    const facts = el('dl', 'x-fields');
    const media = report.collect_assets_after_preview?.media?.[0];
    const name = evidence.updream_cloud_browser?.matched_button;
    for (const [label, value] of [
      ['observedOn', evidence.observed_on], ['title', name],
      ['duration', Number.isFinite(media?.duration) ? media.duration.toFixed(2) + ' s' : ''],
      ['dimensions', media?.width && media?.height ? media.width + ' × ' + media.height : ''],
    ]) {
      if (value) facts.append(el('dt', '', t(label)), el('dd', '', value));
    }
    section.append(facts);
    const names = report.sample_discovered_button_names?.slice(0, 5) ?? [];
    if (names.length) {
      section.append(heading(t('observedControls')));
      const list = el('ul', 'x-observed-list');
      for (const label of names) list.append(el('li', '', label));
      section.append(list);
    }
    if (URL.canParse(evidence.public_page)) {
      const url = new URL(evidence.public_page);
      if (url.protocol === 'https:' && !url.username && !url.password) {
        const link = el('a', 'x-doi', t('openExample') + ' ↗');
        link.href = url.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = url.href;
        section.append(link);
      }
    }
    inspector.append(section);
  }

  async function listTabs() {
    const request = ++epoch;
    tab = catalog = selected = undefined;
    tabs = [];
    inspector.replaceChildren();
    controlsForTab();
    if (!api.listTabs) {
      notice(inspector, t(root.ownerDocument.location.protocol === 'file:' ? 'offlineBrowser' : 'disconnected'));
      showObservation();
      return;
    }
    notice(inspector, t('reading'));
    try {
      const result = await api.listTabs();
      if (!current(request)) return;
      tabs = result;
      if (tabs.length === 1) tab = tabs[0];
      controlsForTab();
      inspector.replaceChildren();
      if (!tabs.length) notice(inspector, t('noTabs'));
    } catch (error) {
      if (!current(request)) return;
      inspector.replaceChildren();
      notice(inspector, t('listFailed'), error);
    }
  }
  async function discover(previous) {
    const request = ++epoch;
    catalog = selected = undefined;
    controlsForTab();
    inspector.replaceChildren();
    notice(inspector, t('scanning'));
    try {
      const result = await api.discover({ tabId: tab.tabId, providerId: tab.providerId, ...(previous ? {cursor:previous.nextCursor} : {}) });
      if (!current(request)) return;
      if (result.tabId !== tab.tabId || result.providerId !== tab.providerId || !result.documentId || !Array.isArray(result.tools)) {
        throw new Error(t('unavailable'));
      }
      if (previous && result.documentId !== previous.documentId) throw new Error(t('unavailable'));
      if (previous) {
        const unsupported = {...result.unsupported};
        for (const key of ['omittedControls','unmappedControls']) {
          unsupported[key] = (previous.unsupported?.[key] || 0) + (result.unsupported?.[key] || 0);
        }
        catalog = {...result, tools:[...previous.tools,...result.tools], unsupported};
      } else {
        catalog = result;
      }
      showCatalog();
    } catch (error) {
      if (!current(request)) return;
      inspector.replaceChildren();
      notice(inspector, t('discoverFailed'), error);
    }
  }
  void listTabs();
  return () => { disposed = true; epoch++; };
}

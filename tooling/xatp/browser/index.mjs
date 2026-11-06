/** Read-only browser semantics for explicitly enrolled pages. Requires Node 24 and loopback Chromium CDP. */
import {createHash} from 'node:crypto';
import {AdapterError, localEndpoint, targets, withPage} from './cdp.mjs';
import {inspectElement, readPageItems} from './page.mjs';

const operations = ['inspect', 'read_link', 'collect_assets', 'collect_citations'];
const interactive = new Set('button link textbox searchbox combobox listbox option checkbox radio switch slider spinbutton tab menuitem menuitemcheckbox menuitemradio treeitem disclosuretriangle'.split(' '));

/** Origin and operation policy supplied by the host, outside the agent's tool inputs. */
export const DEFAULT_PROVIDERS = [
  {id:'updream', origins:['https://updream.cn','https://www.updream.cn'], capabilities:['inspect','read_link','collect_assets'],resourceOrigins:['https://boss-shjd.biliapi.net']},
  {id:'leapspace', origins:['https://www.sciencedirect.com'],pathPrefix:'/leapspace', capabilities:['inspect','read_link','collect_citations'],
    resourceOrigins:['https://doi.org','https://www.sciencedirect.com','https://linkinghub.elsevier.com','https://pubmed.ncbi.nlm.nih.gov']},
];

function publicOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:') localEndpoint(value);
  if (url.origin !== value) throw new AdapterError('invalid_origin', 'Use exact provider origins without paths or credentials.');
  return url.origin;
}

function hash(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

function label(text) {
  // Accessible labels sometimes repeat the complete destination. Suppress URL queries and bearer-like strings.
  return String(text || '').replace(/\S*[?#]\S*|\S*(?:token|secret|authorization|signature|credential)\s*[:=]\s*\S+|\bBearer\s+\S+|\bhttps?:\/\/\S*@\S*/gi, '[redacted]').slice(0, 200);
}

function safeLink(raw, allowed) {
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.search || url.hash || url.username || url.password || !allowed.has(url.origin)
    || !['https:', 'http:'].includes(url.protocol)) return null;
  return url.href;
}

function citation(raw) {
  const {hostname, pathname} = new URL(raw);
  if (hostname === 'doi.org') return /^\/10\.\d{4,9}\/[^/].+/i.test(pathname);
  if (hostname === 'www.sciencedirect.com') return /^\/science\/article\/pii\/[a-z0-9]+\/?$/i.test(pathname);
  if (hostname === 'linkinghub.elsevier.com') return /^\/retrieve\/pii\/[a-z0-9]+\/?$/i.test(pathname);
  return hostname === 'pubmed.ncbi.nlm.nih.gov' && /^\/\d+\/?$/.test(pathname);
}

function pageUrl(raw, policy) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (!policy.origins.has(url.origin) || url.username || url.password) return null;
  if (policy.pathPrefix && url.pathname !== policy.pathPrefix && !url.pathname.startsWith(policy.pathPrefix + '/')) return null;
  return url.origin + url.pathname;
}

function pageChanged() {
  return new AdapterError('stale_document', 'The selected document changed. Discover its tools again.');
}

const dshSandbox = 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox';

function isDshPage(raw, hostOrigin) {
  if (!hostOrigin) return false;
  try {
    const url = new URL(raw);
    return url.origin === hostOrigin && url.pathname === '/' && !url.search && !url.username && !url.password;
  } catch { return false; }
}

async function embeddedId(send, parent, child, policy, targetId) {
  if (!pageUrl(child.url,policy) || !child.loaderId || child.parentId !== parent.id) return null;
  const {backendNodeId} = await send('DOM.getFrameOwner',{frameId:child.id});
  const {node} = await send('DOM.describeNode',{backendNodeId,depth:0});
  if (node.localName !== 'iframe') return null;
  const attrs = new Map();
  for (let i=0; i<node.attributes.length; i+=2) attrs.set(node.attributes[i],node.attributes[i+1]);
  // IframePresentation sets this marker, policy and src on the exact DOM frame owner.
  if (attrs.get('data-sidebar-browser-frame') !== 'iframe' || attrs.get('referrerpolicy') !== 'no-referrer'
    || attrs.get('sandbox') !== dshSandbox || !pageUrl(attrs.get('src'),policy)) return null;
  const epoch = hash([parent.id,parent.loaderId,backendNodeId,attrs.get('src'),child.loaderId,child.url,child.urlFragment]);
  return targetId + '~' + child.id + '~' + epoch;
}

async function frameState(send, policy, tabId, hostOrigin) {
  const {frameTree:root} = await send('Page.getFrameTree');
  const [targetId,childId] = tabId.split('~');
  let frameTree = root;
  if (childId) {
    if (!isDshPage(root.frame.url,hostOrigin)) throw pageChanged();
    frameTree = root.childFrames?.find(child => child.frame.id === childId);
    if (!frameTree || await embeddedId(send,root.frame,frameTree.frame,policy,targetId) !== tabId) throw pageChanged();
  }
  const frame = frameTree.frame;
  const url = pageUrl(frame.url, policy);
  if (!url) throw new AdapterError('origin_mismatch', 'The selected page is outside the provider origins.');
  const documentId = hash([tabId, frame.id, frame.loaderId, frame.url, frame.urlFragment || '']);
  return {id:frame.id, documentId, url, childFrames:frameTree.childFrames?.length || 0};
}

async function currentTool(send, context, node, policy, tabId, documentId) {
  const {object} = await send('DOM.resolveNode', {backendNodeId:node.backendDOMNodeId, executionContextId:context});
  const result = await send('Runtime.callFunctionOn', {
    objectId:object.objectId, functionDeclaration:inspectElement.toString(), returnByValue:true,
  });
  if (result.exceptionDetails) throw pageChanged();
  const element = result.result.value;
  if (!element) return null;
  const role = node.role.value;
  const name = label(node.name?.value);
  const form = element.form ? {id:label(element.form.id),name:label(element.form.name),method:element.form.method} : null;
  const disabled = element.disabled || node.properties?.some(p => p.name === 'disabled' && p.value.value === true) || false;
  const url = safeLink(element.href, policy.allowed);
  const ops = [];
  if (policy.capabilities.has('inspect')) ops.push('inspect');
  if (role === 'link' && url && !disabled && policy.capabilities.has('read_link')) ops.push('read_link');
  const toolId = node.backendDOMNodeId + '.' + hash([tabId, documentId, node.backendDOMNodeId, role, name, disabled, form, url]);
  return {tool:{toolId, role, name, form, disabled, operations:ops}, url};
}

async function enumerate(send, frame, context, policy, tabId, cursor, requestedTool) {
  const {nodes} = await send('Accessibility.getFullAXTree', {frameId:frame.id});
  const candidates = nodes.filter(n => !n.ignored && n.backendDOMNodeId && n.role.value !== 'RootWebArea'
    && (interactive.has(n.role.value.toLowerCase()) || n.properties?.some(p => p.name === 'focusable' && p.value.value)));
  const pageSize = 200;
  // AX identity, order, labels, roles and disabled changes invalidate any remaining pages.
  const revision = hash([frame.documentId,policy.id,candidates.map(n => [
    n.backendDOMNodeId,n.role.value,n.name?.value,n.properties?.find(p => p.name === 'disabled')?.value.value,
  ])]);
  const at = offset => offset + '.' + hash([revision,offset]);
  let offset = 0;
  if (cursor !== undefined) {
    const match = typeof cursor === 'string' && /^(\d+)\.[0-9a-f]{32}$/.exec(cursor);
    offset = match ? Number(match[1]) : NaN;
    if (!Number.isSafeInteger(offset) || offset < pageSize || offset % pageSize !== 0
      || offset >= candidates.length || cursor !== at(offset)) {
      throw new AdapterError('stale_cursor', 'The page tool directory changed. Start discovery again.');
    }
  }
  let limited = candidates.slice(offset, offset + pageSize);
  if (requestedTool !== undefined) {
    const id = typeof requestedTool === 'string' && /^(\d+)\.[0-9a-f]{32}$/.exec(requestedTool);
    limited = id ? candidates.filter(n => n.backendDOMNodeId === Number(id[1])) : [];
  }
  const next = offset + pageSize;
  const nextCursor = next < candidates.length ? at(next) : null;
  const observed = [];
  // Keep each CDP batch bounded when a page exposes many controls.
  for (let i=0; i<limited.length; i+=20) {
    const group = await Promise.all(limited.slice(i, i+20).map(node => currentTool(send,context,node,policy,tabId,frame.documentId)));
    observed.push(...group.filter(Boolean));
  }
  const pageOperations = ['collect_assets','collect_citations'].filter(op => policy.capabilities.has(op));
  if (offset === 0 && pageOperations.length) observed.push({tool:{toolId:'page',role:'document',name:policy.id,disabled:false,form:null,operations:pageOperations}});
  return {
    observed, nextCursor,
    unsupported: {
      childFrames:frame.childFrames,
      canvasSurfaces:nodes.filter(n => !n.ignored && n.role.value === 'Canvas').length,
      unmappedControls:limited.filter(n => !interactive.has(n.role.value.toLowerCase())).length,
      omittedControls:limited.length - observed.filter(item => item.tool.toolId !== 'page').length,
    },
  };
}

/**
 * Register trusted browser origins once. Per-call arguments select a target, never a host, script, URL, or CSS selector.
 * @param {{endpoint:string,dshWebOrigin?:string,providers?:Array<{id:string,origins:string[],capabilities:string[],pathPrefix?:string,resourceOrigins?:string[]}>}} options Host configuration.
 * @returns List, discover, and invoke methods. Each call closes its CDP connection.
 */
export function createBrowserAdapter({endpoint, providers = DEFAULT_PROVIDERS, dshWebOrigin}) {
  const base = localEndpoint(endpoint);
  if (dshWebOrigin !== undefined) {
    const parsed = new URL(dshWebOrigin);
    if (!['http:','https:'].includes(parsed.protocol) || !['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)
      || parsed.origin !== dshWebOrigin) throw new AdapterError('invalid_dsh_origin','Use an exact loopback DSH origin without paths or credentials.');
  }
  const registry = new Map();
  const enrolledOrigins = new Set();
  for (const spec of providers) {
    if (!spec.id || registry.has(spec.id) || !spec.origins?.length || !Array.isArray(spec.capabilities)
      || spec.capabilities.some(op => !operations.includes(op))) throw new AdapterError('invalid_provider', 'Invalid provider configuration.');
    if (spec.pathPrefix != null && !/^\/(?:[a-z\d_-]+\/)*[a-z\d_-]+$/i.test(spec.pathPrefix)) {
      throw new AdapterError('invalid_provider', 'Use a literal path prefix with whole segments.');
    }
    const origins = new Set(spec.origins.map(publicOrigin));
    for (const origin of origins) {
      if (origin === dshWebOrigin) throw new AdapterError('invalid_dsh_origin','Keep the DSH and provider origins distinct.');
      if (enrolledOrigins.has(origin)) throw new AdapterError('invalid_provider', 'Each enrolled origin must select one provider.');
      enrolledOrigins.add(origin);
    }
    registry.set(spec.id, {id:spec.id, origins, pathPrefix:spec.pathPrefix, capabilities:new Set(spec.capabilities), allowed:new Set([...origins,...(spec.resourceOrigins || []).map(publicOrigin)])});
  }
  async function observe(request, invoking) {
    const policy = registry.get(request.providerId);
    if (!policy) throw new AdapterError('unknown_provider', 'Select a registered provider.');
    if (invoking && !policy.capabilities.has(request.operation)) throw new AdapterError('operation_blocked', 'This operation is outside the read-only provider policy.');
    const signal = AbortSignal.timeout(12000);
    if (typeof request.tabId !== 'string') throw new AdapterError('invalid_target','Invalid browser target.');
    const [targetId,childId] = request.tabId.split('~');
    const target = (await targets(base,signal)).find(t => t.id === targetId);
    if (!target) throw new AdapterError('target_missing', 'The selected tab closed. List browser tabs again.');
    if (childId ? !isDshPage(target.url,dshWebOrigin) : !pageUrl(target.url,policy)) throw new AdapterError('origin_mismatch', 'The selected target is outside the provider origins.');
    return withPage(base,target,signal,async send => {
      const frame = await frameState(send,policy,request.tabId,dshWebOrigin);
      if (invoking && request.documentId !== frame.documentId) throw pageChanged();
      const {executionContextId:context} = await send('Page.createIsolatedWorld', {frameId:frame.id,worldName:'xatp-observe'});
      const {observed, nextCursor, unsupported} = await enumerate(send,frame,context,policy,request.tabId,
        invoking ? undefined : request.cursor, invoking ? request.toolId : undefined);
      let result;
      if (!invoking) result = {tabId:request.tabId,providerId:policy.id,documentId:frame.documentId,url:frame.url,tools:observed.map(x => x.tool),nextCursor,unsupported};
      else {
        const match = observed.find(x => x.tool.toolId === request.toolId);
        if (!match) throw new AdapterError('stale_tool', 'The selected control changed. Discover its tools again.');
        if (!match.tool.operations.includes(request.operation)) throw new AdapterError('operation_blocked', 'This control does not expose that operation.');
        if (request.operation === 'inspect') result = match.tool;
        else if (request.operation === 'read_link') result = {url:match.url};
        else {
          const response = await send('Runtime.callFunctionOn', {executionContextId:context,functionDeclaration:readPageItems.toString(),arguments:[{value:request.operation},{value:[...policy.allowed]}],returnByValue:true});
          if (response.exceptionDetails) throw pageChanged();
          const {entries,media,truncated} = response.result.value;
          const seen = new Set();
          const items = [];
          for (const entry of entries) {
            const url = safeLink(entry.url,policy.allowed);
            if (!url || seen.has(url) || (request.operation === 'collect_citations' && !citation(url))) continue;
            seen.add(url);
            items.push({kind:request.operation === 'collect_citations' ? 'source_link' : entry.kind, name:label(entry.name),url});
          }
          result = request.operation === 'collect_assets' ? {items,media,truncated} : {items,truncated};
        }
      }
      if ((await frameState(send,policy,request.tabId,dshWebOrigin)).documentId !== frame.documentId) throw pageChanged();
      return result;
    });
  }
  return {
    async listTabs() {
      const result = [];
      const signal = AbortSignal.timeout(12000);
      for (const target of await targets(base,signal)) {
        for (const policy of registry.values()) {
          const url = pageUrl(target.url,policy);
          if (url) result.push({tabId:target.id,providerId:policy.id,url});
        }
        if (!isDshPage(target.url,dshWebOrigin)) continue;
        const nested = await withPage(base,target,signal,async send => {
          const {frameTree} = await send('Page.getFrameTree');
          const found = [];
          if (!isDshPage(frameTree.frame.url,dshWebOrigin)) return found;
          for (const child of frameTree.childFrames || []) {
            for (const policy of registry.values()) {
              const tabId = await embeddedId(send,frameTree.frame,child.frame,policy,target.id);
              if (tabId) found.push({tabId,providerId:policy.id,url:pageUrl(child.frame.url,policy),surface:'dsh_web_iframe'});
            }
          }
          return found;
        });
        result.push(...nested);
      }
      return result;
    },
    discover:request => observe(request,false),
    invoke:request => observe(request,true),
  };
}

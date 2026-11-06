/** DSH Host entry for one explicitly selected XATP production. */
import { resolve } from 'node:path';
import { readWorkspace, editPrompt, exportShot, readBlob } from '../workspace.mjs';
import { recordRocDraft } from '../roc-draft.mjs';
import { createWorkflowHost } from '../orchestration/host.mjs';
import { h3ModeControls } from '../updream/video-settings.mjs';
import { createBrowserAdapter } from '../browser/index.mjs';

export const inject = ['tools'];
const planField = {type:'object',properties:{nodes:{type:'array',items:{type:'object'}},edges:{type:'array',items:{type:'object'}},timeline:{type:'array',items:{type:'object'}}},required:['nodes','edges','timeline']};
const bindingField = {type:'object',properties:{tabId:{type:'string'},documentId:{type:'string'},toolId:{type:'string'}},required:['tabId','documentId','toolId'],additionalProperties:false};
const methods = {
  checkH3Draft: ['xatp_check_h3_draft','Read whether the bound MiniMax H3 video editor is empty, without returning its contents.',{binding:bindingField}],
  readNodeText: ['xatp_read_node_text','Read the selected Updream canvas text node through its discovered binding.',{binding:bindingField}],
  saveNodeText: ['xatp_save_node_text','Save plain text to the selected Updream text node only if the exact current text matches expectedText. Read back the saved node.',{binding:bindingField,text:'string',expectedText:'string'}],
  configureH3Minimum: ['xatp_configure_h3_minimum','Set a discovered MiniMax H3 control to its verified 5-second 768P minimum and read its quote without submitting.',{binding:bindingField}],
  selectH3Mode: ['xatp_select_h3_mode','Select one currently enabled mode on the bound H3 video node. Return its verified pressed state.',{
    binding:bindingField,mode:{type:'string',enum:Object.keys(h3ModeControls)},
  }],
  selectH3: ['xatp_select_h3','Select exactly MiniMax H3 in a discovered Updream model control. This only changes the draft settings.',{binding:bindingField}],
  quoteH3: ['xatp_quote_h3','Read the current displayed MiniMax H3 credit quote from a discovered Updream settings control.',{binding:bindingField}],
  orchestration_read: ['xatp_orchestration_read','Read the current workflow draft, revision and local receipts.',{}],
  orchestration_save: ['xatp_orchestration_save','Save the graph at the observed revision, including incomplete drafts.',{plan:planField,revision:'integer'}],
  orchestration_compile: ['xatp_orchestration_compile','Check the plan or the dependency slice ending at targetId.',{plan:{...planField,optional:true},targetId:'string?'}],
  orchestration_run: ['xatp_orchestration_run','Rehearse a graph or prepare one saved prompt in a selected Updream editor. Live mode requires a discovered editor binding. Generation is disabled.',{
    plan:{...planField,optional:true},targetId:'string?',mode:{type:'string',enum:['dry-run','live']},binding:{...bindingField,optional:true},
  }],
  read: ['xatp_read_workspace', 'Read the selected XATP project, records, versions, dependencies and stale flags.', {}],
  editPrompt: ['xatp_edit_prompt', 'Revise the text and creative rationale of an existing prompt at its expected version.', {id:'string',expectedVersion:'integer',text:'string',creativeRationale:'string'}],
  renderRocDraft: ['xatp_render_roc_draft', 'Save a deterministic teaching ROC SVG from 2–512 simulated [finite score, binary label] pairs including both classes. Supply the exact current prompt revision and expected draft version (0 creates a draft). No clinical inputs.', {
    id:'string',expectedVersion:'integer',promptId:'string',promptVersion:'integer',dataClass:{type:'string',enum:['simulated']},
    rows:{type:'array',items:{type:'array',items:{type:'number'}}},
  }],
  exportShot: ['xatp_export_shot', 'Return the verified shot manifest for an exact shot revision.', {id:'string', version:'integer'}],
  listTabs: ['xatp_list_tabs', 'List enrolled provider pages in the connected local browser.', {}],
  discover: ['xatp_discover', 'Discover available provider operations on an enrolled tab. Pass nextCursor as cursor for more.', {tabId:'string', providerId:'string',cursor:'string?'}],
  inspect: ['xatp_inspect', 'Invoke a discovered read operation bound to its provider, tab, document and tool ID.', {tabId:'string',providerId:'string',documentId:'string',toolId:'string',operation:'string'}],
};
function parameters(fields) {
  return {type:'object', additionalProperties:false,
    properties:Object.fromEntries(Object.entries(fields).map(([k,v]) => {
      if (typeof v === 'string') return [k,{type:v.replace('?','')}];
      const {optional,...schema} = v;
      return [k,schema];
    })),
    required:Object.keys(fields).filter(k => fields[k] !== 'string?' && !fields[k].optional)};
}
function validate(args, fields) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(k => !Object.hasOwn(fields,k))) throw new Error('INVALID_ARGUMENTS');
  for (const [k,field] of Object.entries(fields)) {
    if ((field === 'string?' || field.optional) && args[k] === undefined) continue;
    const type = typeof field === 'string' ? field : field.type;
    if (type === 'object' && args[k] && typeof args[k] === 'object' && !Array.isArray(args[k])) continue;
    if (type === 'array' && Array.isArray(args[k])) continue;
    if (type === 'integer' && Number.isSafeInteger(args[k])) continue;
    if (type.startsWith('string') && typeof args[k] === 'string') continue;
    throw new Error('INVALID_ARGUMENTS');
  }
}
const previewTypes = new Set(['image/png','image/jpeg','image/webp','image/avif','image/gif','image/svg+xml','video/mp4','video/webm','audio/wav','audio/mpeg','audio/ogg']);
export function apply(ctx, config = {}) {
  const path = config.directory || process.env.XATP_WORKSPACE;
  if (!path) throw new Error('Set XATP_WORKSPACE to an initialized XATP workspace before enabling this plugin.');
  const directory = resolve(path);
  const endpoint = config.cdpEndpoint || process.env.XATP_CDP_ENDPOINT;
  const dshWebOrigin = config.dshWebOrigin || process.env.XATP_DSH_ORIGIN;
  const adapter = endpoint && createBrowserAdapter({endpoint, dshWebOrigin});
  function browser() {
    if (!adapter) throw new Error('XATP_BROWSER_NOT_CONNECTED');
    return adapter;
  }
  const workflow = createWorkflowHost(directory,browser);
  const service = {
    checkH3Draft:workflow.checkH3Draft,
    readNodeText:workflow.readNodeText,saveNodeText:workflow.saveNodeText,
    selectH3Mode:workflow.selectH3Mode,selectH3:workflow.selectH3,quoteH3:workflow.quoteH3,configureH3Minimum:workflow.configureH3Minimum,
    orchestration_read:workflow.read, orchestration_save:workflow.save,
    orchestration_compile:workflow.compile, orchestration_run:workflow.run,
    read: () => readWorkspace(directory),
    editPrompt: args => editPrompt(directory,args),
    renderRocDraft: args => recordRocDraft(directory,args),
    exportShot: args => exportShot(directory,args),
    listTabs: () => browser().listTabs(),
    discover: args => browser().discover(args),
    inspect: args => {
      if (!['inspect','read_link','collect_assets','collect_citations'].includes(args.operation)) throw new Error('operation_blocked');
      return browser().invoke(args);
    },
  };
  function call(method, args) {
    validate(args,methods[method][2]);
    return service[method](args);
  }
  for (const [method,[name,description,fields]] of Object.entries(methods)) {
    ctx.tools.register({name, description, parameters:parameters(fields),
      output:{schema:{}, render:(_args,value) => [{type:'text',text:JSON.stringify(value)}]},
      async execute(args, exec) {
        exec.signal.throwIfAborted();
        return await call(method,args);
      },
    });
  }
  ctx.inject(['connection'], scope => {
    const register = (path, methods, fetch) => scope.connection.fetch.register({path, methods, requestBody:'buffered', fetch});
    for (const method of Object.keys(methods)) {
      register('/api/xatp.' + method,['POST'],async request => {
        if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return new Response(null,{status:415});
        try {
          const value = await call(method, await request.json());
          return Response.json(value,{headers:{'cache-control':'no-store'}});
        } catch (e) {
          return Response.json({error:e.code || e.message || 'XATP_OPERATION_FAILED'},{status:400,headers:{'cache-control':'no-store'}});
        }
      });
    }
    register('/api/xatp.preview',['GET'],async request => {
      const hash = new URL(request.url).searchParams.get('digest');
      if (!/^[a-f0-9]{64}$/.test(hash ?? '')) return new Response(null,{status:400});
      const record = readWorkspace(directory).records.find(r => ['draft','asset'].includes(r.kind) && r.data.blob === hash && previewTypes.has(r.data.mime));
      if (!record) return new Response(null,{status:404});
      return new Response(readBlob(directory,hash),{headers:{
        'content-type':record.data.mime,'content-security-policy':"sandbox; default-src 'none'",
        'x-content-type-options':'nosniff','cache-control':'private, no-store',
      }});
    });
  });
}

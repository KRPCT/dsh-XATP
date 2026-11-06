/** The only Updream browser mutations available to workflows are edits to a bound draft. */
import {AdapterError} from '../browser/cdp.mjs';

import {bindVideoSelection} from './selected-video.mjs';
import {invokeVideoSettings,locateVideoSettings,settingsOperations} from './video-settings.mjs';

const editorOperations = ['read_prompt','prepare_prompt'];
export const draftOperations = [...editorOperations,...settingsOperations];
const surfaces = ['agent','video'];

export function isUpdreamCanvas(provider, location) {
  const url = new URL(location);
  return provider === 'updream' && ['https://updream.cn','https://www.updream.cn'].includes(url.origin)
    && url.pathname === '/canvas' && url.search.length > 1 && !url.username && !url.password;
}

// Runs in the selected frame's isolated world. No selector, URL, model, or action is supplied by the page.
function canvasEditor(surface, href, operation, prompt, expectedCurrentText, model, nodeType, sendButton, selection) {
  const visible = el => el.isConnected && el.checkVisibility({opacityProperty:true,visibilityProperty:true})
    && el.getClientRects().length && !el.closest('[hidden],[inert],[aria-hidden=true]');
  if (location.href !== href || location.pathname !== '/canvas') return null;
  const selector = surface === 'agent' ? '[class*="chatComposer"] div[contenteditable=true]' : '.prompt-editor-wrap .ProseMirror[contenteditable=true]';
  const candidates = [...document.querySelectorAll(selector)].filter(visible);
  if (candidates.length !== 1 || candidates[0].closest('[aria-disabled=true]')) return null;
  const editor = candidates[0];
  if (surface === 'agent') {
    const composer = sendButton && visible(sendButton) && [...document.querySelectorAll('[class*="chatComposer"]')]
      .find(el => el.contains(editor) && el.contains(sendButton));
    if (!composer) return null;
  } else {
    if (!selection?.current() || !model || !nodeType || !visible(model) || !visible(nodeType)
      || model.innerText.trim() !== 'MiniMax H3' || nodeType.innerText.trim() !== '视频生成') return null;
  }
  if (operation === 'locate') return editor;
  // 'this' is the Chromium object for the element found during discovery. Re-check before each access.
  if (editor !== this) return null;
  if (operation === 'read_prompt') return {surface,readback:editor.innerText,creditsSpent:0};
  if (operation !== 'prepare_prompt') return null;
  if (editor.innerText !== expectedCurrentText) return {error:'draft_conflict'};
  if (editor.innerText !== prompt) {
    editor.focus({preventScroll:true});
    if (location.href !== href || (surface === 'video' && !selection.current()) || !editor.isConnected || document.activeElement !== editor || editor.innerText !== expectedCurrentText) return {error:'draft_conflict'};
    const range = document.createRange();
    range.selectNodeContents(editor);
    const textSelection = window.getSelection();
    textSelection.removeAllRanges();
    textSelection.addRange(range);
    // An editing command lets React / ProseMirror observe the native input event. Never synthesize Enter.
    if (!document.execCommand('insertText',false,prompt)) return {error:'draft_write_failed'};
  }
  return {surface,readback:editor.innerText,exactMatch:editor.innerText === prompt,creditsSpent:0};
}

function args(...values) { return values.map(value => ({value})); }

export async function discoverDrafts(send,context,policy,frame,hash,nodes) {
  if (!isUpdreamCanvas(policy.id,frame.href) || !draftOperations.some(op => policy.capabilities.has(op))) return [];
  const observed = [];
  async function uniqueControl(role,name) {
    const matches = nodes.filter(n => !n.ignored && n.role.value === role && n.name?.value === name && n.backendDOMNodeId);
    if (matches.length !== 1) return {value:null};
    const {object} = await send('DOM.resolveNode',{backendNodeId:matches[0].backendDOMNodeId,executionContextId:context});
    return {objectId:object.objectId};
  }
  const selection = await bindVideoSelection(send,context,frame.href);
  const videoControls = selection ? [await uniqueControl('combobox','模型'),await uniqueControl('combobox','节点类型'),{value:null},selection.argument] : null;
  const settings = settingsOperations.filter(op => policy.capabilities.has(op));
  if (settings.length && videoControls) {
    const settingsState = await locateVideoSettings(send,context,frame.href,videoControls);
    if (settingsState) {
      const {objectId,h3Modes} = settingsState;
      const {node} = await send('DOM.describeNode',{objectId,depth:0});
      observed.push({objectId,controls:videoControls,tool:{
        toolId:'draft.' + hash([frame.documentId,'settings',node.backendNodeId,selection.key]),role:'combobox',name:'MiniMax H3 settings',
        surface:'video_settings',form:null,disabled:false,operations:settings.filter(op=>op !== 'select_h3_mode' || h3Modes),
        ...(h3Modes ? {h3Modes} : {}),
      }});
    }
  }
  if (!editorOperations.some(op => policy.capabilities.has(op))) return observed;
  for (const surface of surfaces) {
    if (surface === 'video' && !videoControls) continue;
    const controls = surface === 'video' ? videoControls : [{value:null},{value:null},await uniqueControl('button','发送')];
    const response = await send('Runtime.callFunctionOn',{executionContextId:context,functionDeclaration:canvasEditor.toString(),
      arguments:[...args(surface,frame.href,'locate',null,null),...controls]});
    if (response.exceptionDetails) throw new AdapterError('draft_unavailable','Cannot inspect the Updream editor.');
    const objectId = response.result.objectId;
    if (!objectId) continue;
    const {node} = await send('DOM.describeNode',{objectId,depth:0});
    observed.push({objectId,controls,tool:{
      toolId:'draft.' + hash([frame.documentId,surface,node.backendNodeId,surface === 'video' ? selection.key : null]),role:'textbox',name:surface === 'agent' ? 'Agent prompt' : 'MiniMax H3 video prompt',
      surface,form:null,disabled:false,operations:editorOperations.filter(op => policy.capabilities.has(op)),
    }});
  }
  return observed;
}

export async function invokeDraft(send,frame,match,request) {
  const surface = match.tool.surface;
  if (surface === 'video_settings') return invokeVideoSettings(send,frame,match,request);
  const prompt = request.prompt;
  const expected = request.expectedCurrentText === undefined ? '' : request.expectedCurrentText;
  if (request.operation === 'prepare_prompt' && (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 12000
    || typeof expected !== 'string' || expected.length > 12000)) throw new AdapterError('invalid_prompt','Supply a nonempty prompt and a bounded expected draft.');
  async function run(operation) {
    const reply = await send('Runtime.callFunctionOn',{objectId:match.objectId,functionDeclaration:canvasEditor.toString(),
      arguments:[...args(surface,frame.href,operation,prompt ?? null,expected),...match.controls],returnByValue:true});
    const result = reply.result.value;
    if (reply.exceptionDetails || !result) throw new AdapterError('stale_tool','The canvas editor, model or project changed.');
    if (result.error) throw new AdapterError(result.error,'The draft could not be safely replaced. Read the current draft.');
    return result;
  }
  const result = await run(request.operation);
  if (request.operation === 'read_prompt') return result;
  const verified = await run('read_prompt');
  if (!result.exactMatch || verified.readback !== prompt) throw new AdapterError('draft_readback_mismatch','The editor did not retain the exact requested text. Inspect its current draft.');
  return {...verified,exactMatch:true};
}

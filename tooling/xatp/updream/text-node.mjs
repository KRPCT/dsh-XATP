/** Manual text-node editing. Each operation owns only the selected node and its plain-text dialog. */
import {AdapterError} from '../browser/cdp.mjs';
import {bindNodeSelection} from './selected-node.mjs';

export const textOperations = ['read_node_text','save_node_text'];

// All DOM actions run in the selected frame's isolated world. The caller cannot supply a selector or an action name.
async function textNode(selection,operation,text,expectedText) {
  const node = selection.node;
  const visible = el => el?.isConnected && el.getClientRects().length &&
    el.checkVisibility({opacityProperty:true,visibilityProperty:true}) && !el.closest('[inert],[aria-hidden=true]');
  const one = (root,selector) => {
    const matches = [...root.querySelectorAll(selector)].filter(visible);
    return matches.length === 1 ? matches[0] : null;
  };
  const modalSelector = '[data-testid="text-edit-modal"]';
  const modal = () => one(document,modalSelector);
  // Do not flatten images, links, headings or styled spans by replacing them with a text-only draft.
  const paragraphs = root => {
    if (!root || [...root.childNodes].some(n => n.nodeType === 3 ? !!n.textContent.trim() : n.nodeName !== 'P')) return null;
    const lines = [];
    for (const p of root.children) {
      if (p.hasAttribute('style') || [...p.children].some(el=>el.tagName!=='BR')) return null;
      const line = [...p.childNodes].map(n=>n.nodeType===3 ? n.textContent : n.nodeName==='BR' ? '\n' : '').join('');
      lines.push(line==='\n' ? '' : line);
    }
    return lines.join('\n');
  };
  const snapshot = (selected=node) => {
    if (!visible(selected)) return null;
    const wrap=one(selected,'[data-testid^="node-text-"]');
    if (!wrap || wrap.getAttribute('data-testid')!=='node-text-'+selected.dataset.nodeId) return null;
    const body=one(wrap,':scope > [data-text-preview-content="true"]');
    if (!body) {
      const empty=wrap.firstElementChild;
      return wrap.getAttribute('data-text-node-scroll')==='true' && wrap.children.length===1 && empty?.tagName==='DIV' && !empty.children.length &&
        empty.textContent.trim()==='双击编辑文本...' ? {target:empty,readback:'',plain:true} : null;
    }
    const plain = paragraphs(body);
    return {target:body,readback:plain ?? body.innerText,plain:plain !== null};
  };
  const before = snapshot();
  if (!selection.current() || !before || [...document.querySelectorAll(modalSelector)].some(visible)) return null;
  if (operation==='locate') return {plain:before.plain};
  const result = readback=>({surface:'text_node',readback,creditsSpent:0});
  if (operation==='read_node_text') return result(before.readback);
  if (operation!=='save_node_text') return null;
  if (before.readback!==expectedText) return {error:'draft_conflict'};
  if (before.readback===text) return {...result(text),exactMatch:true};
  if (!before.plain) return {error:'formatted_text_requires_manual_edit'};
  const waitFor = async (callback,check=selection.current) => {
    for(let i=0; i<35; i++){
      if (!check()) return null;
      const value=callback();
      if (value) return value;
      await new Promise(resolve=>setTimeout(resolve,35));
    }
    return null;
  };
  before.target.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,view:window,detail:2}));
  const dialog = await waitFor(modal);
  if (!dialog) return {error:'text_editor_unavailable'};
  const editor = one(dialog,'div.tiptap.ProseMirror[role=textbox][contenteditable=true]');
  const save = one(dialog,'button[data-testid="text-edit-modal-save"]');
  if (!editor || !save || save.form || save.innerText.trim()!=='保存' || paragraphs(editor)!==expectedText) return {error:'text_editor_conflict'};
  editor.focus({preventScroll:true});
  if (!selection.current() || modal()!==dialog || !visible(editor) || document.activeElement!==editor || paragraphs(editor)!==expectedText) return {error:'text_editor_conflict'};
  const range=document.createRange();
  if (!editor.firstElementChild || !editor.lastElementChild) return {error:'text_editor_conflict'};
  range.setStart(editor.firstElementChild,0);
  range.setEnd(editor.lastElementChild,editor.lastElementChild.childNodes.length);
  const highlight=window.getSelection();
  highlight.removeAllRanges();
  highlight.addRange(range);
  if (!document.execCommand('insertText',false,text) || !selection.current() || modal()!==dialog || paragraphs(editor)!==text ||
      !visible(save) || save.disabled || save.closest('[aria-disabled=true]')) return {error:'draft_write_failed'};
  save.click();
  const verified=await waitFor(()=>{
    const after=snapshot(selection.reacquire());
    return !modal() && after?.readback===text && after.plain;
  },selection.reacquire);
  return verified ? {...result(text),exactMatch:true} : {error:'draft_readback_mismatch'};
}

export async function discoverTextNode(send,context,policy,frame,hash) {
  const allowed = textOperations.filter(op=>policy.capabilities.has(op));
  if (!allowed.length) return null;
  const selection=await bindNodeSelection(send,context,frame.href,'.canvas-node.canvas-node-text.selected[data-node-id]');
  if (!selection) return null;
  const check=await send('Runtime.callFunctionOn',{executionContextId:context,functionDeclaration:textNode.toString(),
    arguments:[selection.argument,{value:'locate'}],awaitPromise:true,returnByValue:true});
  if (check.exceptionDetails || !check.result.value) return null;
  return {objectId:selection.argument.objectId,tool:{toolId:'draft.'+hash([frame.documentId,'text_node',selection.key]),
    role:'textbox',name:'Updream 文本节点',surface:'text_node',form:null,disabled:false,
    operations:allowed.filter(op=>op==='read_node_text'||check.result.value.plain)}};
}

export async function invokeTextNode(send,match,{operation,text,expectedText}) {
  if (operation==='save_node_text' && (typeof text!=='string' || !text.trim() || text.length>12000 ||
      typeof expectedText!=='string' || expectedText.length>12000)) {
    throw new AdapterError('invalid_prompt','Supply bounded plain text and the expected current node text.');
  }
  const reply=await send('Runtime.callFunctionOn',{objectId:match.objectId,functionDeclaration:textNode.toString(),
    arguments:[{objectId:match.objectId},{value:operation},{value:text??null},{value:expectedText??null}],awaitPromise:true,returnByValue:true});
  const value=reply.result.value;
  if (reply.exceptionDetails || !value) throw new AdapterError('stale_tool','The Updream text node or its editor changed.');
  if (value.error) throw new AdapterError(value.error,'Could not safely save and read back the selected Updream text node.');
  return value;
}

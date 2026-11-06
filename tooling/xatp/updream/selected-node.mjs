/** Bind an editor to one selected graph node without exporting the site's node ID. */
import {randomBytes} from 'node:crypto';

const salt = randomBytes(24).toString('hex');

async function captureSelection(href,salt,selector) {
  const nodes = document.querySelectorAll(selector);
  if (location.href !== href || nodes.length !== 1) return null;
  const node = nodes[0];
  const id = node.dataset.nodeId;
  if (!id) return null;
  // This per-discovery lease stays in the isolated world. A reused DOM object must still identify the same graph node.
  const identities = new WeakMap([[node,id]]);
  const current = () => location.href === href && document.querySelectorAll(selector).length === 1
    && document.querySelector(selector) === node && identities.get(node) === node.dataset.nodeId;
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(salt+'\0'+id));
  if (!current()) return null;
  const digest = Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  // Only post-save readback may reacquire a React-replaced element with the original private identity.
  const reacquire = () => {
    if (location.href!==href) return null;
    const selected=document.querySelectorAll(selector);
    return selected.length===1 && selected[0].dataset.nodeId===id ? selected[0] : null;
  };
  return {node,current,reacquire,digest};
}

export async function bindNodeSelection(send,context,href,selector) {
  const binding = await send('Runtime.callFunctionOn',{executionContextId:context,functionDeclaration:captureSelection.toString(),
    arguments:[{value:href},{value:salt},{value:selector}],awaitPromise:true});
  const objectId = binding.result.objectId;
  if (binding.exceptionDetails || !objectId) return null;
  const node = await send('Runtime.callFunctionOn',{objectId,functionDeclaration:'function(){return this.node}'});
  // describeNode would serialize all DOM attributes including the private data-node-id.
  const {nodes} = await send('Accessibility.getPartialAXTree',{objectId:node.result.objectId,fetchRelatives:false});
  const backendId = nodes[0]?.backendDOMNodeId;
  const signature = await send('Runtime.callFunctionOn',{objectId,functionDeclaration:'function(){return this.current() && this.digest}',returnByValue:true});
  if (!backendId || !signature.result.value) return null;
  return {argument:{objectId},key:[backendId,signature.result.value]};
}

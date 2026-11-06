/** Bind a floating video editor to the selected graph node without exporting the site's node ID. */
import {randomBytes} from 'node:crypto';

const salt = randomBytes(24).toString('hex');

async function captureSelection(href,salt) {
  const selector = '.canvas-node.canvas-node-video.selected[data-node-id]';
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
  return {node,current,digest};
}

export async function bindVideoSelection(send,context,href) {
  const binding = await send('Runtime.callFunctionOn',{executionContextId:context,functionDeclaration:captureSelection.toString(),
    arguments:[{value:href},{value:salt}],awaitPromise:true});
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

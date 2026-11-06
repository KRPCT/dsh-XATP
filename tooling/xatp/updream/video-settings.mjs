/** Narrow operations for a selected Updream video node. The generation control is read-only. */
import {AdapterError} from '../browser/cdp.mjs';
import {H3_POLICY} from './h3-tariff.mjs';

export const h3ModeControls = Object.freeze({
  '参考生视频':'video-panel-type-ref2v', '图生视频':'video-panel-type-i2v',
  '首尾帧':'video-panel-type-firstlast', '文生视频':'video-panel-type-t2v',
});

export const settingsOperations = ['select_h3','inspect_h3_quote','configure_h3_minimum','select_h3_mode'];

// Chromium supplies the exact controls resolved by accessibility role and name in the same frame.
async function videoSettings(href,mode,model,nodeType,_unused,selection,modeControls,requestedMode,rates) {
  const visible = el => el?.isConnected && el.getClientRects().length
    && el.checkVisibility({opacityProperty:true,visibilityProperty:true}) && !el.closest('[inert],[aria-hidden=true]');
  const editors = [...document.querySelectorAll('.prompt-editor-wrap .ProseMirror[contenteditable=true]')].filter(visible);
  if (editors.length !== 1) return null;
  const editor = editors[0];
  const bound = () => selection?.current() && location.href === href && visible(editor) && visible(model) && visible(nodeType)
    && nodeType.innerText.trim() === '视频生成';
  if (!bound() || !model.matches('button[role=combobox][aria-label="模型"]')) return null;
  if (mode === 'locate') return editor;
  if (editor !== this) return null;
  const selected = () => model.innerText.trim() === 'MiniMax H3';
  const result = {surface:'video_settings',model:'MiniMax H3',creditsSpent:0};
  const pause = () => new Promise(resolve=>setTimeout(resolve,40));
  function modeState() {
    const panels = [...document.querySelectorAll('[data-video-prompt-panel]')].filter(visible);
    if (panels.length !== 1) return null;
    const buttons = [...panels[0].querySelectorAll('button[aria-pressed][data-testid^="video-panel-type-"]')].filter(visible);
    const active = buttons.filter(el=>el.getAttribute('aria-pressed') === 'true');
    if (active.length !== 1) return null;
    const available = [], byName = new Map();
    let selectedMode;
    for (const [name,id] of Object.entries(modeControls)) {
      const matched = buttons.filter(el => el.dataset.testid === id && el.innerText.trim() === name);
      if (matched.length !== 1) continue;
      const button = matched[0];
      if (!['true','false'].includes(button.getAttribute('aria-pressed')) || button.disabled
        || button.closest('[aria-disabled=true]') || button.form) continue;
      available.push(name);
      byName.set(name,button);
      if (button === active[0]) selectedMode = name;
    }
    return selectedMode ? {available,selected:selectedMode,byName} : null;
  }
  if (mode === 'read_modes' || mode === 'select_h3_mode') {
    if (!selected()) return {error:'h3_not_selected'};
    const state = modeState();
    if (!state) return {error:'h3_modes_unavailable'};
    if (mode === 'read_modes') return {available:state.available,selected:state.selected};
    if (!state.byName.has(requestedMode)) return {error:'h3_mode_unavailable'};
    if (state.selected !== requestedMode) state.byName.get(requestedMode).click();
    for (let step=0;step<20;step++) {
      if (!bound() || !selected()) return null;
      if (modeState()?.selected === requestedMode) return {...result,mode:requestedMode};
      await pause();
    }
    return {error:'h3_mode_unconfirmed'};
  }
  // The generation button anchors the sibling quote. It is never activated.
  function quote() {
    const generators = [...document.querySelectorAll('button[data-testid="video-panel-generate"][title="生成"]')].filter(visible);
    if (generators.length !== 1) return null;
    const prices = [...generators[0].parentElement.children].filter(el => el.matches('span[class*="creditHint"]') && visible(el));
    if (prices.length !== 1 || !/^\d+$/.test(prices[0].innerText.trim())) return null;
    const pattern = /^\d+:\d+\s*\/\s*(\d{1,2})S\s*\/\s*(768P|2K)$/i;
    const options = [...document.querySelectorAll('button')].filter(visible).map(el => {
      return {el,match:pattern.exec((el.getAttribute('aria-label') || el.innerText).trim())};
    }).filter(o => o.match);
    if (options.length !== 1) return null;
    const seconds = Number(options[0].match[1]), displayedCredits = Number(prices[0].innerText.trim());
    if (seconds < 5 || seconds > 15 || !Number.isSafeInteger(displayedCredits) || displayedCredits < 1) return null;
    return {trigger:options[0].el,value:{...result,seconds,resolution:options[0].match[2].toUpperCase(),displayedCredits}};
  }
  if (mode === 'inspect_h3_quote' || mode === 'configure_h3_minimum') {
    if (!selected()) return {error:'h3_not_selected'};
    const observed = quote();
    if (!observed) return {error:'quote_unavailable'};
    const quoteMode = modeState()?.selected;
    if (!quoteMode) return {error:'quote_unconfirmed'};
    // Only text-to-video excludes a reference-video surcharge by construction.
    // Never replace the site's number with a local estimate.
    async function confirmQuote(expected) {
      const deadline = performance.now()+3000;
      do {
        if (!bound() || !selected() || modeState()?.selected !== quoteMode) return null;
        const current = quote()?.value;
        if (current && (current.seconds !== expected.seconds || current.resolution !== expected.resolution)) {
          return {error:'quote_settings_changed'};
        }
        if (current && current.displayedCredits === current.seconds*rates[current.resolution]) {
          return {...current,quoteMode,quoteStatus:'matched_no_reference_tariff'};
        }
        await pause();
      } while (performance.now()<deadline);
      return {error:'quote_unconfirmed'};
    }
    if (quoteMode !== '文生视频') {
      if (mode === 'configure_h3_minimum') return {error:'h3_text_mode_required'};
      return {...observed.value,quoteMode,quoteStatus:'observed_only'};
    }
    if (mode === 'inspect_h3_quote') return confirmQuote(observed.value);
    const minimum = value => value?.seconds === 5 && value.resolution === '768P';
    if (minimum(observed.value)) return confirmQuote(observed.value);
    const durationField = 'input[data-testid="video-options-duration-input"][aria-label="时长"]';
    const qualityButton = 'button[data-testid="video-options-opt-resolution-768P"]';
    const one = selector => {
      const els = [...document.querySelectorAll(selector)].filter(visible);
      return els.length === 1 ? els[0] : null;
    };
    if (observed.trigger.closest('form') || observed.trigger.disabled) return null;
    if (!one(durationField)) observed.trigger.click();
    for (let tick=0;tick<20;tick++) {
      await pause();
      if (!bound() || !selected() || modeState()?.selected !== quoteMode) return null;
      const duration = one(durationField), quality = one(qualityButton);
      if (!duration || !quality) continue;
      if (duration.disabled || duration.readOnly || duration.min !== '5' || duration.max !== '15' || quality.disabled
        || quality.closest('form') || observed.trigger.closest('form')) return {error:'h3_options_unavailable'};
      if (!quality.className.includes('vopTabItemActive')) quality.click();
      if (!bound() || !selected() || modeState()?.selected !== quoteMode || !visible(duration)) return null;
      if (duration.value !== '5') {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(duration,'5');
        duration.dispatchEvent(new Event('input',{bubbles:true}));
        duration.dispatchEvent(new Event('change',{bubbles:true}));
        duration.blur();
      }
      for (let step=0;step<25;step++) {
        await pause();
        if (!bound() || !selected() || modeState()?.selected !== quoteMode) return null;
        const current = quote()?.value;
        if (minimum(current)) return confirmQuote(current);
      }
      return {error:'h3_minimum_unconfirmed'};
    }
    return {error:'h3_options_unavailable'};
  }
  if (mode !== 'select_h3') return null;
  if (selected()) return result;
  if (model.matches(':disabled,[aria-disabled=true]') || model.closest('form') && model.type === 'submit') return null;
  // A stale open menu must never broaden this action to another model or an unrelated control.
  if (model.getAttribute('aria-expanded') !== 'true') model.click();
  for (let step=0;step<20;step++) {
    await new Promise(resolve=>setTimeout(resolve,25));
    if (!bound()) return null;
    const menu = document.getElementById(model.getAttribute('aria-controls'));
    if (!visible(menu) || menu.getAttribute('role') !== 'listbox') continue;
    const options = [...menu.querySelectorAll('[role=option][data-testid="video-panel-model-option-hailuo-h3"]')].filter(visible)
      .filter(el=>el.querySelector('[class*="modelOptionLabel"]')?.innerText.trim() === 'MiniMax H3'
        && !el.matches(':disabled,[aria-disabled=true]') && !el.closest('form'));
    if (options.length !== 1) return {error:'h3_option_unavailable'};
    options[0].click();
    for (let tick=0;tick<20;tick++) {
      await new Promise(resolve=>setTimeout(resolve,25));
      if (!bound()) return null;
      if (selected()) return result;
    }
    return {error:'h3_selection_unconfirmed'};
  }
  return {error:'h3_option_unavailable'};
}

export async function locateVideoSettings(send,context,href,controls) {
  const response = await send('Runtime.callFunctionOn',{executionContextId:context,functionDeclaration:videoSettings.toString(),
    arguments:[{value:href},{value:'locate'},...controls],awaitPromise:true});
  if (response.exceptionDetails) throw new AdapterError('settings_unavailable','Cannot inspect video settings.');
  const objectId = response.result.objectId;
  if (!objectId) return null;
  const modes = await send('Runtime.callFunctionOn',{objectId,functionDeclaration:videoSettings.toString(),
    arguments:[{value:href},{value:'read_modes'},...controls,{value:h3ModeControls}],awaitPromise:true,returnByValue:true});
  const state = modes.result.value;
  return {objectId,h3Modes:!modes.exceptionDetails && state?.available ? state : null};
}

export async function invokeVideoSettings(send,frame,match,request) {
  const reply = await send('Runtime.callFunctionOn',{objectId:match.objectId,functionDeclaration:videoSettings.toString(),
    arguments:[{value:frame.href},{value:request.operation},...match.controls,{value:h3ModeControls},{value:request.mode ?? null},{value:H3_POLICY.rates}],awaitPromise:true,returnByValue:true});
  const result = reply.result.value;
  if (reply.exceptionDetails || !result) throw new AdapterError('stale_tool','The selected Updream video node changed.');
  if (result.error) throw new AdapterError(result.error,result.error === 'quote_unconfirmed'
    ? 'quote_unconfirmed' : 'The requested H3 control could not be verified on this video node.');
  return result;
}

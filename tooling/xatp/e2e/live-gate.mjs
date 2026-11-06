#!/usr/bin/env node
/** Read-only environment probes and the fail-closed release decision for XATP issue 11. */
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createBrowserAdapter} from '../browser/index.mjs';

const issue = 'https://github.com/KRPCT/dsh-XATP/issues/11';

async function dshProbe(raw) {
  if (!raw) return 'origin_missing';
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost','127.0.0.1','[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return 'invalid_loopback_origin';
    // The real DSH Host rejects an uncredentialed GET /connect with this specific challenge.
    const response = await fetch(new URL('/connect',url), {redirect:'error', signal:AbortSignal.timeout(3000)});
    if (response.status !== 401) {
      await response.body?.cancel();
      return 'challenge_not_observed';
    }
    const reader = response.body.getReader();
    let body = '';
    try {
      while (body.length < 160) {
        const chunk = await reader.read();
        if (chunk.done) break;
        body += Buffer.from(chunk.value.subarray(0,160)).toString();
      }
    } finally { await reader.cancel(); }
    return body.trim() === 'dsh web authentication required; reopen the URL printed by dsh web.'
      ? 'host_challenge_observed' : 'challenge_not_observed';
  } catch { return 'host_unreachable'; }
}

async function browserProbe(endpoint, dshWebOrigin) {
  if (!endpoint) return {cdp:'endpoint_missing',updream:'not_checked',leapspace:'not_checked'};
  try {
    const adapter = createBrowserAdapter({endpoint, dshWebOrigin});
    const tabs = await adapter.listTabs();
    const states = await Promise.all(['updream','leapspace'].map(async id => {
      const tab = tabs.find(t => t.providerId === id);
      if (!tab) return 'no_matching_tab';
      try {
        await adapter.discover(tab);
        return 'document_observed';
      } catch { return 'document_not_verified'; }
    }));
    return {cdp:'reachable',updream:states[0],leapspace:states[1]};
  } catch { return {cdp:'unavailable_or_invalid',updream:'not_checked',leapspace:'not_checked'}; }
}

async function preflight(env) {
  const [dsh,browser] = await Promise.all([dshProbe(env.XATP_DSH_ORIGIN),browserProbe(env.XATP_CDP_ENDPOINT,env.XATP_DSH_ORIGIN)]);
  const key = env.DEEPSEEK_API_KEY?.trim() ? 'present_unverified' : 'absent_from_environment';
  return {
    ready:dsh === 'host_challenge_observed' && key === 'present_unverified'
      && browser.updream === 'document_observed' && browser.leapspace === 'document_observed',
    dsh, deepseek_environment_key:key, browser,
  };
}

/**
 * Release decision. No hosted transaction runner or independent receipt verifier is registered in this revision.
 * @param {object} environment Read-only preflight observations.
 * @returns {object} Blocked gates, evidence required and the next action.
 */
export function finalReport(environment) {
  return {
    issue, mode:'live', status:'blocked', preflight:environment,
    transaction_attempted:false,
    gates:[
      {id:'dsh_deepseek_turn', status:'unverified', requires:'A real DSH session/turn and DeepSeek response from the native workbench, correlated to the frozen research intent.'},
      {id:'leapspace_research', status:'adapter_missing', requires:'Authenticated official LeapSpace query execution and returned citations, with original-source anchors mapped to the query and claim revisions.'},
      {id:'updream_generation', status:'adapter_missing', requires:'Explicitly authorized hosted generation, verified draft/reference upload, provider job identity, completion and locally hashed returned media.'},
      {id:'timeline_and_recovery', status:'unverified', requires:'Trace the returned media hash to the frozen timeline and evidence export. Observe missing-evidence refusal, disconnect, ambiguous submission reconciliation without a duplicate, rework and revision invalidation.'},
      {id:'production_ui', status:'unverified', requires:'A reviewed recording of the native workflow including both themes, narrow layout, long text, keyboard focus, loading and failure states.'},
    ],
    next:'Implement authenticated query and generation/reconciliation adapters and independent provider receipt verification. Then run the authorized native workflow under a capped budget and retain its linked evidence and UI recording.',
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && !['preflight','live'].includes(args[0]))) {
    console.log(JSON.stringify({mode:'live',status:'blocked',reason:'unsupported_input',usage:'live-gate.mjs [preflight|live]'}));
    return 64;
  }
  const environment = await preflight(process.env);
  if (args[0] === 'preflight') {
    console.log(JSON.stringify({issue,mode:'preflight',status:environment.ready ? 'preflight_ready' : 'blocked',preflight:environment},null,2));
    return environment.ready ? 0 : 2;
  }
  console.log(JSON.stringify(finalReport(environment),null,2));
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}

#!/usr/bin/env node
/** Read-only environment probes and the fail-closed release decision for XATP issue 11. */
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createBrowserAdapter} from '../browser/index.mjs';

import {H3_POLICY,h3Estimate} from '../updream/h3-tariff.mjs';

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
  if (!endpoint) return {cdp:'endpoint_missing',updream:'not_checked'};
  try {
    const adapter = createBrowserAdapter({endpoint, dshWebOrigin});
    const pages = (await adapter.listTabs()).filter(tab => tab.providerId === 'updream');
    for (const tab of pages) {
      try {
        const catalog = await adapter.discover(tab);
        return {cdp:'reachable',updream:'document_observed',surface:tab.surface ?? 'browser_tab',firstPageEntries:catalog.tools.length};
      } catch { /* A closed tab must not mask a second live production tab. */ }
    }
    return {cdp:'reachable',updream:pages.length ? 'document_not_verified' : 'no_matching_tab'};
  } catch { return {cdp:'unavailable_or_invalid',updream:'not_checked'}; }
}

async function preflight(env) {
  const [dsh,browser] = await Promise.all([dshProbe(env.XATP_DSH_ORIGIN),browserProbe(env.XATP_CDP_ENDPOINT,env.XATP_DSH_ORIGIN)]);
  const key = env.DEEPSEEK_API_KEY?.trim() ? 'present_unverified' : 'absent_from_environment';
  return {
    ready:dsh === 'host_challenge_observed' && browser.updream === 'document_observed',
    dsh, deepseek_environment_key:key, browser,
  };
}

/** Account-free inventory is insufficient for a claim covering every production action. */
export function finalReport(environment) {
  return {
    creditPolicy:{model:H3_POLICY.model,spendNow:H3_POLICY.spendNow,totalLimit:H3_POLICY.totalLimit,minimumQuote:h3Estimate({model:H3_POLICY.model,resolution:'768P',seconds:H3_POLICY.minSeconds}).credits},
    issue, mode:'live', scope:'updream_prompt_orchestration', status:'blocked', preflight:environment,
    transaction_attempted:false,
    gates:[
      {id:'dsh_deepseek_turn',status:'unverified',requires:'A real model turn invoking the versioned workflow through DSH.'},
      {id:'updream_account_inventory',status:'observed',evidence:'updream/authenticated-observations.json',scope:'Menu inventory and no-submit field checks on one account, 2026-11-06.'},
      {id:'dsh_signed_in_prompt_relay',status:'observed',evidence:'updream/split-browser-observation.json',scope:'One real H3 draft, supervised browser relay, one SQLite receipt. Direct production CDP unverified.'},
      {id:'updream_prompt_dispatch',status:'unverified',requires:'Per-capability platform observations of the actual prompt, resulting action, and its unique receipt, including prompt or reference readback where exposed.'},
      {id:'updream_h3_generation',status:'out_of_budget',requires:'At current rates the lowest provider quote exceeds the cumulative limit. Keep generation disabled.'},
    ],
    filmPlanSeconds:{minimum:110,maximum:118,inclusive:true},
    deferred:['elsevier_live_research','final_video_generation','generation_quality_review'],
    next:'Bind an authenticated Updream editor to DSH and verify unmetered actions. Keep generation disabled and reconcile unknown outcomes before retry.',
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

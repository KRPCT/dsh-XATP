# XATP browser adapter

The host imports `createBrowserAdapter({endpoint})` from `index.mjs` and points it at a dedicated local Chromium debugging port. Each request selects a provider and tab. The adapter opens a bounded CDP connection, reads the main frame's accessibility tree and inspects the corresponding DOM nodes in an isolated world. It does not launch Chromium. Requires Node 24.

```js
const adapter = createBrowserAdapter({endpoint: 'http://127.0.0.1:9222'});
const tabs = await adapter.listTabs();
const tab = tabs.find(tab => tab.providerId === 'updream');
if (tab) {
  const {documentId, tools, unsupported} = await adapter.discover(tab);
  const result = await adapter.invoke({...tab, documentId, toolId:'page', operation:'collect_assets'});
}
```

| Operation | Scope | Result |
| --- | --- | --- |
| inspect | Current visible semantic control | Current role, accessible name, form identity and disabled state |
| read_link | Enabled link with an enrolled origin | Resolved URL. No request is sent to the destination |
| collect_assets | Updream main document | Rendered image, video, audio and recognizable linked media. `items` contain allowed clean URLs. `media` reports visible video/audio host, playback readiness, duration in seconds and intrinsic dimensions, including when a signed address is withheld |
| read_prompt | Discovered Agent or exact MiniMax H3 video editor on the current Updream project canvas | Visible draft text and editor surface |
| prepare_prompt | Same bound editor | Exact readback after editing with a native input event. Takes `prompt` and optional `expectedCurrentText`, which defaults to the empty string |
| select_h3_mode | Selected H3 video node with discovered mode controls | Selects an enabled mode from the current tool’s `h3Modes.available` and returns its verified pressed state |
| select_h3 | Selected video node with a bound model control | Selects the MiniMax H3 option and verifies the exact model label |
| inspect_h3_quote | Selected H3 video node | Reads the displayed resolution, seconds and quoted points from its settings summary and credit hint |
| configure_h3_minimum | Selected H3 video node | Chooses 768P and 5 seconds, and verifies the displayed 250-point quote |
| collect_citations | LeapSpace main document | Visible DOI, ScienceDirect PII, Elsevier PII and PubMed record links. These are possible sources visible on the page. Attribution to a particular answer requires verification in its citation view |

A new discovery observes DOM changes. Invocation rechecks the target, origin, frame, loader, URL and control identity. A stale document or replaced control requires rediscovery. The adapter pages the main document's accessible controls in batches of 200. Pass the returned `nextCursor` back to `discover({...tab,cursor:nextCursor})` until it is null. Changes to candidate identity, order, role, name, disabled state or document invalidate the cursor; restart discovery after a `stale_cursor` error. Any returned tool can be invoked directly with its original binding. Discovery excludes password and file inputs, reports unsupported canvas/frames and returns no input values. Controls with custom drawing, inaccessible markup, unrendered virtualization and closed embedded frames require separate coverage. A visible timeline canvas does not expose its internal tools through this adapter.

Provider replacement uses trusted host configuration. Each entry supplies an `id`, exact `origins`, enabled `capabilities`, and optional `resourceOrigins`. The defaults enroll Updream and the official ScienceDirect LeapSpace path separately. LeapSpace requires the exact `/leapspace` path or its descendants, which excludes login pages and ordinary articles on the same host. [Elsevier access instructions](https://www.elsevier.support/leapspace/answer/accessing-leapspace). Qualifying media and original-source links must use an enrolled origin, without credentials, a fragment, or URL parameters. HTTPS origins and explicitly configured HTTP loopback fixtures are supported. Discovery accepts no scripts, URL overrides, selectors, browser launches or paid operations. The host owns the debugging port, browser profile and provider configuration.

To verify the adapter on an isolated local Chromium instance, run `node --test tooling/xatp/browser/browser.test.mjs`. Set `CHROMIUM_BIN` to an alternative Chromium executable if needed. The test launches a disposable browser profile with a local fixture and terminates it on exit. It exercises dynamic replacement, SPA navigation, reloads, blocked operations, signed links and media metadata. No hosted generation or research query is part of this test.

## DSH Web Browser tab

To include an embedded Browser tab, the trusted host may pass `dshWebOrigin` to `createBrowserAdapter`. Use the exact loopback origin serving DSH. Only its root application document and direct child frames are eligible. The adapter resolves the DOM owner of each candidate by frame ID, checks DSH's `data-sidebar-browser-frame="iframe"` marker, the default sandbox flags and `no-referrer`, and verifies both the declared source and current child URL against the selected provider. Discovery returns `surface: 'dsh_web_iframe'` and an opaque `tabId` usable with the same discovery, pagination and invocation methods. [DSH frame implementation](../../../packages/client/ui-sidebar-browser/src/client/view/IframePresentation.ts).

The embedded handle binds the page target, parent loader, owner DOM node, child frame and loaded document. After navigation, replacement, removal or a policy change, repeat target discovery. Keep the provider in a dedicated enrolled browser tab when the child lives in a separate DevTools target, the DSH tab uses a relaxed sandbox, or a provider refuses embedding. The adapter does not attach to independent iframe targets or override a site's embedding policy.

## Updream canvas drafts

Open the Agent conversation or select a video node with MiniMax H3 on the authenticated project canvas. Discover the editor via its `surface` field. The agent composer also requires its own Send control. The video editor requires one visible model control, one video node-type control and the specific ProseMirror prompt field. The floating panel is bound to the selected graph-node object and a salted digest of its private node ID. Both a reused panel and a replacement graph node require fresh discovery. Project query values stay inside the browser connection.

```js
const directory = await adapter.discover(tab);
const editor = directory.tools.find(t => t.surface === 'video' && t.operations.includes('prepare_prompt'));
if (editor) {
  const binding = {...tab, documentId:directory.documentId, toolId:editor.toolId};
  const result = await adapter.invoke({...binding, operation:'prepare_prompt', prompt:'镜头一，静止机位。'});
  console.log(result.exactMatch);
}
```

Run `node --test tooling/xatp/updream/draft.test.mjs` with `CHROMIUM_BIN` set to a Chromium executable. The intercepted local pages exercise the adapter on separate agent and video editors, reject unintended replacements, and count submission events. The [authenticated observations](../updream/authenticated-observations.json) record independent checks in the signed-in browser.

## Recorded browser observations

[observations.json](./observations.json) records a signed-out inspection of the published Updream canvas and a separate OpenCLI fixture experiment. To repeat the media observation, open the [public example](https://www.updream.cn/skills/guide-first-video-v7/examples/default) in a dedicated Chromium profile, discover its controls and inspect `collect_assets`. Open the existing “查看视频初版v2” preview in the browser, then invoke the same read again after the media loads. The observed video reached readiness 4 at 864 × 496 and 8.041667 seconds. The adapter returns playback metadata while keeping signed asset URLs private.

The OpenCLI comparison used the [v2.0.2 release commit](https://github.com/jackwener/opencli/tree/deca0fee85016be2e58836eeca974825e09c9076), its npm binary with lifecycle scripts disabled, and a temporary read-only fixture command registered with `@jackwener/opencli/registry`. With `OPENCLI_CDP_ENDPOINT` set, the command read `page.snapshot({source:'dom'})`, `page.snapshot({source:'ax'})` and control labels from the same local Chromium target. The DOM snapshot numbered the textbox and link and printed the disabled button. OpenCLI's AX snapshot returned only the root for this fixture. Generic `opencli browser state` uses the separate Browser Bridge extension in this release. Hosted generation, account access and authenticated research are outside these observations.

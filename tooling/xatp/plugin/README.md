# DSH XATP workbench

This opt-in bundle adds the XATP tab to the right-sidebar guide in DSH Web. The tab stays mounted when hidden. Its owner-only Connection routes and its model tools share the workspace ledger, workflow compiler and scoped browser adapter. One Host process selects one production directory at startup. Switching between DSH chat sessions keeps that production selected.

## Build and use

From the built DSH checkout with its locked dependencies and Node 24.9 or later, build both bundle entries. Set an absolute path to an existing XATP production. To try the example with a new directory, run `node tooling/xatp/rehearsal.mjs <new-directory>` first.

```sh
node tooling/xatp/plugin/build.mjs
export XATP_WORKSPACE=/absolute/path/to/initialized-production
dsh web --dump-config >/dev/null
dsh plugin --profile web add "$PWD/tooling/xatp/plugin"
dsh web
```

Open a session, open the right sidebar and select **XATP** on its new-tab page. For a distributable package, use `npm pack ./tooling/xatp/plugin --pack-destination <existing-output-directory>` after the build and install the resulting tarball with the same profile command. The package contains the compiled host and browser modules and its Cordis patch. The build uses the repository's pinned esbuild and the browser's DSH-provided React.

The bundle enables the existing Web Browser tab. To keep its document available while using XATP, expand the right dock, enter its full-screen presentation if needed, and choose **Split**. Open XATP in one pane and Browser in the other. Changing the active tab in a single Web pane can unmount the browser document. Refresh target discovery after navigation or remount. Use an explicitly selected fixed DSH Web port when setting `XATP_DSH_ORIGIN`; omit the launch token from the origin.

To inspect enrolled browser pages, set `XATP_CDP_ENDPOINT` to a loopback Chromium debugging origin before starting DSH. The project inspector and revision tools work independently of that endpoint. For an external provider tab, open an enrolled origin in that Chromium profile. To inspect a provider inside the DSH Web Browser sidebar, use the same Chromium instance for DSH and set `XATP_DSH_ORIGIN` to its exact loopback Web origin. Use `xatp_discover` to list the enrolled document's exact capabilities. `xatp_orchestration_read/save/compile/run` use the same plan and revisions as the canvas. Start with `xatp_orchestration_run({"targetId":"updream-01","mode":"dry-run"})`. On an authenticated canvas, bind the selected editor and save the plan before using live draft preparation. Re-discover after a navigation or node selection change. The video settings binding can select MiniMax H3, read the displayed quote and configure the minimum 5 s / 768P quote. After selecting H3, discover again for `h3Modes.available` and `h3Modes.selected`. Pass an enabled mode and the same binding to `xatp_select_h3_mode` for a verified mode change. A separate `xatp_inspect` entry point reads generic tools. No submission operation is exposed. See [verified capabilities and rates](../e2e/README.md).

## Generate an inspectable ROC draft

The model can call `xatp_render_roc_draft` with the current prompt ID and version, an output draft ID, a compare-and-write version and simulated input rows. Each row is a finite score and its binary label. Two to 512 rows are accepted, with both classes represented. Give an existing draft's current version to revise it, or zero to create a new draft.

```json
{"id":"d.threshold-study","expectedVersion":0,"promptId":"p.plot","promptVersion":1,"dataClass":"simulated","rows":[[0.92,1],[0.61,0],[0.48,1],[0.2,0]]}
```

The resulting record identifies the exact prompt revision and stores the SVG, UTF-8 JSON sample data and executing renderer module by SHA-256 digest. The chart labels the actual sample count, class balance and illustrative purpose. To reproduce it, import `renderDraft` from the archived module and pass it the parsed sample array. Submission and shot export continue to check the selected prompt's evidence chain.

## Verify

```sh
node tooling/xatp/plugin/build.mjs
node --test tooling/xatp/plugin/host.test.mjs
CHROMIUM_BIN=/path/to/chromium node --test tooling/xatp/e2e/native-panel.test.mjs
```

The first test runs the packaged host in a Cordis Context with DSH's native tool executor. To also inspect a real enrolled provider tab, set `XATP_CDP_ENDPOINT` and `XATP_TEST_PUBLIC_PROVIDER=updream`. If a public preview is open, `XATP_TEST_PUBLIC_PREVIEW=1` reports available media dimensions and duration. The browser test starts the built Web profile with the bundle in a fresh home.

On 2026-11-06 the native executor listed an external, signed-out Chromium tab for the [published Updream example](https://www.updream.cn/skills/guide-first-video-v7/examples/default). Discovery returned 44 entries, including the page-level tools. The executor inspected a button without clicking it. Once the test driver opened the existing preview, a separate `collect_assets` request returned video metadata for `boss-shjd.biliapi.net` (8.041667 seconds, 864 × 496, ready state 4) and one exportable link. An earlier load had not yet yielded a playable duration. This probe observed existing media and made no generation or billing request.

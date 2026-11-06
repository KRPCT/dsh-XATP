# XATP evidence workbench

This feature branch hosts the editor, a revision ledger, a semantic browser adapter and executable acceptance probes. [Issues and milestones](https://github.com/KRPCT/dsh-XATP/issues/1) track production work. The [domain glossary](CONTEXT.md) fixes the user-facing vocabulary. The [Agent Note](../../.agents/notes/proposed/architecture/2026-11-06-xatp-evidence-workbench.md) records evidence ownership.

For the installed DSH Web experience use the [native bundle](plugin/README.md). It contributes a persistent right-sidebar tab, seven Agent tools and a shared host service. Each opt-in Host selects one production at startup. A dedicated Chromium debugging endpoint is explicit. For the DSH Web Browser iframe, the Host also needs its exact loopback Web origin. The Electron view has a separate carrier.

## Rehearse one shot

Use Node 24.9 or later. The illustrative data contains no patient records. The paper is real, the example query is a labelled rehearsal and the local renderer calls no online model.

```sh
node tooling/xatp/rehearsal-video.mjs /tmp/xatp-new-demo
node tooling/xatp/preview.mjs /tmp/xatp-new-demo /tmp/xatp-review.html
node tooling/xatp/freeze-shot.mjs /tmp/xatp-new-demo shot.01 1 /tmp/xatp-shot-01
```

Open the HTML in a modern browser. It includes the playable film, its deterministic draft, nine versioned objects, their revision links and a read-only observation from a public Updream canvas. Editing a prompt in this portable view lasts until reload. The host ledger persists edits. The video route requires FFmpeg with librsvg and libvpx-vp9. For an image-only run without FFmpeg, use `rehearsal.mjs` with a new directory. Fawcett's [paper](https://doi.org/10.1016/j.patrec.2005.10.010) supplies the ROC method. The eight synthetic scores and renderer live in `roc-renderer.mjs`. The Agent can create a draft with new simulated scores through `xatp_render_roc_draft`.

## Integration responsibilities

| Owner | Observable behavior |
| --- | --- |
| `workspace.mjs` | SQLite appends an exact revision under a compare-and-write lock. File digests bind a receipt, draft or asset to its bytes. A stale input or unreviewed claim-bearing prompt blocks dependent submission. The export freezes a shot's time range and exact ancestry. |
| `authoring.mjs` | The editor and the host use the same prompt revision and downstream invalidation rules. Only prompt text and the creative rationale are editable through this command. |
| `generation.mjs` | A provider advertises reference-image support, a provider ID, project mode and cost. The submission intent is durable before dispatch. Another call with its ID never resubmits. Recovery asks the originating provider for a matching request and retains the output bytes before editorial acceptance. Only free adapters are admitted in this slice. |
| [Browser adapter](browser/README.md) | Agent and panel inspect the same document-bound capability directory. Observation of a button does not grant a click operation. The coverage fields record page surfaces the adapter cannot inspect. |
| [Panel](ui/README.md) | Editors inspect shots, browse the dependency graph, read browser tools, revise prompts, and find affected assets. |
| [Live gate](e2e/README.md) | Readiness and release qualification have separate outputs. Missing authenticated transactions keep the release blocked. |

The SQLite file and its sibling `objects/` directory form one project backup. Keep both and take the backup with writers stopped. The local object reader currently loads complete files into memory. Large production media need a streaming object store before release. Ledger import is a trusted host operation. An untrusted prompt must never be able to supply a query receipt, approve its own factual interpretation or mark an output as visually reviewed.

## Developer verification

Run focused checks after changes. The final real-platform gate remains independently required. The Chromium test accepts `CHROMIUM_BIN` for an explicitly provisioned Chromium executable. The panel test uses the Web workspace's Playwright dependency. Preserve the repository's existing lockfile.

```sh
node --test tooling/xatp/workflow.test.mjs tooling/xatp/ui/graph.test.mjs
node --test tooling/xatp/browser/browser.test.mjs
node --test tooling/xatp/e2e/panel.test.mjs
node tooling/xatp/plugin/build.mjs
node --test tooling/xatp/plugin/host.test.mjs
node --test tooling/xatp/e2e/native-panel.test.mjs
node tooling/xatp/e2e/live-gate.mjs
```

Before changing the client, follow the repository's [UI review skill](../../.agents/skills/dsh-client-ui-ux/SKILL.md). Before pushing, use its [pre-push skill](../../.agents/skills/dsh-pre-push-checks/SKILL.md). Capture actual public-page observations separately from the local fixtures and the final authenticated E2E.

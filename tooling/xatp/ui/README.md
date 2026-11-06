# XATP workbench panel

Load `workbench.css` beside the host UI and call `mountWorkbench(container, actions)` from `workbench.mjs`. The panel adopts DSH theme tokens, uses its container width to arrange the catalog and inspector, and owns only its container. The host remains responsible for project selection, access, transport and file storage.

| Action or option | Data |
| --- | --- |
| `read()` | Resolves to the full revision snapshot from [the workspace ledger](../workspace.mjs). Record inputs contain exact `id` and `version` pairs. Only explicit `mode: 'demo'` displays the rehearsal badge. |
| `listTabs()`, `discover(binding)`, `inspect(binding)` | Delegate to [the browser adapter](../browser/README.md) methods `listTabs`, `discover` and `invoke`. The adapter owns origin checks, live document matching and operation policy. With no browser connection, the optional `observation` input displays the dated [public canvas record](../browser/observations.json). |
| `editPrompt({id, expectedVersion, text, creativeRationale})` | Optional optimistic append. Return the saved `{id, version}`. The host preserves input references and rejects stale writes. Set `editScope: 'session'` for a temporary offline edit. |
| `previewURL(digest)` | Optional synchronous resolver for a verified content digest. Return a same-origin HTTP(S) URL, a same-origin object URL or an absent value. Cache object URLs for the mounted panel, then revoke them on host teardown. |
| `locale`, `theme` | Optional host locale and explicit `light` or `dark` appearance. Without a locale the document language selects the text. Without an appearance override the panel inherits DSH tokens and the system scheme. |

The returned handle exposes async `refresh()` for committed project changes and `destroy()` for host disposal. Browser navigation invalidates prior discovery and invocation results. No browser or record data is seeded by the panel.

Shots show timeline placement and the closest previewable upstream record. The workflow canvas shows the selected revision between its immediate inputs and uses. Select a node to navigate. Full edge lists below the canvas retain larger fan-outs. The inspector can jump to original queries and related shots transitively. The asset directory pages concepts, prompts, drafts and assets. Historical versions remain accessible from the version picker. Searching narrows the active directory.

The prompt editor saves a new revision. A conflict keeps the working draft pinned to its original revision. Selecting a different record and returning restores the draft while the panel stays mounted.

Browser tools are discovered on a selected provider tab. Each result documents its role, form, disabled state and read operations. Only `inspect`, `read_link`, `collect_assets` and `collect_citations` are available. Selecting an operation passes the bound tab, adapter, document and tool identities to the host. A failed read requires fresh discovery. Content returned from providers is rendered as text.

Tab reaches controls in document order. The view navigation also accepts Left, Right, Home and End. Activating a record focuses its title. The inspector's Back and Forward controls traverse selected revisions. Browser search retains focus while results update.

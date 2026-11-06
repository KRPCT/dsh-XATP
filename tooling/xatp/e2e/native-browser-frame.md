# Read an embedded Browser document from XATP

This smoke runs two real DSH sidebar panes in a temporary Web profile. Playwright supplies a local HTML document at an enrolled origin. The public Updream page has its own live acceptance record.

## Setup

1. Build and install the local plugin tarball in a fresh Web profile as in [the native panel smoke](native-panel.test.mjs). Use an initialized rehearsal for `XATP_WORKSPACE`.
2. Launch an isolated Chromium profile with loopback remote debugging, then set `XATP_CDP_ENDPOINT` to its HTTP debugging endpoint. Reserve a loopback port for DSH and set `XATP_DSH_ORIGIN` to its exact origin, for example `http://127.0.0.1:41831`.
3. Launch DSH with the picker overlay before the application arguments. The installed XATP bundle enables the native Browser tab. Open its printed authenticated URL in that same Chromium profile. Keep the process token out of logs.

```sh
node apps/cli/lib/bin.js web \
  --patch apps/web/tests/pin-browse-picker.overlay.yml \
  --host 127.0.0.1 --port 41831 --no-open
```

## Controlled document

Attach Playwright to that Chromium instance. Install the route before navigating a Browser pane. The route fulfills both fixture URLs locally and requires no provider account, proxy or TLS exception.

```js
const fixtureURL = 'https://www.updream.cn/__xatp_local_fixture__';
await context.route(fixtureURL + '*', route => route.fulfill({
  status: 200,
  contentType: 'text/html; charset=utf-8',
  body: '<title>Controlled XATP fixture</title><h1>Local fixture</h1><button>Inspect local fixture control</button>',
}));
```

Select the rehearsal workspace. Expand the right sidebar and open **XATP**. Set the sidebar to fullscreen, split its pane, and open **Browser** in the second pane. Enter the fixture URL in its address bar; keep the default sandbox enabled. The Browser document and XATP catalog need to stay mounted together. The Web Browser document is removed when another tab replaces it in that pane.

| Action | Expected observation |
| --- | --- |
| Inspect the DSH tab with CDP `Page.getFrameTree`, then use `DOM.getFrameOwner` and `DOM.describeNode` on the matching direct child. | The exact frame owner has `data-sidebar-browser-frame="iframe"`, the fixture `src`, and the default sandbox. `Target.getTargets` contains zero standalone Updream pages. |
| In XATP, select **Browser**, choose the embedded DSH target and select **Discover tools**. | The host response to `/api/xatp.listTabs` has one matching `surface: "dsh_web_iframe"`. Discovery returns the button plus the adapter's document tool for that target. |
| Find **Inspect local fixture control**, select it and activate **Inspect element**. | The actual host response to `/api/xatp.inspect` reports a button with that name while the iframe remains visible. |
| Keep the selected tool, then enter the same fixture URL with `-new` appended in the DSH Browser address bar. Invoke the previous **Inspect element** action. | The old iframe element is detached, the new frame has the changed `src`, and the host rejects the old binding with HTTP 400 and `stale_document`. |

The 2026-11-06 run observed all four outcomes with Chromium headless shell 153. That run explicitly enabled the Browser row with the repository’s sidebar-browser test overlay before the bundle enabled it by default. No generation, form submission or account access was exercised. Close the temporary browser and host and remove the fixture profile after the run.

# Live acceptance

Run `node tooling/xatp/e2e/live-gate.mjs` for the [#11 release decision](https://github.com/KRPCT/dsh-XATP/issues/11). This revision exits **2 (blocked)** because authenticated LeapSpace query execution, hosted Updream submission, and independent verification of provider receipts are pending. The gate performs no hosted transaction.

For a read-only environment check, run `node tooling/xatp/e2e/live-gate.mjs preflight`. Exit 0 in this mode means only that the configured host, key field and browser pages were observed. Exit 2 lists missing observations. Exit 64 indicates an unsupported command argument.

| Environment | Probe |
| --- | --- |
| `XATP_DSH_ORIGIN` | Loopback HTTP(S) origin of the running DSH Web Host. Its token-free `/connect` request must return DSH's specific 401 challenge. Supply only the origin, without the launch token. |
| `DEEPSEEK_API_KEY` | Checks whether the current process has a nonempty value. Key validity and credentials held in another process or DSH credential store require a real model turn. |
| `XATP_CDP_ENDPOINT` | Loopback Chromium debugging origin. The adapter observes both Updream and the official ScienceDirect `/leapspace` route, checking each current document. Authentication and write capability require independent transaction evidence. |

Run `node --test tooling/xatp/e2e/live-gate.test.mjs` for the rejection demonstration. It supplies a plausible local receipt, arbitrary success flags and a synthetic ready preflight. The release decision remains blocked. HTML previews, public-site inspection, screenshots and local media remain separate evidence. No parameter accepts uploaded receipts, cookies, model responses or credentials as proof of a transaction.

A future live runner must capture the actual DSH turn, LeapSpace query and cited originals, the approved Updream submission and its reconciled provider job, returned media bytes and hash, and the downstream frozen timeline/export. Missing-evidence refusal, upload, interrupted and ambiguous outcomes, revisions, and the recorded native UI review are separate checks. Publish a pass only after independent verification of those linked observations.

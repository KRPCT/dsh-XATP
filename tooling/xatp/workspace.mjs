/** Revision ledger for a single local production. The host owns evidence imports. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { markRevisions, revisePrompt } from "./authoring.mjs";

const kinds = new Set(["query", "source", "claim", "concept", "prompt", "draft", "run", "asset", "shot"]);
const file = directory => join(directory, "xatp.sqlite");
const key = ref => ref.id + "@" + ref.version;
const refOf = ({ id, version }) => ({ id, version });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/;
const nonempty = value => typeof value === "string" && value.trim().length > 0;
function check(condition, message) {
  if (!condition) throw new Error(message);
}

function open(directory, write, fn) {
  check(existsSync(file(directory)), "WORKSPACE_NOT_INITIALIZED");
  const db = new DatabaseSync(file(directory), { readOnly: !write, timeout: 4000 });
  try {
    db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
    const result = fn(db);
    db.exec("COMMIT");
    return result;
  } finally { db.close(); }
}

/** Initialize a new project. A rehearsal keeps its identity for its lifetime. */
export function initWorkspace(directory, title, mode = "project") {
  check(nonempty(title) && ["project", "demo"].includes(mode), "INVALID_PROJECT");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file(directory));
  try {
    db.exec("BEGIN IMMEDIATE; CREATE TABLE project (title TEXT NOT NULL, mode TEXT NOT NULL); CREATE TABLE revisions (id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (id,version))");
    db.prepare("INSERT INTO project VALUES (?,?)").run(title, mode);
    db.exec("COMMIT");
  } finally { db.close(); }
}

/** Content-address small receipts, drafts, and collected outputs. */
export function putBlob(directory, bytes) {
  check(existsSync(file(directory)), "WORKSPACE_NOT_INITIALIZED");
  const hash = digest(bytes), folder = join(directory, "objects");
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  try { writeFileSync(join(folder, hash), bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  readBlob(directory, hash);
  return hash;
}

/** Verify the bytes before a submission or export. */
export function readBlob(directory, hash) {
  check(typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash), "INVALID_DIGEST");
  const bytes = readFileSync(join(directory, "objects", hash));
  check(digest(bytes) === hash, "BLOB_CHANGED");
  return bytes;
}

function snapshot(db) {
  const { title, mode } = db.prepare("SELECT * FROM project").get();
  const records = db.prepare("SELECT payload FROM revisions ORDER BY rowid").all().map(r => JSON.parse(r.payload));
  return { project: { title }, mode, records:markRevisions(records) };
}

export function readWorkspace(directory) { return open(directory, false, snapshot); }

function ancestry(records, refs) {
  const byRef = new Map(records.map(r => [key(r), r])), seen = new Map(), pending = [...refs];
  while (pending.length) {
    const ref = pending.pop();
    check(ref && idPattern.test(ref.id) && Number.isSafeInteger(ref.version), "INVALID_REFERENCE");
    if (seen.has(key(ref))) continue;
    const r = byRef.get(key(ref));
    check(r, "MISSING_REFERENCE " + key(ref));
    seen.set(key(ref), r);
    pending.push(...r.inputs);
  }
  return [...seen.values()];
}

/** Compare and append under a write lock. Older revisions stay inspectable. */
export function recordRevision(directory, record, expectedVersion) {
  return open(directory, true, db => {
    const { records } = snapshot(db);
    const { id, kind, title, inputs, data } = record;
    check(typeof id === "string" && idPattern.test(id) && kinds.has(kind) && nonempty(title), "INVALID_RECORD");
    check(Array.isArray(inputs) && data && Object.getPrototypeOf(data) === Object.prototype, "INVALID_RECORD");
    const head = records.findLast(r => r.id === id);
    check((head?.version ?? 0) === expectedVersion, "VERSION_CONFLICT");
    check(!head || head.kind === kind, "KIND_CHANGED");
    const upstream = ancestry(records, inputs);
    check(!upstream.some(r => r.id === id), "DEPENDENCY_CYCLE");
    check(!upstream.some(r => r.stale), "STALE_INPUT");
    check(new Set(inputs.map(key)).size === inputs.length, "DUPLICATE_INPUT");
    if (data.blob !== undefined) readBlob(directory, data.blob);
    const result = { id, version: expectedVersion + 1, kind, title, inputs: inputs.map(refOf), data, recordedAt: new Date().toISOString() };
    db.prepare("INSERT INTO revisions VALUES (?,?,?)").run(id, result.version, JSON.stringify(result));
    return result;
  });
}

function evidenceForPrompt(directory, state, prompt) {
  check(prompt?.kind === "prompt" && !prompt.stale && nonempty(prompt.data.text), "PROMPT_REQUIRED");
  check(prompt.data.reviewStatus !== "needs-review", "PROMPT_REVIEW_REQUIRED");
  if (state.mode === "project") {
    check(nonempty(prompt.data.reviewedBy) && prompt.data.reviewedDigest === digest(JSON.stringify([prompt.data.text, prompt.data.creativeRationale, prompt.inputs])), "PROMPT_REVIEW_REQUIRED");
  }
  const graph = ancestry(state.records, prompt.inputs), byRef = new Map(graph.map(r => [key(r), r]));
  const children = (r, kind) => r.inputs.map(ref => byRef.get(key(ref))).filter(x => x.kind === kind);
  const claims = children(prompt, "claim");
  check(claims.length && nonempty(prompt.data.creativeRationale), "CLAIM_AND_RATIONALE_REQUIRED");
  for (const claim of claims) {
    check(nonempty(claim.data.statement) && nonempty(claim.data.scope), "CLAIM_SCOPE_REQUIRED");
    const sources = children(claim, "source");
    check(sources.length, "ORIGINAL_SOURCE_REQUIRED");
    for (const source of sources) {
      check(nonempty(source.data.locator) && nonempty(source.data.citation) && nonempty(source.data.reviewedBy), "SOURCE_REVIEW_REQUIRED");
      const queries = children(source, "query");
      check(queries.length, "QUERY_REQUIRED");
      for (const q of queries) {
        const origin = state.mode === "demo" ? "rehearsal" : "leapspace";
        check(q.data.provider === origin && nonempty(q.data.question) && nonempty(q.data.observedAt), "QUERY_RECEIPT_REQUIRED");
        const bytes = readBlob(directory, q.data.blob);
        if (state.mode === "project") {
          const receipt = JSON.parse(bytes.toString('utf8'));
          const url = new URL(receipt.page);
          check(url.origin === 'https://www.sciencedirect.com' && /^\/leapspace(?:\/|$)/.test(url.pathname)
            && receipt.question === q.data.question && receipt.observedAt === q.data.observedAt
            && Number.isFinite(Date.parse(receipt.observedAt)) && nonempty(receipt.answerId)
            && Array.isArray(receipt.sources) && receipt.sources.includes(source.data.url), "SOURCE_QUERY_MISMATCH");
        }
      }
    }
  }
  return claims;
}

/** Authoring never changes evidence links or preserves an old review on new wording. */
export function editPrompt(directory, args) {
  return recordRevision(directory, revisePrompt(readWorkspace(directory).records, args), args.expectedVersion);
}

function checkedDraft(prompt, draft) {
  check(draft?.kind === "draft" && !draft.stale && draft.inputs.some(r => key(r) === key(prompt)), "MATCHING_DRAFT_REQUIRED");
  check(nonempty(draft.data.dataBasis) && nonempty(draft.data.mime), "DRAFT_BASIS_REQUIRED");
}

/** Resolve the exact fact-bearing prompt and deterministic draft before submission. */
export function generationInputs(directory, promptRef, draftRef) {
  const state = readWorkspace(directory), items = ancestry(state.records, [promptRef, draftRef]);
  const prompt = items.find(r => key(r) === key(promptRef)), draft = items.find(r => key(r) === key(draftRef));
  const claims = evidenceForPrompt(directory, state, prompt);
  checkedDraft(prompt, draft);
  return { mode: state.mode, prompt, claims, draft, draftBytes: readBlob(directory, draft.data.blob) };
}

/** Freeze one timeline use with its exact submitted text, draft, output and sources. */
export function exportShot(directory, ref) {
  const state = readWorkspace(directory), records = ancestry(state.records, [ref]);
  const shot = records[0], byRef = new Map(records.map(r => [key(r), r]));
  check(shot.kind === "shot" && !shot.stale, "CURRENT_SHOT_REQUIRED");
  const { startMs, endMs } = shot.data;
  check(Number.isSafeInteger(startMs) && Number.isSafeInteger(endMs) && startMs >= 0 && endMs > startMs, "TIMECODE_REQUIRED");
  const assets = shot.inputs.map(r => byRef.get(key(r))).filter(r => r.kind === "asset");
  check(assets.length, "SHOT_ASSET_REQUIRED");
  for (const asset of assets) {
    check(nonempty(asset.data.rights) && nonempty(asset.data.reviewedBy), "ASSET_REVIEW_REQUIRED");
    readBlob(directory, asset.data.blob);
    const runs = asset.inputs.map(r => byRef.get(key(r))).filter(r => r.kind === "run");
    check(runs.length === 1 && runs[0].data.status === "accepted" && nonempty(runs[0].data.remoteId), "RUN_RECEIPT_REQUIRED");
    const run = runs[0], direct = run.inputs.map(r => byRef.get(key(r)));
    const prompt = direct.find(r => r.kind === "prompt"), draft = direct.find(r => r.kind === "draft");
    evidenceForPrompt(directory, state, prompt);
    checkedDraft(prompt, draft);
    check(run.data.text === prompt.data.text && run.data.draftHash === draft.data.blob && nonempty(run.data.provider), "SUBMISSION_INPUT_MISMATCH");
    check(asset.data.blob === run.data.outputHash, "OUTPUT_MISMATCH");
    readBlob(directory, draft.data.blob);
  }
  return { schema: 1, mode: state.mode, project: state.project, shot: refOf(shot), timeline: { startMs, endMs }, records };
}

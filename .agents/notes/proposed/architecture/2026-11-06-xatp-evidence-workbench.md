# Agent Note: Evidence ownership in the XATP workbench

Status: proposed

English | [中文](2026-11-06-xatp-evidence-workbench.zh.md)

## Problem

A finished shot needs an auditable link to a research query and the exact draft supplied to a generator. A chat response or a nearby bibliography cannot establish either relationship.

## Proposal

The project ledger owns exact revisions and their input references. A provider adapter owns observations about its page and receipts about its requests. The Agent and the client use the same admitted operations. Factual review and visual fidelity review belong to the reviewer. The delivery gate distinguishes rehearsals, observed public playback, and authenticated end-to-end runs.

## Alternatives considered

**Reconstruct the work from transcripts.** Programmatic results may stay local to one tool execution, and a transcript cannot recover missing file bytes or prove which version reached an external provider.

**Expose all page controls as executable tools.** A visible element does not convey authorization, cost, or idempotency. Enumeration records coverage while invocation checks the current document and declared semantics.

## Acceptance criteria

An editor can follow a shot to a specific query and back, edit a prompt and see only dependent outputs require review. A provider disconnect after admission permits reconciliation without a second submission. A real production run also retains the actual platform query, submitted bytes and collected video.

## Risks

Redacted URLs, embedded frames, canvas controls and asynchronous vendor changes limit what a browser adapter can attest. Until target binding, login, billing and output recovery pass on the intended host, public playback alone leaves the release open.

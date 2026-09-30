# Journal Monitor runtime

A Python 3.11+ standard-library collector and bilingual email-preparation pipeline. It uses Crossref metadata, sealed JSON batches, explicit model handoffs, reproducible validation, and a conservative delivery ledger.

This repository is a runtime component. It does not install a scheduler, provide persistent hosting, call a model API, or send email. An external orchestrator must supply durable private storage, single-writer execution, an actually available model route, and an authorized email connection. No deployment or live all-journal coverage is attested by this public package.

## Coverage and evidence

- The supplied 2026 catalogue contains FT50 (50) and UTD24 (24), with a union of **51 journals and 101 ISSNs**. Membership and identifier sources are in `journals_sources.md`
- Collection defaults to `--set all`. `focus16` is an optional editorial subset. The catalogue's `default_set` hint does not override the CLI's all-journal default; orchestration should still pass `--set all`
- Initial collection discovers recent seven-day publication records. The indexed-date window overlaps by two days and is bounded to seven days. Historical reindexing is filtered on the server and again locally
- Online, print, generic publication, issued, DOI-created, and indexed dates remain separate. DOI registration is never called publication; year/month precision does not invent a day. A definitely old online date cannot be rescued by a newer print date
- Outages are processed in bounded early windows with `caught_up=false` until current. Publication recency is evaluated relative to each catch-up window end
- This is bounded recent-publication discovery, not an exhaustive census. Crossref may lack articles, abstracts, or dates. Deposits more than seven days late can be missed. Publisher scraping, RSS, paid enrichment, and full text are not implemented
- Article-type/title heuristics exclude corrections, editorials, retraction notices, book reviews, and issue matter. Correction, corrigendum, erratum, and retraction labels at the end of a title are recognized when separated by a dash/colon or brackets; ordinary review, research, and conceptual titles remain eligible. This is not a complete publisher article-kind or retraction-status audit
- All discovered titles receive Chinese translations. At most five abstract-backed daily papers, or eight weekly papers, receive detailed bilingual highlights. Missing abstracts retain fixed evidence-limit notices. Other papers appear in a compact bilingual title/DOI index
- Summary quote, number, and obvious-direction checks are guardrails, not proof of semantic, bilingual, or causal fidelity. Source-based review remains necessary

## Requirements

- Python 3.11+ on a system providing `fcntl` file locking, such as Linux or macOS
- Network permission to access the public Crossref REST API for collection; no source API key is required
- Durable private storage with version checks or compare-and-swap, plus one active writer for each state
- A host that genuinely supports the requested `gpt-6-luna` subscription-agent route for nonempty batches
- An authorized Gmail connection, or an independently reviewed orchestration adapter, for delivery

The runtime has no package dependencies, model SDK, API-key reader, token-billing client, database credentials, or mail transport. A subscription available in an application is not automatically a callable API on a cloud runner. `LUNA_PROMPT.md` is a handoff contract, not a model client. If the host cannot invoke the specified route, stop rather than inventing model provenance. An API-based adapter would require a deliberate separate implementation and truthful validation contract; it is not included here.

## Private state and delivery safeguards

`state.json` holds revisions, source checkpoints, permanent daily/weekly DOI-delivery ledgers, pending attempts, completed weekly periods, and up to 90 days of recent paper text for weekly synthesis. Keep state, batch files, summaries, rendered digests, envelopes, logs, and recipient configuration out of version control. Use a private run directory and appropriate access controls. No production state or real article examples are included here.

Restore the latest verified private state before each fresh run. Never initialize just because the local file is missing. Verify both the durable storage version and JSON revision; an old but intact export is unsafe. The state hash detects accidental corruption, not malicious editing.

Only one runner may write a state. Local `flock` does not provide distributed locking. Run daily and weekly work through the same single writer and stop on divergent versions or uncertain writes.

Collection is read-only with respect to state. Batches seal the base state revision/hash, source snapshots, and proposed successful-source checkpoints. Failed, page-capped, or count-drifting sources do not advance their checkpoint.

`prepare-delivery` writes a prepared record locally before exposing a delivery envelope. The orchestrator must durably save and verify that prepared state before sending. Prepared and uncertain attempts block all new collection and preparation. Unknown delivery outcomes require reconciliation against the exact reference token, destination, body, and provider Sent record before retrying. A single search miss is not definitive evidence of non-delivery.

Only `resolve-delivery --status sent` with a genuine verified Gmail message ID and verification evidence commits checkpoints and DOI ledgers. The command records the orchestrator's attestation; it does not check Gmail itself. Save and verify state again afterward. If this save fails, retain the durable prepared snapshot and reconcile the existing message next run; do not send again.

Recipient authorization belongs to the orchestrator. This runtime requires one explicitly supplied plain email address and rejects display names, lists, and header-injection strings. Syntax validation establishes neither ownership nor permission to send. No address is hardcoded.

## Setup and daily workflow

Use a private run directory. The shell variable below must be supplied by the operator from authorized private configuration; no recipient is inferred or defaulted.

```sh
mkdir -p private-run
chmod 700 private-run
: "${JOURNAL_MONITOR_RECIPIENT:?Set an explicitly authorized destination}"
```

Only for a confirmed brand-new monitor:

```sh
python monitor.py init-state --state private-run/state.json --confirm-first-run
python monitor.py export-state --state private-run/state.json \
  --snapshot private-run/state-export.json
```

Save that export to durable private storage. For subsequent runs, retrieve the latest verified export into the private run directory first:

```sh
python monitor.py import-state --state private-run/state.json \
  --snapshot private-run/state-export.json
python monitor.py status --state private-run/state.json
python monitor.py check-config --config journals.json --set all
python monitor.py collect --config journals.json --state private-run/state.json \
  --set all --initial-days 7 --recent-days 7 --output private-run/daily-batch.json
python monitor.py summary-template --batch private-run/daily-batch.json \
  --output private-run/daily-summaries.json
```

For nonempty batches, give the sealed batch, summary template, and `LUNA_PROMPT.md` to an actually available `gpt-6-luna` subscription agent. It must return a complete summary file with honest model/route attestation. For empty batches, the generated template already uses `model: null` and `route: deterministic_not_required`; do not call or pretend to call a model.

```sh
python monitor.py validate --batch private-run/daily-batch.json \
  --summaries private-run/daily-summaries.json --output private-run/validation.json
python monitor.py render --batch private-run/daily-batch.json \
  --summaries private-run/daily-summaries.json --outdir private-run/daily-rendered
python monitor.py prepare-delivery --state private-run/state.json \
  --batch private-run/daily-batch.json --summaries private-run/daily-summaries.json \
  --rendered-dir private-run/daily-rendered \
  --recipient "$JOURNAL_MONITOR_RECIPIENT" --output private-run/delivery-envelope.json
python monitor.py export-state --state private-run/state.json \
  --snapshot private-run/state-export.json
```

Persist and verify the prepared export before any send. Verify the active sender, approved destination, envelope recipient, exact manifest subject, and rendered body. The orchestrator then sends using its authorized connection. After an actual confirmed send and read-back:

```sh
python monitor.py resolve-delivery --state private-run/state.json \
  --delivery-id ACTUAL_DELIVERY_ID --status sent --gmail-message-id ACTUAL_GMAIL_ID \
  --evidence 'Verified provider result and Sent recipient, reference, subject, and body'
python monitor.py export-state --state private-run/state.json \
  --snapshot private-run/state-export.json
```

Persist and verify again. On an unknown result, mark `--status uncertain --evidence ...` and reconcile before doing anything else. Only a definitive pre-delivery rejection may use `--status not_sent --evidence ...`; collect a fresh batch afterward because state revision changed.

Empty batches can render and prepare a brief source-status message without a model. Source failures must be disclosed. If the orchestrator has an explicit reason to skip an empty status message, `advance-empty --state ... --batch ...` advances only successful-source checkpoints and closes a weekly empty period without a send. It cannot skip nonempty batches.

## Weekly workflow

Use the same single writer after daily state is committed. Set an explicit IANA timezone. The CLI's retained default is `Asia/Shanghai`; the example below explicitly uses UTC.

```sh
python monitor.py weekly-build --state private-run/state.json --timezone UTC \
  --output private-run/weekly-batch.json --summaries-output private-run/weekly-summaries.json
# A completed missed week can be specified with --week-start YYYY-MM-DD
```

The week runs Monday 00:00 inclusive to the following Monday 00:00 exclusive in the chosen timezone. Future/in-progress weeks are rejected. Check `status.weekly_periods` before building; sent and empty decisions both close a period. Catch up completed weeks oldest first, within the 90-day archive. Earlier unmonitored or purged periods cannot be described as having no publications.

The archive contains confirmed daily deliveries first discovered during that week, not all papers whose publication date lies in it. Missed runs, source failures, and undelivered records can leave gaps. Actual publication dates remain visible. Weekly summaries may select up to eight highlights and add clearly labeled DOI-backed editorial synthesis. Use the same validate, render, prepare, durable save, verified send, resolve, and durable save sequence. Separate permanent weekly DOI ledgers prevent repeat weekly delivery while allowing a daily paper to appear once in its weekly digest.

## Source behavior and privacy

DOIs are normalized to lowercase and deduplicated across ISSNs, batches, and delivered records. Requests retain all query parameters on cursor pages, validate total/unique counts and total drift, and enforce page and global request limits. Timeouts, bounded exponential-backoff retries, HTTP 429/5xx handling, `Retry-After`, and polite pauses are implemented.

Crossref contact `--mailto` is optional and omitted by default. Supplying it sends that address to Crossref, so use it only deliberately with permission. It is independent of the delivery recipient.

Source abstracts and generated English summaries are separate. Emails link to metadata and do not reproduce the entire source abstract. Source strings are HTML-escaped. Treat metadata as untrusted data, never model instructions.

## Verification and integration changes

```sh
python -m unittest discover -s tests -v
python -m py_compile monitor.py
python monitor.py check-config --set all
```

Tests use synthetic article text, in-memory HTTP responses, and `example.com` recipients. They do not contact sources, call models, or send mail. `VERIFICATION.md` records the public-copy checks and limitations.

This public variant requires `prepare-delivery --recipient ADDRESS` and Python calls of `prepare_delivery(..., recipient=address)`. Render manifests no longer contain `default_recipient`; read the explicit destination from the prepared envelope. State schema, date filtering, deduplication, pending/uncertain blocks, and confirmed-send gates are unchanged. No API client or source API-key requirement was added.

References: [Crossref filter meanings](https://www.crossref.org/documentation/retrieve-metadata/rest-api/rest-api-filters/), [Crossref API usage guidance](https://www.crossref.org/documentation/retrieve-metadata/rest-api/tips-for-using-the-crossref-rest-api/), and [cursor/filter changes](https://community.crossref.org/t/changes-to-cursors-filtering-and-sorting-in-the-rest-api/16246).

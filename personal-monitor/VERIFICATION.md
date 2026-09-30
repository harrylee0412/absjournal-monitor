# Public-copy verification

Verified 2026-09-30 UTC with Python 3.12.14.

## Completed offline checks

- `python -m unittest discover -s tests -v`: **103 tests passed**
- `python -m py_compile monitor.py`: passed
- `python monitor.py check-config --set all`: **51 journals / 101 ISSNs**, passed
- Catalogue membership and identifiers are unchanged from the source-backed catalogue; see `journals_sources.md`
- Recipient migration requires an explicit CLI argument or Python keyword; tests cover missing/invalid recipients, header injection, unchanged state on rejection, destination preservation, and absence of a rendered default destination
- Source date separation/precision, old/future publication rejection, DOI normalization/dedup, cursor/count drift, request/retry bounds, partial-source failures, abstract evidence checks, bilingual selection, HTML escaping, daily/weekly highlight bounds, calendar periods, stale state, snapshot integrity/rollback, pending/uncertain blocks, and confirmed-send commits remain covered
- Reviewed the code diff: collection/date/dedup and delivery-resolution logic are unchanged; production code changes are confined to explicit-recipient handling and removal of the rendered default recipient
- Public files were scanned for non-example email addresses, personal account markers, Library identifiers, private filesystem paths, credential-like values, real article example identifiers, and excluded runtime artifacts; none found
- Source archive files were hash-checked after copying and remain unchanged

The test suite uses synthetic article text, in-memory HTTP responses, synthetic provider confirmations, and reserved `example.com` destinations. It does not access the network, call a model, or send email. The public package includes no private state, source abstracts, live article examples, generated digest, delivery envelope, or credentials. Official catalogue/source URLs and synthetic article fixtures are intentional.

## Not established by these checks

- No live Crossref request was made as part of this public-copy preparation
- No live model invocation, mailbox verification, email delivery, full-catalogue network preflight, or durable-storage round trip was run for this public variant
- No scheduler, cloud deployment, public repository branch, or pull request was created
- Model attestation and delivery verification are orchestrator responsibilities. Automated abstract checks do not prove semantic or causal fidelity
- `fcntl` provides only a local lock. Durable version checking, single-writer orchestration, recipient authorization, and recovery after uncertain sends require external integration

Run the suite again after any edits or integration changes. The file hashes in `runtime-manifest.json` describe this reviewed package; they are not a cryptographic signature or deployment proof.

## Notice suffix regression update

- Four additional offline regression tests cover terminal correction/corrigendum/erratum/retraction labels, bracketed labels, the observed en-dash suffix shape using synthetic wording, and retention of ordinary research/review/conceptual titles.
- Rechecked 103 tests, Python compilation, and 51-journal/101-ISSN configuration.
- Source completeness semantics are unchanged: one successful sibling ISSN does not erase another ISSN failure or establish exhaustive journal coverage. Live collection outputs and editorial review notes remain private and are not part of this public package.

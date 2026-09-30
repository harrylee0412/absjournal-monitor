#!/usr/bin/env python3
"""Credential-free Crossref collection and bilingual digest handoff. Python 3.11+."""
from __future__ import annotations
import argparse
import contextlib
import copy
import datetime as dt
import email.utils
import fcntl
import hashlib
import html
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import random
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from zoneinfo import ZoneInfo

VERSION = 1
SOURCE = "https://api.crossref.org"
UTC = dt.timezone.utc
BLOCKING = {"prepared", "uncertain"}
MISSING_EN = "No source abstract is available. Findings, methods, and implications cannot be assessed from metadata alone."
INDEX_EN = "Listed for reference; not selected for a detailed summary."
INDEX_ZH = "收录于文献索引，未选为详细摘要。"
MISSING_ZH = "未获取到原文摘要，仅凭元数据无法判断研究结论、方法与启示。"
EXCLUDED = re.compile(r"^(?:correction(?:\s+to)?|corrigendum|erratum|retraction|editorial(?:\s|:|$)|book\s+review|review\s+of\s+books?|acknowledg(?:e)?ment(?:s)?|list\s+of\s+reviewers|front\s+matter|back\s+matter|issue\s+information|contents(?:\s|:|$))", re.I)
NUMBER = re.compile(r"(?<![A-Za-z0-9_])[-+−]?\d[\d,]*(?:\.\d+)?(?:\s*%)?(?![A-Za-z0-9_])")

class MonitorError(Exception):
    pass


def now_iso():
    return dt.datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_time(value):
    if not isinstance(value, str):
        raise MonitorError("Timestamp must be a string")
    try:
        value = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as e:
        raise MonitorError(f"Invalid timestamp: {value}") from e
    if value.tzinfo is None:
        raise MonitorError("Timestamp must include its timezone")
    return value.astimezone(UTC)


def iso(value):
    return value.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def canonical(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def digest(obj):
    return hashlib.sha256(canonical(obj)).hexdigest()


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(value, f, ensure_ascii=False, indent=2, sort_keys=True)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


@contextlib.contextmanager
def state_lock(path):
    """Local process lock only. Remote persistence requires single-writer/CAS."""
    lock = Path(str(path) + ".lock")
    lock.parent.mkdir(parents=True, exist_ok=True)
    with lock.open("a") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        yield


class TextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0
    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.skip += 1
        if tag in {"p", "br", "div", "jats:p", "jats:title", "title", "section"}:
            self.parts.append(" ")
    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.skip = max(0, self.skip - 1)
        self.parts.append(" ")
    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def strip_markup(value):
    p = TextParser()
    p.feed(str(value or ""))
    return re.sub(r"\s+", " ", "".join(p.parts)).strip()


def normalize_doi(value):
    value = str(value or "").strip()
    value = re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", "", value, flags=re.I)
    value = urllib.parse.unquote(value).lower().strip()
    if not re.fullmatch(r"10\.\d{4,9}/\S+", value) or any(ord(c) < 32 for c in value):
        return None
    return value


def normalize_issn(value):
    value = str(value).upper().replace("-", "").strip()
    if not re.fullmatch(r"\d{7}[\dX]", value):
        raise MonitorError(f"Invalid ISSN format: {value}")
    checksum = sum(int(c) * (8-i) for i,c in enumerate(value[:7])) + (10 if value[7] == "X" else int(value[7]))
    if checksum % 11:
        raise MonitorError(f"Invalid ISSN checksum: {value}")
    return value[:4] + "-" + value[4:]


def date_field(raw):
    if not isinstance(raw, dict):
        return None
    parts = raw.get("date-parts", [[]])[0] if raw.get("date-parts") else []
    if not parts and raw.get("date-time"):
        try:
            parts = list(parse_time(raw["date-time"]).date().timetuple()[:3])
        except MonitorError:
            return None
    if not isinstance(parts, list) or not 1 <= len(parts) <= 3 or not all(type(x) is int for x in parts):
        return None
    try:
        dt.date(parts[0], parts[1] if len(parts)>1 else 1, parts[2] if len(parts)>2 else 1)
    except (ValueError, TypeError):
        return None
    return {"value": "-".join([str(parts[0]).zfill(4)] + [str(p).zfill(2) for p in parts[1:]]),
            "precision": ["year", "month", "day"][len(parts)-1],
            "date_parts": parts,
            **({"timestamp": raw["date-time"]} if raw.get("date-time") else {})}


def date_bounds(field):
    if not field:
        return None
    p = field["date_parts"]
    start = dt.date(p[0], p[1] if len(p)>1 else 1, p[2] if len(p)>2 else 1)
    if len(p) == 3:
        end = start
    elif len(p) == 2:
        end = (dt.date(p[0]+1, 1, 1) if p[1] == 12 else dt.date(p[0], p[1]+1, 1)) - dt.timedelta(days=1)
    else:
        end = dt.date(p[0], 12, 31)
    return start, end


def make_paper(raw, journal, issn, fetched_at):
    doi = normalize_doi(raw.get("DOI"))
    if not doi:
        return None, "invalid_doi"
    if raw.get("type") != "journal-article":
        return None, "not_journal_article"
    title = strip_markup((raw.get("title") or [""])[0])
    if not title:
        return None, "missing_title"
    subtype = str(raw.get("subtype") or "").lower()
    if EXCLUDED.search(title) or subtype in {"editorial", "correction", "book-review", "retraction", "erratum"}:
        return None, "excluded_article_kind"
    if raw.get("update-to"):
        return None, "update_notice"
    dates = {key: date_field(raw.get(key)) for key in ["published-online", "published-print", "published", "issued", "created", "indexed"]}
    publication = [dates[k] for k in ("published-online", "published-print", "published", "issued") if dates[k]]
    earliest = min(publication, key=lambda d: date_bounds(d)[1]) if publication else None
    abstract = strip_markup(raw.get("abstract"))
    paper = {
        "doi": doi, "doi_url": "https://doi.org/" + urllib.parse.quote(doi, safe="/():;"),
        "title": title, "journal_id": journal["id"], "journal": journal["title"],
        "authors": [" ".join(str(a.get(k) or "").strip() for k in ("given", "family")).strip() or str(a.get("name") or "") for a in (raw.get("author") or [])],
        "crossref_type": raw.get("type"), "dates": dates, "focus16": "focus16" in journal.get("sets", []),
        "earliest_reported_publication": earliest,
        "volume": str(raw.get("volume") or ""), "issue": str(raw.get("issue") or ""),
        "pages_or_article_number": str(raw.get("page") or raw.get("article-number") or ""),
        "abstract": abstract, "abstract_source": "Crossref deposited abstract" if abstract else None,
        "evidence": {"level": "abstract" if abstract else "metadata_only", "has_abstract": bool(abstract),
                     "full_text_read": False, "article_kind": "journal-article; heuristic notice exclusions", "publication_date_known": bool(publication)},
        "provenance": {"provider": "Crossref", "issns_queried": [issn], "retrieved_at": fetched_at,
                       "record_url": SOURCE + "/works/" + urllib.parse.quote(doi, safe="")},
    }
    paper["source_hash"] = paper_hash(paper)
    return paper, None


def paper_hash(paper):
    return digest({k:v for k,v in paper.items() if k not in {"source_hash", "provenance"}})


def eligibility(paper, cutoff, as_of):
    f = paper["earliest_reported_publication"]
    known = [paper["dates"].get(k) for k in ("published-online","published-print","published","issued") if paper["dates"].get(k)]
    if any(date_bounds(d)[1] < cutoff for d in known):
        return "publication_older_than_window"
    if f:
        start, end = date_bounds(f)
        if end < cutoff:
            return "publication_older_than_window"
        if start > as_of:
            return "future_publication"
        # Coarse dates that overlap the window remain visibly imprecise.
        return None
    f = paper["dates"].get("created")
    if f and date_bounds(f)[1] >= cutoff and date_bounds(f)[0] <= as_of:
        return None
    return "no_recent_publication_or_registration_date"


def fresh_state():
    return {"schema_version": VERSION, "revision": 0, "created_at": now_iso(), "checkpoints": {}, "delivered": {"daily": {}, "weekly": {}}, "deliveries": {}, "archive": {}, "weekly_periods": {}}


def validate_state(state):
    if state.get("schema_version") != VERSION or type(state.get("revision")) is not int:
        raise MonitorError("Unsupported or malformed state; restore a verified export")
    for k in ("checkpoints", "delivered", "deliveries", "archive", "weekly_periods"):
        if not isinstance(state.get(k), dict):
            raise MonitorError(f"State missing {k}")
    for mode in ("daily", "weekly"):
        if not isinstance(state["delivered"].get(mode), dict):
            raise MonitorError("State missing mode-specific delivered DOI ledger")
    for d in state["deliveries"].values():
        if d.get("status") not in {"prepared", "uncertain", "sent", "not_sent"}:
            raise MonitorError("Unrecognized send status; refusing to risk a duplicate")
    return state


def state_read(path):
    if not Path(path).exists():
        raise MonitorError("State absent. Restore durable state first; init-state is only for a verified first run")
    return validate_state(read_json(path))


def ensure_no_pending(state):
    pending = [k for k,v in state["deliveries"].items() if v["status"] in BLOCKING]
    if pending:
        raise MonitorError("Unreconciled send blocks retry: " + ", ".join(pending))


def state_scope(mode, journal_set, issn):
    return f"{mode}:{journal_set}:{issn}"


def verify_config(config, selected=None):
    if config.get("schema_version") != VERSION or not isinstance(config.get("journals"), list):
        raise MonitorError("Malformed journal configuration")
    selected = selected or config.get("default_set", "focus16")
    ids = set()
    journals = []
    for j in config["journals"]:
        if not j.get("id") or j["id"] in ids or not j.get("title"):
            raise MonitorError("Missing/duplicate journal id or title")
        ids.add(j["id"])
        if not j.get("issns"):
            raise MonitorError(f"No ISSNs configured for {j['id']}")
        j = dict(j, issns=list(dict.fromkeys(normalize_issn(i) for i in j["issns"])))
        if selected == "all" or selected in j.get("sets", []):
            journals.append(j)
    if not journals:
        raise MonitorError(f"Journal set is empty: {selected}")
    return journals


class CrossrefClient:
    def __init__(self, timeout=25, retries=3, pause=0.25, max_requests=400, mailto=None, opener=None, sleep=time.sleep):
        self.timeout, self.retries, self.pause = timeout, retries, pause
        self.max_requests, self.requests = max_requests, 0
        self.mailto, self.opener, self.sleep = mailto, opener or urllib.request.urlopen, sleep
        self.last = None
    def fetch(self, issn, start, end, cursor, rows, pub_cutoff=None):
        # Crossref requires UTC values without a trailing Z in date filters.
        start = parse_time(start).strftime("%Y-%m-%dT%H:%M:%S")
        end = parse_time(end).strftime("%Y-%m-%dT%H:%M:%S")
        params = {"filter": f"from-index-date:{start},until-index-date:{end},type:journal-article", "rows": rows, "cursor": cursor}
        if pub_cutoff:
            params["filter"] += f",from-pub-date:{pub_cutoff}"
        if self.mailto:
            params["mailto"] = self.mailto
        url = SOURCE + "/journals/" + urllib.parse.quote(issn) + "/works?" + urllib.parse.urlencode(params)
        headers = {"Accept": "application/json", "User-Agent": "PersonalJournalMonitor/1.0" + (f" (mailto:{self.mailto})" if self.mailto else "")}
        for attempt in range(self.retries+1):
            if self.requests >= self.max_requests:
                raise MonitorError("Global request budget reached; source incomplete")
            self.requests += 1
            if self.last is not None:
                self.sleep(max(0, self.pause-(time.monotonic()-self.last)))
            self.last = time.monotonic()
            try:
                with self.opener(urllib.request.Request(url, headers=headers), timeout=self.timeout) as response:
                    data = json.load(response)
                message = data.get("message")
                if not isinstance(message, dict) or not isinstance(message.get("items"), list):
                    raise MonitorError("Malformed Crossref response: items missing")
                return message
            except urllib.error.HTTPError as e:
                if e.code not in {408, 429, 500, 502, 503, 504} or attempt == self.retries:
                    raise MonitorError(f"Crossref HTTP {e.code}") from e
                delay = 0
                retry = e.headers.get("Retry-After", "") if e.headers else ""
                try:
                    delay = float(retry)
                except ValueError:
                    try:
                        delay = (email.utils.parsedate_to_datetime(retry) - dt.datetime.now(UTC)).total_seconds()
                    except (ValueError, TypeError):
                        pass
                self.sleep(min(120, max(delay, 2**attempt + random.random())))
            except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
                if attempt == self.retries:
                    raise MonitorError(f"Crossref transport/JSON failure: {type(e).__name__}") from e
                self.sleep(2**attempt + random.random())


def fetch_window(client, issn, start, end, rows=100, max_pages=20, pub_cutoff=None):
    cursor = "*"
    seen_cursors, items = set(), []
    total = None
    for page in range(max_pages):
        if cursor in seen_cursors:
            raise MonitorError("Repeated cursor; source incomplete")
        seen_cursors.add(cursor)
        message = client.fetch(issn, start, end, cursor, rows, pub_cutoff=pub_cutoff)
        page_total = message.get("total-results", message.get("total-count"))
        if total is None:
            total = page_total
        elif page_total is not None and page_total != total:
            raise MonitorError(f"Crossref result count changed between pages: {total} to {page_total}; source incomplete")
        items.extend(message["items"])
        nxt = message.get("next-cursor")
        if len(message["items"]) < rows or not nxt:
            unique = {normalize_doi(i.get("DOI")) or digest(i) for i in items}
            if isinstance(total, int) and (len(items) != total or len(unique) != total):
                raise MonitorError(f"Crossref result count changed: expected {total}, received {len(items)}, unique {len(unique)}; window incomplete")
            return items, page+1
        cursor = nxt
    raise MonitorError(f"Page budget ({max_pages}) reached; source incomplete")


def seal_batch(batch):
    batch["batch_id"] = digest({k:v for k,v in batch.items() if k != "batch_id"})
    return batch


def validate_batch(batch):
    if batch.get("schema_version") != VERSION or batch.get("batch_id") != digest({k:v for k,v in batch.items() if k != "batch_id"}):
        raise MonitorError("Batch integrity check failed")
    seen = set()
    for p in batch.get("papers", []):
        if p["doi"] in seen or normalize_doi(p["doi"]) != p["doi"] or p.get("source_hash") != paper_hash(p):
            raise MonitorError("Paper DOI/source integrity check failed")
        seen.add(p["doi"])
    return batch


def collect(config, state, client, *, selected="all", mode="daily", at=None, initial_days=7, overlap_days=2, max_window_days=7, recent_days=7, rows=100, max_pages=20):
    validate_state(state)
    ensure_no_pending(state)
    journals = verify_config(config, selected)
    at = parse_time(at) if isinstance(at, str) else at or dt.datetime.now(UTC)
    at = at.astimezone(UTC).replace(microsecond=0)
    cutoff = (at-dt.timedelta(days=recent_days)).date()
    papers, sources, proposed, dropped = {}, [], {}, {}
    def drop(reason):
        dropped[reason] = dropped.get(reason, 0)+1
    for j in journals:
        for issn in j["issns"]:
            key = state_scope(mode, selected, issn)
            last = parse_time(state["checkpoints"][key]) if key in state["checkpoints"] else None
            if last and last > at:
                raise MonitorError("State checkpoint is in the future")
            start = last-dt.timedelta(days=overlap_days) if last else at-dt.timedelta(days=initial_days)
            if start >= at:
                raise MonitorError("State checkpoint is in the future")
            # Do not skip an outage gap. Process an early bounded window and report remaining lag.
            end = min(at, start+dt.timedelta(days=max_window_days))
            source_cutoff = (end-dt.timedelta(days=recent_days)).date()
            src = {"publication_cutoff":str(source_cutoff), "journal_id":j["id"], "journal":j["title"], "issn":issn, "from_index":iso(start), "until_index":iso(end), "status":"ok", "checkpoint_key":key, "caught_up":end == at}
            previous_papers = copy.deepcopy(papers)
            try:
                raw, pages = fetch_window(client, issn, iso(start), iso(end), rows, max_pages, pub_cutoff=str(source_cutoff))
                src.update(fetched_count=len(raw), pages=pages)
                for item in raw:
                    p, reason = make_paper(item, j, issn, iso(at))
                    if reason:
                        drop(reason); continue
                    reason = eligibility(p, source_cutoff, end.date())
                    if reason:
                        drop(reason); continue
                    if p["doi"] in state["delivered"][mode]:
                        drop("already_delivered"); continue
                    if p["doi"] in papers:
                        old = papers[p["doi"]]
                        # Prefer stronger source evidence, retain all queried ISSNs.
                        merged_issns = sorted(set(old["provenance"]["issns_queried"]+[issn]))
                        if len(p["abstract"]) > len(old["abstract"]):
                            papers[p["doi"]] = p
                        papers[p["doi"]]["provenance"]["issns_queried"] = merged_issns
                        drop("duplicate_doi"); continue
                    papers[p["doi"]] = p
                proposed[key] = iso(end)
            except (MonitorError, TypeError, ValueError, KeyError, IndexError, AttributeError) as e:
                papers = previous_papers
                src.update(status="failed", error=f"{type(e).__name__}: {e}", fetched_count=None)
            sources.append(src)
    ordered = sorted(papers.values(), key=lambda p: ((p["earliest_reported_publication"] or p["dates"]["created"] or {}).get("value", ""), p["doi"]), reverse=True)
    return seal_batch({"schema_version":VERSION, "generated_at":iso(at), "mode":mode,
        "list_version":config.get("list_version"), "journal_set":selected,
        "collection_policy":{"index_window":"bounded_with_overlap", "initial_days":initial_days, "overlap_days":overlap_days, "max_window_days":max_window_days, "recent_publication_days":recent_days, "cutoff":str(cutoff), "server_publication_filter":str(cutoff), "warning":"Recent-publication discovery only: records without Crossref publication dates and late arrivals older than the horizon may be missed. Crossref coverage/abstracts are incomplete; absence is not proof of no publication."},
        "state_revision":state["revision"], "base_state_hash":digest(state),
        "sources":sources, "source_status":"complete" if all(s["status"] == "ok" and s["caught_up"] for s in sources) else "incomplete",
        "proposed_checkpoints":proposed, "dropped_counts":dropped, "papers":ordered})


def summary_template(batch):
    validate_batch(batch)
    return {"schema_version":VERSION,"batch_id":batch["batch_id"],
        "generator":({"model":"gpt-6-luna", "route":"subscription_agent", "generated_at":None} if batch["papers"] else {"model":None, "route":"deterministic_not_required", "generated_at":now_iso()}),
        "papers":[{"doi":p["doi"],"source_hash":p["source_hash"],"evidence_level":p["evidence"]["level"],
          "title_zh":"", "selected_for_highlight":False, "themes":[], "relevance_score":None,
          "selection_reason_en":"", "selection_reason_zh":"",
          "summary_en":MISSING_EN if not p["abstract"] else INDEX_EN,
          "summary_zh":MISSING_ZH if not p["abstract"] else INDEX_ZH,
          "claims":[], "limitations_en":"", "limitations_zh":""} for p in batch["papers"]],
        "synthesis":[]}


def numbers(value):
    return {re.sub(r"\s+", "", n).replace(",", "").replace("−", "-").lstrip("+") for n in NUMBER.findall(value)}


def text_required(value, name, errors):
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{name}: nonempty text required")
        return ""
    if len(value) > 12000:
        errors.append(f"{name}: text too long")
    return value


def validate_summaries(batch, summaries):
    validate_batch(batch)
    errors, warnings = [], []
    if summaries.get("schema_version") != VERSION or summaries.get("batch_id") != batch["batch_id"]:
        errors.append("Summary schema or batch identity mismatch")
    gen = summaries.get("generator", {})
    if batch["papers"]:
        if gen.get("route") != "subscription_agent" or gen.get("model") != "gpt-6-luna":
            errors.append("Generator must attest requested gpt-6-luna subscription_agent route")
    elif gen.get("route") != "deterministic_not_required" or gen.get("model") is not None:
        errors.append("Empty batch must use deterministic_not_required with model null, not a fabricated model attestation")
    try:
        parse_time(gen.get("generated_at"))
    except MonitorError:
        errors.append("Generator generated_at timestamp required")
    by_doi = {p["doi"]:p for p in batch["papers"]}
    supplied = summaries.get("papers", [])
    if not isinstance(supplied, list):
        supplied = []; errors.append("papers must be an array")
    dois = [s.get("doi") for s in supplied if isinstance(s, dict)]
    if len(dois) != len(supplied) or len(dois) != len(set(dois)) or set(dois) != set(by_doi):
        errors.append("Exactly one summary is required for every batch DOI, no extras")
    highlights = sum(s.get("selected_for_highlight") is True for s in supplied if isinstance(s,dict))
    if highlights > (5 if batch["mode"] == "daily" else 8):
        errors.append("Too many highlights: daily limit 5, weekly limit 8")
    for s in supplied:
        if not isinstance(s, dict) or s.get("doi") not in by_doi:
            continue
        doi, p = s["doi"], by_doi[s["doi"]]
        if s.get("source_hash") != p["source_hash"] or s.get("evidence_level") != p["evidence"]["level"]:
            errors.append(f"{doi}: source hash/evidence mismatch")
        for key in ("title_zh", "summary_en", "summary_zh"):
            text_required(s.get(key), f"{doi}.{key}", errors)
        if not re.search(r"[\u3400-\u9fff]", s.get("title_zh", "")) or not re.search(r"[\u3400-\u9fff]", s.get("summary_zh", "")):
            errors.append(f"{doi}: Chinese title and summary required")
        if not re.search(r"[a-zA-Z]", s.get("summary_en", "")):
            errors.append(f"{doi}: English summary required")
        if type(s.get("selected_for_highlight")) is not bool:
            errors.append(f"{doi}: selected_for_highlight must be boolean")
        score = s.get("relevance_score")
        if score is not None and (type(score) not in (int,float) or not 0 <= score <= 100):
            errors.append(f"{doi}: relevance_score must be null or 0..100")
        if not isinstance(s.get("themes", []),list) or any(not isinstance(t,str) for t in s.get("themes",[])):
            errors.append(f"{doi}: themes must be an array of strings")
        if s.get("selected_for_highlight"):
            for key in ("selection_reason_en","selection_reason_zh"):
                text_required(s.get(key),f"{doi}.{key}",errors)
        claims = s.get("claims", [])
        if not isinstance(claims, list):
            errors.append(f"{doi}: claims must be an array"); claims = []
        if numbers(s.get("title_zh", ""))-numbers(p["title"]):
            errors.append(f"{doi}.title_zh: number absent from source title")
        for key in ("selection_reason_en","selection_reason_zh"):
            if numbers(s.get(key,""))-(numbers(p["abstract"]) | numbers(p["title"])):
                errors.append(f"{doi}.{key}: number absent from source")
        if not p["abstract"]:
            if s.get("selected_for_highlight") or s.get("summary_en") != MISSING_EN or s.get("summary_zh") != MISSING_ZH or claims or s.get("limitations_en") or s.get("limitations_zh"):
                errors.append(f"{doi}: metadata-only paper must use fixed missing-abstract text and contain no inferred analysis")
            continue
        if not s.get("selected_for_highlight"):
            if s.get("summary_en") != INDEX_EN or s.get("summary_zh") != INDEX_ZH or claims or s.get("limitations_en") or s.get("limitations_zh"):
                errors.append(f"{doi}: unselected paper must use fixed index text and no analysis")
            if numbers(s.get("title_zh", ""))-numbers(p["title"]):
                errors.append(f"{doi}.title_zh: number absent from source title")
            continue
        if not claims:
            errors.append(f"{doi}: abstract-based summary needs source-grounded claims")
        evidence_numbers = numbers(p["abstract"])
        for key in ("summary_en", "summary_zh", "limitations_en", "limitations_zh"):
            if numbers(s.get(key, ""))-evidence_numbers:
                errors.append(f"{doi}.{key}: number absent from source abstract")
        # Title translation must not introduce numbers absent from the source title.
        if numbers(s.get("title_zh", ""))-numbers(p["title"]):
            errors.append(f"{doi}.title_zh: number absent from source title")
        for i,c in enumerate(claims):
            if not isinstance(c, dict):
                errors.append(f"{doi}: malformed claim"); continue
            for key in ("en", "zh", "evidence_quote"):
                text_required(c.get(key), f"{doi}.claims[{i}].{key}", errors)
            quote = c.get("evidence_quote", "")
            if quote not in p["abstract"]:
                errors.append(f"{doi}: evidence quote must occur verbatim in source abstract")
            for key in ("en", "zh"):
                if numbers(c.get(key, ""))-numbers(quote):
                    errors.append(f"{doi}: claim number absent from its evidence quote")
            direction = c.get("direction", "not_applicable")
            if direction not in {"positive", "negative", "mixed", "null", "not_applicable"}:
                errors.append(f"{doi}: unrecognized direction")
            low = quote.lower()
            positive = bool(re.search(r"\b(increas\w*|higher|positive\w*|improv\w*|enhanc\w*|rais\w*)\b", low))
            negative = bool(re.search(r"\b(decreas\w*|lower|negative\w*|reduc\w*|declin\w*)\b", low))
            if direction == "positive" and negative and not positive or direction == "negative" and positive and not negative:
                errors.append(f"{doi}: direction contradicts obvious evidence wording")
            if direction == "not_applicable" and (positive or negative):
                warnings.append(f"{doi}: directional wording needs semantic review")
        warnings.append(f"{doi}: automated number/evidence checks do not prove bilingual or causal fidelity; review against the abstract")
    synthesis = summaries.get("synthesis", [])
    if not isinstance(synthesis, list):
        synthesis=[]; errors.append("synthesis must be an array")
    if batch["mode"] != "weekly" and synthesis:
        errors.append("Curated cross-paper synthesis is weekly-only")
    for i, section in enumerate(synthesis):
        if not isinstance(section, dict):
            errors.append("Malformed synthesis section"); continue
        for key in ("heading_en", "heading_zh", "text_en", "text_zh"):
            text_required(section.get(key), f"synthesis[{i}].{key}", errors)
        refs = section.get("source_dois", [])
        if not refs or any(d not in by_doi or not by_doi[d]["abstract"] for d in refs):
            errors.append(f"synthesis[{i}]: cite present abstract-backed DOIs only")
        source_text = " ".join(by_doi[d]["abstract"] for d in refs if d in by_doi)
        for key in ("text_en", "text_zh"):
            if numbers(section.get(key, ""))-numbers(source_text):
                errors.append(f"synthesis[{i}]: unsupported number")
        if section.get("inference_label") != "Curated synthesis / 编辑综合判断":
            errors.append(f"synthesis[{i}]: explicit inference label required")
    return {"schema_version":VERSION,"batch_id":batch["batch_id"],"summaries_hash":digest(summaries),"valid":not errors,"errors":errors,"warnings":sorted(set(warnings)),"validated_at":now_iso()}


def source_status_lines(batch):
    if batch["mode"] == "weekly":
        return ["Weekly coverage: confirmed daily deliveries first discovered in this period; collection gaps and undelivered papers are not covered.", "周报范围：本周期首次检索并已确认日报投递的文献；不涵盖采集缺口或尚未投递的记录。"]
    sources = batch["sources"]
    ok = sum(s["status"] == "ok" for s in sources)
    fail = len(sources)-ok
    lag = sum(s["status"] == "ok" and not s.get("caught_up", True) for s in sources)
    lines = [f"Crossref sources: {ok}/{len(sources)} completed; {fail} failed; {lag} still catching up.",
             f"Crossref 数据源：{ok}/{len(sources)} 完成；{fail} 个失败；{lag} 个仍在补采。"]
    for s in sources:
        if s["status"] != "ok":
            lines.append(f"FAILED / 采集失败: {s['journal']} ({s['issn']}): {s.get('error','unknown')}")
        elif not s.get("caught_up", True):
            lines.append(f"CATCHING UP / 补采中: {s['journal']} ({s['issn']}) through {s['until_index']}")
    if not batch["papers"]:
        lines.append("No eligible new records in the successfully checked sources; incomplete sources may contain papers. / 已成功检查的数据源中未发现符合条件的新记录；未完成的数据源可能仍有论文。" if batch["source_status"] != "complete" else "No eligible new records in this Crossref scan. / 本次 Crossref 检索未发现符合条件的新记录。")
    return lines


def render(batch, summaries, outdir):
    result = validate_summaries(batch, summaries)
    if not result["valid"]:
        raise MonitorError("Summary validation failed: " + "; ".join(result["errors"]))
    outdir = Path(outdir); outdir.mkdir(parents=True, exist_ok=True)
    mode_label = "Daily / 每日" if batch["mode"] == "daily" else "Weekly / 每周"
    subject = f"Journal Monitor {mode_label} · {batch['generated_at'][:10]} · {len(batch['papers'])} papers"
    token = "JM-"+batch["batch_id"][:16]
    subject += " ["+token+"]"
    status = source_status_lines(batch)
    if batch["mode"] == "daily":
        status += [f"Discovery window: recent {batch['collection_policy'].get('recent_publication_days',7)} days; this is a retrospective new-record scan, not a list of papers published today.", "检索近期发表且尚未发送的记录；首次运行包含回溯文献，不代表均为今日发表。"]
    elif batch.get("weekly_period"):
        status += ["Weekly period / 周报范围: "+batch["weekly_period"]["label"]]
    text = [subject, "", *status, "", "Coverage: Crossref deposited metadata/abstracts only. No full-text review. Dates and source availability can be incomplete.", "覆盖范围：Crossref 元数据与收录摘要；未阅读全文。日期和摘要可能不完整。", ""]
    esc = html.escape
    body = ["<!doctype html><html><head><meta charset='utf-8'></head><body style='font-family:Arial,sans-serif;max-width:800px;margin:auto;line-height:1.6;color:#202735'>", f"<h1>{esc(mode_label)} Journal Monitor</h1>"]
    body += [f"<p>{esc(line)}</p>" for line in status]
    body.append("<p>Crossref metadata and abstracts only; no full-text review.<br>仅依据 Crossref 元数据与摘要，未阅读全文。</p>")
    for section in summaries.get("synthesis", []):
        body += [f"<section><h2>{esc(section['heading_en'])}<br>{esc(section['heading_zh'])}</h2>", f"<p><em>{esc(section['inference_label'])}</em></p><p>{esc(section['text_en'])}</p><p>{esc(section['text_zh'])}</p>", "<p>Sources / 来源: " + ", ".join(f"<a href='https://doi.org/{urllib.parse.quote(d, safe='/():;')}'>{esc(d)}</a>" for d in section["source_dois"]) + "</p></section>"]
        text += [section["heading_en"], section["heading_zh"], section["inference_label"], section["text_en"], section["text_zh"], "Sources / 来源: "+", ".join(section["source_dois"]), ""]
    summaries_by = {s["doi"]:s for s in summaries["papers"]}
    ordered = sorted(batch["papers"], key=lambda p:(not summaries_by[p["doi"]].get("selected_for_highlight",False), not p.get("focus16",False),p["doi"]))
    for p in ordered:
        s = summaries_by[p["doi"]]
        if not s.get("selected_for_highlight"):
            dates = " | ".join(f"{k}: {p['dates'][k]['value'] if p['dates'][k] else 'unknown / 未知'}" for k in ("published-online", "published-print", "created"))
            note = MISSING_EN+" / "+MISSING_ZH if not p["abstract"] else INDEX_EN+" / "+INDEX_ZH
            body += [f"<div style='border-top:1px solid #eee;padding:12px 0'><a href='{esc(p['doi_url'],quote=True)}'>{esc(p['title'])}</a><br>{esc(s['title_zh'])}<br><small>{esc(p['journal'])} | {esc(p['doi'])}<br>{esc(dates)}<br>{esc(note)}</small></div>"]
            text += [p["title"],s["title_zh"],p["journal"],dates,p["doi_url"],note,""]
            continue
        dates = " | ".join(f"{k}: {p['dates'][k]['value'] if p['dates'][k] else 'unknown / 未知'}" for k in ("published-online", "published-print", "created"))
        meta = f"{p['journal']} | {', '.join(p['authors']) or 'authors unavailable'} | DOI {p['doi']}"
        level = "Source abstract available / 有原文摘要" if p["abstract"] else "Metadata only / 仅元数据"
        body += [f"<article style='border-top:1px solid #ddd;padding:18px 0'><h2><a href='{esc(p['doi_url'], quote=True)}'>{esc(p['title'])}</a></h2><h3>{esc(s['title_zh'])}</h3><p>{esc(meta)}</p><p>{esc(dates)}</p><p><strong>{esc(level)}</strong></p>",f"<h4>Generated English summary / AI 生成英文摘要</h4><p>{esc(s['summary_en'])}</p><h4>中文对应摘要 / Paired Chinese summary</h4><p>{esc(s['summary_zh'])}</p>"]
        text += [p["title"], s["title_zh"], meta, dates, level, p["doi_url"], "Generated English summary / AI 生成英文摘要:", s["summary_en"], "中文对应摘要 / Paired Chinese summary:", s["summary_zh"]]
        if s.get("selection_reason_en"):
            body += [f"<p><em>Selection rationale / AI 选读理由: {esc(s['selection_reason_en'])}<br>{esc(s['selection_reason_zh'])}</em></p>"]
            text += ["Selection rationale / AI 选读理由:",s["selection_reason_en"],s["selection_reason_zh"]]
        if s.get("limitations_en") or s.get("limitations_zh"):
            body += [f"<p><strong>Evidence limits / 证据边界</strong><br>{esc(s.get('limitations_en',''))}<br>{esc(s.get('limitations_zh',''))}</p>"]
            text += ["Evidence limits / 证据边界:",s.get("limitations_en", ""),s.get("limitations_zh", "")]
        if p["abstract"]:
            body += [f"<p><a href='{esc(p['provenance']['record_url'],quote=True)}'>Source abstract metadata (Crossref) / Crossref 原文摘要数据</a></p>"]
            text += ["Source abstract metadata (Crossref) / Crossref 原文摘要数据:",p["provenance"]["record_url"]]
        body.append("</article>"); text.append("")
    footer = "AI-generated bilingual summaries; verify with the original paper. / AI 生成双语摘要，请以原文为准。" if batch["papers"] else "Automated source status; no model-generated paper summaries were needed. / 自动化数据源状态，本次无需模型生成论文摘要。"
    body += [f"<footer>Digest reference: {token}<br>{esc(footer)}</footer></body></html>"]
    text += [f"Digest reference: {token}", footer]
    html_text = "\n".join(body); plain_text = "\n".join(text)
    (outdir/"digest.html").write_text(html_text, encoding="utf-8")
    (outdir/"digest.txt").write_text(plain_text, encoding="utf-8")
    manifest = {"schema_version":VERSION,"batch_id":batch["batch_id"],"mode":batch["mode"],"subject":subject,"reference":token,"summaries_hash":digest(summaries),"html_sha256":hashlib.sha256(html_text.encode()).hexdigest(),"text_sha256":hashlib.sha256(plain_text.encode()).hexdigest(),"rendered_at":now_iso(),"validation":result}
    write_json(outdir/"manifest.json", manifest)
    return manifest


def validate_recipient(recipient):
    """Require one explicit plain email address; never infer a destination.

    This rejects header injection, display names, and recipient lists. It does
    not establish mailbox ownership, deliverability, or permission to send.
    """
    if not isinstance(recipient, str) or len(recipient) > 254:
        raise MonitorError("Recipient must be one explicit plain email address")
    if not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+", recipient):
        raise MonitorError("Recipient must be one explicit plain email address")
    local, domain = recipient.rsplit("@", 1)
    labels = domain.split(".")
    if (len(local) > 64 or local.startswith(".") or local.endswith(".") or ".." in local
            or len(labels) < 2 or any(not label or len(label) > 63
                                    or label.startswith("-") or label.endswith("-") for label in labels)):
        raise MonitorError("Recipient must be one explicit plain email address")
    return recipient


def prepare_delivery(state, batch, summaries, rendered, *, recipient):
    validate_state(state); validate_batch(batch); ensure_no_pending(state)
    if state["revision"] != batch["state_revision"] or digest(state) != batch["base_state_hash"]:
        raise MonitorError("State changed since collection; collect/build again from restored latest state")
    check = validate_summaries(batch, summaries)
    if not check["valid"] or rendered.get("batch_id") != batch["batch_id"] or rendered.get("summaries_hash") != digest(summaries):
        raise MonitorError("Rendered output or summary validation mismatch")
    validate_recipient(recipient)
    if any(p["doi"] in state["delivered"][batch["mode"]] for p in batch["papers"]):
        raise MonitorError("Batch contains already-delivered DOIs")
    if any(d.get("batch_id") == batch["batch_id"] and d["status"] == "sent" for d in state["deliveries"].values()):
        raise MonitorError("Batch has already been sent")
    period = batch.get("weekly_period",{}).get("key")
    if period and period in state["weekly_periods"]:
        raise MonitorError("Weekly period has already been completed")
    delivery_id = str(uuid.uuid4())
    record = {"status":"prepared","prepared_at":now_iso(),"batch_generated_at":batch["generated_at"],"weekly_period":batch.get("weekly_period"),"batch_id":batch["batch_id"],"mode":batch["mode"],"recipient":recipient,"subject":rendered["subject"],"reference":rendered["reference"],"html_sha256":rendered["html_sha256"],"text_sha256":rendered["text_sha256"],"dois":[p["doi"] for p in batch["papers"]],"proposed_checkpoints":batch["proposed_checkpoints"],"archive_entries":{p["doi"]:{"paper":p,"summary":next(s for s in summaries["papers"] if s["doi"]==p["doi"])} for p in batch["papers"]}}
    state["deliveries"][delivery_id] = record
    state["revision"] += 1
    return {"delivery_id":delivery_id, **{k:v for k,v in record.items() if k not in {"archive_entries","proposed_checkpoints"}},"must_persist_before_send":True,"send_via":"authorized Gmail connector only; this program never sends"}


def finish_delivery(state, delivery_id, status, *, message_id=None, evidence=None):
    validate_state(state)
    record = state["deliveries"].get(delivery_id)
    if not record:
        raise MonitorError("Unknown delivery id")
    if record["status"] == "sent":
        if status == "sent" and record.get("gmail_message_id") == message_id:
            return record
        raise MonitorError("Delivery already sent; cannot reset it")
    if record["status"] == "not_sent":
        raise MonitorError("Closed not-sent attempt; prepare a new attempt from a fresh batch")
    if status == "sent":
        if not message_id or not evidence:
            raise MonitorError("Confirmed Gmail message ID and verification evidence are required")
        record.update(status="sent",gmail_message_id=message_id,verification_evidence=evidence,sent_at=now_iso())
        for doi in record["dois"]:
            state["delivered"][record["mode"]][doi] = {"delivery_id":delivery_id,"sent_at":record["sent_at"],"gmail_message_id":message_id}
            if record["mode"] == "daily":
                state["archive"][doi] = {**record["archive_entries"][doi],"daily_sent_at":record["sent_at"],"discovered_at":record["batch_generated_at"]}
        for k,v in record["proposed_checkpoints"].items():
            if k not in state["checkpoints"] or parse_time(v) > parse_time(state["checkpoints"][k]):
                state["checkpoints"][k] = v
        if record.get("weekly_period"):
            state["weekly_periods"][record["weekly_period"]["key"]] = {"status":"sent","delivery_id":delivery_id,"gmail_message_id":message_id}
        record.pop("archive_entries", None)
        # Retain recent paper text for weekly synthesis; permanent DOI ledger remains.
        cutoff = dt.datetime.now(UTC)-dt.timedelta(days=90)
        state["archive"] = {d:a for d,a in state["archive"].items() if parse_time(a["daily_sent_at"]) >= cutoff}
    elif status == "uncertain":
        record.update(status="uncertain",verification_evidence=evidence or "No definitive Gmail result; verify Sent before retry")
    elif status == "not_sent":
        if not evidence:
            raise MonitorError("Definitive not-sent evidence required; a search miss alone may be eventual consistency")
        record.update(status="not_sent",verification_evidence=evidence,closed_at=now_iso())
        record.pop("archive_entries",None)
    else:
        raise MonitorError("Unsupported resolution")
    state["revision"] += 1
    return record


def advance_empty(state, batch):
    validate_state(state); validate_batch(batch); ensure_no_pending(state)
    if batch["papers"]:
        raise MonitorError("Cannot advance nonempty batch without confirmed delivery")
    if state["revision"] != batch["state_revision"] or digest(state) != batch["base_state_hash"]:
        raise MonitorError("Stale batch")
    period = batch.get("weekly_period",{}).get("key")
    if period and period in state["weekly_periods"]:
        raise MonitorError("Weekly period has already been completed")
    for key,value in batch["proposed_checkpoints"].items():
        if key not in state["checkpoints"] or parse_time(value) > parse_time(state["checkpoints"][key]):
            state["checkpoints"][key] = value
    if batch.get("weekly_period"):
        state["weekly_periods"][batch["weekly_period"]["key"]] = {"status":"empty","checked_at":now_iso()}
    state["revision"] += 1
    return {"advanced_successful_sources":len(batch["proposed_checkpoints"]),"source_status":batch["source_status"],"sent":False}


def weekly_batch(state, *, at=None, timezone="Asia/Shanghai", week_start=None):
    validate_state(state); ensure_no_pending(state)
    at = parse_time(at) if isinstance(at,str) else at or dt.datetime.now(UTC)
    local = at.astimezone(ZoneInfo(timezone))
    if week_start:
        start = dt.datetime.combine(dt.date.fromisoformat(week_start),dt.time(),ZoneInfo(timezone))
        if start.weekday() != 0:
            raise MonitorError("week-start must be a Monday")
        end = start+dt.timedelta(days=7)
        if end > local:
            raise MonitorError("Cannot synthesize an unfinished calendar week")
    else:
        end = (local-dt.timedelta(days=local.weekday())).replace(hour=0,minute=0,second=0,microsecond=0)
        start = end-dt.timedelta(days=7)
    if start < local-dt.timedelta(days=90):
        raise MonitorError("Requested week predates retained archive; cannot call a purged week empty")
    entries = [a for d,a in state["archive"].items() if start <= parse_time(a.get("discovered_at",a["daily_sent_at"])) < end and d not in state["delivered"]["weekly"]]
    papers = sorted([a["paper"] for a in entries], key=lambda p:p["doi"])
    period = {"key":start.strftime("%Y-%m-%d")+"@"+timezone, "start":iso(start),"end_exclusive":iso(end),"timezone":timezone,"label":start.strftime("%Y-%m-%d %H:%M")+" to "+end.strftime("%Y-%m-%d %H:%M")+" "+timezone+" (end exclusive)"}
    if period["key"] in state["weekly_periods"]:
        raise MonitorError("Weekly period has already been completed")
    batch = seal_batch({"schema_version":VERSION,"generated_at":iso(at),"mode":"weekly","list_version":"2026","journal_set":"daily-delivered-archive","weekly_period":period,"collection_policy":{"note":"Weekly synthesis covers confirmed daily deliveries first discovered in the selected calendar week, not all publications dated that week. Failed daily collection may leave gaps."},"state_revision":state["revision"],"base_state_hash":digest(state),"sources":[],"source_status":"archive_only","proposed_checkpoints":{},"dropped_counts":{},"papers":papers})
    summaries = summary_template(batch)
    prior = {a["paper"]["doi"]:a["summary"] for a in entries}
    for summary in summaries["papers"]:
        summary["title_zh"] = prior[summary["doi"]].get("title_zh", "")
    # Weekly selection is new editorial work; do not inherit an arbitrary number
    # of daily highlights or attest that a model has already generated this batch.
    return batch, summaries


def run_cli(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    s = sub.add_parser("init-state"); s.add_argument("--state",required=True); s.add_argument("--confirm-first-run",action="store_true",required=True)
    for cmd in ("export-state","import-state"):
        s=sub.add_parser(cmd);s.add_argument("--state",required=True);s.add_argument("--snapshot",required=True)
    s=sub.add_parser("check-config");s.add_argument("--config",default="journals.json");s.add_argument("--set",default="all")
    s=sub.add_parser("collect")
    for key,default in (("config","journals.json"),("state",None),("output",None),("set","all"),("mode","daily"),("at",None),("mailto",None)):
        s.add_argument("--"+key,default=default,required=key in {"state","output"})
    for key,default in (("initial-days",7),("overlap-days",2),("max-window-days",7),("recent-days",7),("rows",100),("max-pages",20),("max-requests",400),("timeout",25),("retries",3)):
        s.add_argument("--"+key,type=int,default=default)
    s=sub.add_parser("summary-template");s.add_argument("--batch",required=True);s.add_argument("--output",required=True)
    s=sub.add_parser("validate");s.add_argument("--batch",required=True);s.add_argument("--summaries",required=True);s.add_argument("--output")
    s=sub.add_parser("render");s.add_argument("--batch",required=True);s.add_argument("--summaries",required=True);s.add_argument("--outdir",required=True)
    s=sub.add_parser("prepare-delivery");s.add_argument("--recipient",required=True,help="Explicit authorized destination; one plain email address");s.add_argument("--state",required=True);s.add_argument("--batch",required=True);s.add_argument("--summaries",required=True);s.add_argument("--rendered-dir",required=True);s.add_argument("--output",required=True)
    s=sub.add_parser("resolve-delivery");s.add_argument("--state",required=True);s.add_argument("--delivery-id",required=True);s.add_argument("--status",choices=["sent","uncertain","not_sent"],required=True);s.add_argument("--gmail-message-id");s.add_argument("--evidence")
    s=sub.add_parser("advance-empty");s.add_argument("--state",required=True);s.add_argument("--batch",required=True)
    s=sub.add_parser("weekly-build");s.add_argument("--state",required=True);s.add_argument("--output",required=True);s.add_argument("--summaries-output",required=True);s.add_argument("--at");s.add_argument("--timezone",default="Asia/Shanghai");s.add_argument("--week-start")
    s=sub.add_parser("status");s.add_argument("--state",required=True)
    args=parser.parse_args(argv);cmd=args.command
    if cmd == "check-config":
        journals=verify_config(read_json(args.config),args.set)
        return {"valid":True,"journal_count":len(journals),"issn_count":sum(len(j["issns"]) for j in journals)}
    if cmd == "init-state":
        with state_lock(args.state):
            if Path(args.state).exists():raise MonitorError("State already exists; refusing overwrite")
            write_json(args.state,fresh_state())
        return {"state":args.state,"warning":"Persist this state durably; never reinitialize to bypass a missing or uncertain send ledger"}
    if cmd in {"export-state","import-state"}:
        with state_lock(args.state):
            if cmd == "export-state":
                state=state_read(args.state);write_json(args.snapshot,{"format":"journal-monitor-state-v1","sha256":digest(state),"state":state})
            else:
                snap=read_json(args.snapshot)
                if snap.get("format")!="journal-monitor-state-v1" or digest(snap.get("state"))!=snap.get("sha256"):raise MonitorError("Snapshot checksum failed")
                state=validate_state(snap["state"])
                if Path(args.state).exists():
                    old=state_read(args.state)
                    if old["revision"]>state["revision"] or old["revision"]==state["revision"] and digest(old)!=digest(state):raise MonitorError("Refusing rollback or divergent same-revision state")
                write_json(args.state,state)
        return {"revision":state["revision"],"state_sha256":digest(state)}
    if cmd == "collect":
        if args.mode not in {"daily","weekly"}:raise MonitorError("mode must be daily or weekly")
        if not 1<=args.rows<=1000 or not 0<=args.overlap_days<args.max_window_days or not 1<=args.initial_days<=31 or not 1<=args.max_window_days<=31 or not 1<=args.recent_days<=365 or args.max_pages<1 or args.max_requests<1 or args.timeout<1 or not 0<=args.retries<=10:raise MonitorError("Invalid collection bounds; overlap must be smaller than max window")
        client=CrossrefClient(timeout=args.timeout,retries=args.retries,max_requests=args.max_requests,mailto=args.mailto)
        batch=collect(read_json(args.config),state_read(args.state),client,selected=args.set,mode=args.mode,at=args.at,initial_days=args.initial_days,overlap_days=args.overlap_days,max_window_days=args.max_window_days,recent_days=args.recent_days,rows=args.rows,max_pages=args.max_pages)
        write_json(args.output,batch)
        return {"batch_id":batch["batch_id"],"papers":len(batch["papers"]),"source_status":batch["source_status"],"failed_sources":[s for s in batch["sources"] if s["status"]!="ok"],"requests":client.requests,"output":args.output}
    if cmd == "summary-template":
        write_json(args.output,summary_template(read_json(args.batch)));return {"output":args.output}
    if cmd == "validate":
        result=validate_summaries(read_json(args.batch),read_json(args.summaries))
        if args.output:write_json(args.output,result)
        print(json.dumps(result,ensure_ascii=False,indent=2));return 0 if result["valid"] else 2
    if cmd == "render":return render(read_json(args.batch),read_json(args.summaries),args.outdir)
    if cmd == "weekly-build":
        batch,summaries=weekly_batch(state_read(args.state),at=args.at,timezone=args.timezone,week_start=args.week_start)
        write_json(args.output,batch);write_json(args.summaries_output,summaries)
        return {"papers":len(batch["papers"]),"output":args.output,"curated_synthesis_required":True}
    if cmd == "status":
        state=state_read(args.state);return {"revision":state["revision"],"checkpoints":state["checkpoints"],"delivered_counts":{m:len(v) for m,v in state["delivered"].items()},"weekly_periods":state["weekly_periods"],"blocking_sends":{k:{f:v.get(f) for f in ("status","subject","recipient","reference","prepared_at")} for k,v in state["deliveries"].items() if v["status"] in BLOCKING}}
    with state_lock(args.state):
        state=state_read(args.state)
        if cmd == "prepare-delivery":
            rd=Path(args.rendered_dir);manifest=read_json(rd/"manifest.json")
            for filename,key in (("digest.html","html_sha256"),("digest.txt","text_sha256")):
                if hashlib.sha256((rd/filename).read_bytes()).hexdigest()!=manifest[key]:raise MonitorError("Rendered body changed after validation")
            result=prepare_delivery(state,read_json(args.batch),read_json(args.summaries),manifest,recipient=args.recipient)
            write_json(args.state,state)  # Commit pending ledger before exposing envelope.
            write_json(args.output,result)
            return result
        if cmd == "resolve-delivery":result=finish_delivery(state,args.delivery_id,args.status,message_id=args.gmail_message_id,evidence=args.evidence)
        elif cmd == "advance-empty":result=advance_empty(state,read_json(args.batch))
        else:raise MonitorError("Unknown command")
        write_json(args.state,state)
        return {k:v for k,v in result.items() if k!="archive_entries"}


def main():
    try:
        result=run_cli()
        if isinstance(result,int):return result
        print(json.dumps(result,ensure_ascii=False,indent=2));return 0
    except (MonitorError,KeyError,TypeError,ValueError,OSError) as e:
        print(json.dumps({"error":str(e),"kind":type(e).__name__},ensure_ascii=False),file=sys.stderr);return 2

if __name__ == "__main__":
    sys.exit(main())

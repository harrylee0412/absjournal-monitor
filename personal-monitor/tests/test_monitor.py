"""Offline safety/regression tests for the journal-monitor pipeline.

Run with: python3 -m unittest discover -s tests -v
All sources, delivery confirmations, and HTTP responses are synthetic. No network,
email, credentials, or paid model is used by this suite.
"""
from __future__ import annotations

import copy
import datetime as dt
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import urllib.error
import urllib.parse

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("journal_monitor_under_test", ROOT / "monitor.py")
monitor = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(monitor)

RECIPIENT = "reader@example.com"
AT = "2026-09-30T09:00:00Z"
ISSN = "0002-8282"
SECOND_ISSN = "1944-7981"
ABSTRACT = "We study 120 firms. Output increased by 8% in the treatment group. Estimates are descriptive."
QUOTE = "Output increased by 8% in the treatment group."
JOURNAL = {"id": "test-journal", "title": "Synthetic Journal", "issns": [ISSN], "sets": ["focus16"]}
CONFIG = {"schema_version": 1, "list_version": "test-v1", "default_set": "all", "journals": [JOURNAL]}


def raw_paper(doi="10.1234/example", *, abstract=ABSTRACT, publication=(2026, 9, 28), **overrides):
    raw = {
        "DOI": doi,
        "type": "journal-article",
        "title": ["Synthetic evidence and output"],
        "author": [{"given": "Example", "family": "Author"}],
        "created": {"date-parts": [[2026, 9, 29]], "date-time": "2026-09-29T12:00:00Z"},
        "indexed": {"date-parts": [[2026, 9, 30]], "date-time": AT},
    }
    if publication is not None:
        raw["published-online"] = {"date-parts": [list(publication)]}
    if abstract is not None:
        raw["abstract"] = abstract
    raw.update(overrides)
    return raw


def page(items, *, total=None, cursor=None):
    result = {"items": copy.deepcopy(items)}
    if total is not None:
        result["total-results"] = total
    if cursor is not None:
        result["next-cursor"] = cursor
    return result


class FakeClient:
    """In-memory Crossref replacement supporting the publication-cutoff extension."""
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def fetch(self, issn, start, end, cursor, rows, pub_cutoff=None):
        self.calls.append({"issn": issn, "start": start, "end": end, "cursor": cursor,
                           "rows": rows, "pub_cutoff": pub_cutoff})
        if not self.responses:
            raise AssertionError("Unexpected additional source request")
        result = self.responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return copy.deepcopy(result)


def collected(raws=None, *, state=None, config=None, **kwargs):
    state = state if state is not None else monitor.fresh_state()
    raws = [raw_paper()] if raws is None else raws
    client = FakeClient([page(raws, total=len(raws))])
    batch = monitor.collect(copy.deepcopy(config or CONFIG), state, client, selected="all", at=AT, **kwargs)
    return state, batch


def valid_summaries(batch):
    result = monitor.summary_template(batch)
    result["generator"]["generated_at"] = AT
    for summary, paper in zip(result["papers"], batch["papers"]):
        summary["title_zh"] = "合成证据与产出"
        if paper["abstract"]:
            summary.update(selected_for_highlight=True, selection_reason_en="The abstract reports output evidence.",
                           selection_reason_zh="摘要报告了产出证据。",
                           summary_en=QUOTE, summary_zh="处理组的产出提高了 8%。",
                           claims=[{"en": QUOTE, "zh": "处理组的产出提高了 8%。",
                                    "evidence_quote": QUOTE, "direction": "positive"}])
    return result


class DateAndMetadataTests(unittest.TestCase):
    def make(self, raw):
        paper, reason = monitor.make_paper(raw, JOURNAL, ISSN, AT)
        self.assertIsNone(reason)
        self.assertIsNotNone(paper)
        return paper

    def test_doi_normalization_strips_resolver_and_case(self):
        variants = ["10.1234/AbC", " https://doi.org/10.1234/AbC ",
                    "http://dx.doi.org/10.1234/AbC", "DOI: 10.1234/AbC", "10.1234/Ab%43"]
        for value in variants:
            with self.subTest(value=value):
                self.assertEqual(monitor.normalize_doi(value), "10.1234/abc")
        for value in [None, "not-a-doi", "10.12/x", "10.1234/a b"]:
            self.assertIsNone(monitor.normalize_doi(value))

    def test_date_precision_is_preserved_without_invented_month_or_day(self):
        for parts, value, precision in [([2026], "2026", "year"),
                                         ([2026, 9], "2026-09", "month"),
                                         ([2026, 9, 2], "2026-09-02", "day")]:
            with self.subTest(parts=parts):
                field = monitor.date_field({"date-parts": [parts]})
                self.assertEqual(field, {"value": value, "precision": precision, "date_parts": parts})

    def test_date_bounds_handle_leap_month_and_year(self):
        self.assertEqual(monitor.date_bounds(monitor.date_field({"date-parts": [[2024, 2]]})),
                         (dt.date(2024, 2, 1), dt.date(2024, 2, 29)))
        self.assertEqual(monitor.date_bounds(monitor.date_field({"date-parts": [[2026]]})),
                         (dt.date(2026, 1, 1), dt.date(2026, 12, 31)))

    def test_invalid_dates_are_not_fabricated(self):
        for value in [None, {}, {"date-parts": [[]]}, {"date-parts": [[2026, 2, 30]]},
                      {"date-parts": [[2026, 13]]}, {"date-parts": [["2026"]]},
                      {"date-parts": [[True]]}, {"date-time": "not-a-time"}]:
            with self.subTest(value=value):
                self.assertIsNone(monitor.date_field(value))

    def test_created_and_indexed_are_not_publication_dates(self):
        paper = self.make(raw_paper(publication=None))
        self.assertIsNone(paper["earliest_reported_publication"])
        self.assertFalse(paper["evidence"]["publication_date_known"])
        self.assertEqual(paper["dates"]["created"]["value"], "2026-09-29")
        self.assertEqual(paper["dates"]["indexed"]["value"], "2026-09-30")
        self.assertIsNone(paper["dates"]["published-online"])

    def test_online_and_print_dates_are_separate_and_earliest_wins(self):
        paper = self.make(raw_paper(publication=(2026, 9, 4), **{
            "published-print": {"date-parts": [[2026, 10, 1]]},
            "issued": {"date-parts": [[2026, 9, 5]]}}))
        self.assertEqual(paper["dates"]["published-online"]["value"], "2026-09-04")
        self.assertEqual(paper["dates"]["published-print"]["value"], "2026-10-01")
        self.assertEqual(paper["earliest_reported_publication"]["value"], "2026-09-04")

    def test_fresh_index_does_not_make_old_publication_eligible(self):
        paper = self.make(raw_paper(publication=(2019, 3, 2)))
        self.assertEqual(monitor.eligibility(paper, dt.date(2026, 9, 1), dt.date(2026, 9, 30)),
                         "publication_older_than_window")
        _, batch = collected([raw_paper(publication=(2019, 3, 2))])
        self.assertEqual(batch["papers"], [])
        self.assertEqual(batch["dropped_counts"]["publication_older_than_window"], 1)

    def test_unknown_publication_with_recent_registration_remains_visibly_unknown(self):
        paper = self.make(raw_paper(publication=None))
        self.assertIsNone(monitor.eligibility(paper, dt.date(2026, 9, 1), dt.date(2026, 9, 30)))
        self.assertIsNone(paper["earliest_reported_publication"])

    def test_future_and_unregistered_unknown_publications_are_excluded(self):
        paper = self.make(raw_paper(publication=(2027, 1, 2)))
        self.assertEqual(monitor.eligibility(paper, dt.date(2026, 9, 1), dt.date(2026, 9, 30)), "future_publication")
        paper = self.make(raw_paper(publication=None, created={}))
        self.assertEqual(monitor.eligibility(paper, dt.date(2026, 9, 1), dt.date(2026, 9, 30)),
                         "no_recent_publication_or_registration_date")

    def test_coarse_month_overlap_keeps_original_precision(self):
        paper = self.make(raw_paper(publication=(2026, 9)))
        self.assertIsNone(monitor.eligibility(paper, dt.date(2026, 9, 20), dt.date(2026, 9, 30)))
        self.assertEqual(paper["earliest_reported_publication"]["value"], "2026-09")
        self.assertEqual(paper["earliest_reported_publication"]["precision"], "month")

    def test_notices_nonarticles_and_missing_dois_are_excluded(self):
        for raw, expected in [(raw_paper(doi="bad"), "invalid_doi"),
                              (raw_paper(type="book-chapter"), "not_journal_article"),
                              (raw_paper(title=[]), "missing_title"),
                              (raw_paper(title=["Correction to: earlier paper"]), "excluded_article_kind"),
                              (raw_paper(**{"update-to": [{"DOI": "10.1234/old"}]}), "update_notice")]:
            with self.subTest(expected=expected):
                paper, reason = monitor.make_paper(raw, JOURNAL, ISSN, AT)
                self.assertIsNone(paper)
                self.assertEqual(reason, expected)

    def test_terminal_notice_labels_are_excluded(self):
        for label in ("Correction", "CORRIGENDUM", "Erratum", "Retraction", "Retraction notice"):
            for delimiter in (" – ", " — ", " - ", ": "):
                with self.subTest(label=label, delimiter=delimiter):
                    paper, reason = monitor.make_paper(raw_paper(title=["Synthetic banking study" + delimiter + label]), JOURNAL, ISSN, AT)
                    self.assertIsNone(paper)
                    self.assertEqual(reason, "excluded_article_kind")

    def test_parenthesized_notice_labels_are_excluded(self):
        for suffix in (" (Correction)", " [CORRIGENDUM]", " (Erratum).", " [Retraction notice]"):
            with self.subTest(suffix=suffix):
                self.assertEqual(monitor.make_paper(raw_paper(title=["Synthetic study" + suffix]), JOURNAL, ISSN, AT)[1], "excluded_article_kind")

    def test_observed_corrigendum_title_shape_is_excluded(self):
        # Synthetic wording preserves the observed terminal en-dash label.
        raw = raw_paper(title=["Synthetic Resolution Design in Banking Groups – CORRIGENDUM"])
        self.assertEqual(monitor.make_paper(raw, JOURNAL, ISSN, AT)[1], "excluded_article_kind")

    def test_research_reviews_and_conceptual_titles_are_preserved(self):
        for title in ("An integrative review and research agenda", "A systematic review of error correction",
                      "A conceptual framework for organizational learning", "Learning from retraction notices",
                      "Forecasting: error correction", "Reviewing strategic responses"):
            with self.subTest(title=title):
                paper, reason = monitor.make_paper(raw_paper(title=[title]), JOURNAL, ISSN, AT)
                self.assertIsNone(reason)
                self.assertIsNotNone(paper)

    def test_coarse_year_cannot_hide_definitely_old_online_publication(self):
        paper = self.make(raw_paper(publication=(2026, 1, 4), **{"published": {"date-parts": [[2026]]}}))
        self.assertEqual(monitor.eligibility(paper, dt.date(2026, 8, 31), dt.date(2026, 9, 30)),
                         "publication_older_than_window")

    def test_null_author_metadata_does_not_abort_collection(self):
        _, batch = collected([raw_paper(author=None)])
        self.assertEqual(batch["source_status"], "complete")
        self.assertEqual(len(batch["papers"]), 1)
        self.assertEqual(batch["papers"][0]["authors"], [])

    def test_strip_markup_removes_scripts_and_decodes_entities(self):
        self.assertEqual(monitor.strip_markup("<jats:p>A &amp; B</jats:p><script>ignore()</script>"), "A & B")


class PaginationTests(unittest.TestCase):
    def test_second_page_cursor_is_followed(self):
        first = [raw_paper("10.1234/a"), raw_paper("10.1234/b")]
        last = [raw_paper("10.1234/c")]
        client = FakeClient([page(first, total=3, cursor="cursor2"), page(last, total=3)])
        records, pages = monitor.fetch_window(client, ISSN, AT, AT, rows=2, max_pages=4)
        self.assertEqual(len(records), 3)
        self.assertEqual(pages, 2)
        self.assertEqual([call["cursor"] for call in client.calls], ["*", "cursor2"])

    def test_repeated_cursor_blocks_incomplete_source(self):
        client = FakeClient([page([raw_paper("10.1234/a"), raw_paper("10.1234/b")], total=4, cursor="*")])
        with self.assertRaisesRegex(monitor.MonitorError, "Repeated cursor"):
            monitor.fetch_window(client, ISSN, AT, AT, rows=2)

    def test_page_budget_blocks_incomplete_source(self):
        client = FakeClient([page([raw_paper("10.1234/a")], total=10, cursor="cursor2")])
        with self.assertRaisesRegex(monitor.MonitorError, "Page budget"):
            monitor.fetch_window(client, ISSN, AT, AT, rows=1, max_pages=1)

    def test_final_count_mismatch_is_failure(self):
        client = FakeClient([page([raw_paper()], total=3)])
        with self.assertRaisesRegex(monitor.MonitorError, "count"):
            monitor.fetch_window(client, ISSN, AT, AT, rows=100)

    def test_later_page_reported_count_drift_is_failure(self):
        client = FakeClient([page([raw_paper("10.1234/a"), raw_paper("10.1234/b")], total=3, cursor="cursor2"),
                             page([raw_paper("10.1234/c")], total=4)])
        with self.assertRaisesRegex(monitor.MonitorError, "count|total|changed"):
            monitor.fetch_window(client, ISSN, AT, AT, rows=2)

    def test_duplicate_doi_pages_fail_unique_count_check(self):
        client = FakeClient([page([raw_paper("10.1234/a"), raw_paper("10.1234/A")], total=2, cursor="cursor2"),
                             page([], total=2)])
        with self.assertRaisesRegex(monitor.MonitorError, "unique|duplicate"):
            monitor.fetch_window(client, ISSN, AT, AT, rows=2)

    def test_total_count_alias_is_checked(self):
        client = FakeClient([{"items": [raw_paper()], "total-count": 2}])
        with self.assertRaises(monitor.MonitorError):
            monitor.fetch_window(client, ISSN, AT, AT)

    def test_empty_success_is_distinct_from_source_failure(self):
        state, empty = collected([])
        failed = monitor.collect(CONFIG, state, FakeClient([monitor.MonitorError("Synthetic outage")]), selected="all", at=AT)
        self.assertEqual(empty["source_status"], "complete")
        self.assertEqual(empty["sources"][0]["fetched_count"], 0)
        self.assertEqual(failed["source_status"], "incomplete")
        self.assertEqual(failed["sources"][0]["status"], "failed")
        self.assertIsNone(failed["sources"][0]["fetched_count"])
        self.assertEqual(failed["proposed_checkpoints"], {})
        self.assertIn("incomplete sources may contain papers", " ".join(monitor.source_status_lines(failed)))
        self.assertNotIn("incomplete sources may contain papers", " ".join(monitor.source_status_lines(empty)))

    def test_collect_is_read_only_and_proposes_only_successful_checkpoints(self):
        config = copy.deepcopy(CONFIG)
        config["journals"][0]["issns"] = [ISSN, SECOND_ISSN]
        state = monitor.fresh_state()
        original = copy.deepcopy(state)
        client = FakeClient([page([], total=0), monitor.MonitorError("Synthetic outage")])
        batch = monitor.collect(config, state, client, selected="all", at=AT)
        self.assertEqual(state, original)
        self.assertEqual(set(batch["proposed_checkpoints"]), {monitor.state_scope("daily", "all", ISSN)})
        self.assertEqual(batch["source_status"], "incomplete")

    def test_cross_issn_dedup_prefers_abstract_and_combines_provenance(self):
        config = copy.deepcopy(CONFIG)
        config["journals"][0]["issns"] = [ISSN, SECOND_ISSN]
        client = FakeClient([page([raw_paper("https://doi.org/10.1234/ABC", abstract=None)], total=1),
                             page([raw_paper("10.1234/abc")], total=1)])
        batch = monitor.collect(config, monitor.fresh_state(), client, selected="all", at=AT)
        self.assertEqual(len(batch["papers"]), 1)
        self.assertEqual(batch["papers"][0]["doi"], "10.1234/abc")
        self.assertEqual(batch["papers"][0]["abstract"], ABSTRACT)
        self.assertEqual(set(batch["papers"][0]["provenance"]["issns_queried"]), {ISSN, SECOND_ISSN})
        self.assertEqual(batch["dropped_counts"]["duplicate_doi"], 1)
        monitor.validate_batch(batch)

    def test_previously_delivered_doi_is_not_collected_again(self):
        state = monitor.fresh_state()
        state["delivered"]["daily"]["10.1234/example"] = {"gmail_message_id": "synthetic-message"}
        _, batch = collected(state=state)
        self.assertEqual(batch["papers"], [])
        self.assertEqual(batch["dropped_counts"]["already_delivered"], 1)

    def test_collection_default_includes_journals_outside_focus_set(self):
        config = copy.deepcopy(CONFIG)
        config["journals"].append({"id": "outside-focus", "title": "Other Synthetic Journal",
                                   "issns": [SECOND_ISSN], "sets": []})
        client = FakeClient([page([], total=0), page([], total=0)])
        batch = monitor.collect(config, monitor.fresh_state(), client, at=AT)
        self.assertEqual(batch["journal_set"], "all")
        self.assertEqual({s["issn"] for s in batch["sources"]}, {ISSN, SECOND_ISSN})

    def test_future_checkpoint_is_rejected_even_when_overlap_would_hide_it(self):
        state = monitor.fresh_state()
        state["checkpoints"][monitor.state_scope("daily", "all", ISSN)] = "2026-10-01T09:00:00Z"
        client = FakeClient([page([], total=0)])
        with self.assertRaisesRegex(monitor.MonitorError, "future"):
            monitor.collect(CONFIG, state, client, selected="all", at=AT, overlap_days=2)
        self.assertEqual(client.calls, [])

    def test_backlog_uses_bounded_window_without_skipping_gap(self):
        state = monitor.fresh_state()
        key = monitor.state_scope("daily", "all", ISSN)
        state["checkpoints"][key] = "2026-09-01T09:00:00Z"
        client = FakeClient([page([], total=0)])
        batch = monitor.collect(CONFIG, state, client, selected="all", at=AT)
        self.assertEqual(client.calls[0]["start"], "2026-08-30T09:00:00Z")
        self.assertEqual(client.calls[0]["end"], "2026-09-06T09:00:00Z")
        self.assertFalse(batch["sources"][0]["caught_up"])
        self.assertEqual(batch["source_status"], "incomplete")
        self.assertEqual(state["checkpoints"][key], "2026-09-01T09:00:00Z")


class HttpClientTests(unittest.TestCase):
    def client(self, opener, **kwargs):
        return monitor.CrossrefClient(opener=opener, sleep=lambda delay: None, pause=0, **kwargs)

    def test_http_query_uses_encoded_cursor_and_index_dates(self):
        captured = []
        def opener(request, timeout):
            captured.append(request)
            return io.BytesIO(json.dumps({"message": {"items": [], "total-results": 0}}).encode())
        result = self.client(opener, retries=0).fetch(ISSN, "2026-09-29T00:00:00Z", AT, "c+2/=", 50)
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(captured[0].full_url).query)
        self.assertEqual(query["cursor"], ["c+2/="])
        self.assertIn("from-index-date:2026-09-29T00:00:00", query["filter"][0])
        self.assertIn("until-index-date:" + AT.removesuffix("Z"), query["filter"][0])
        self.assertEqual(result["items"], [])

    def test_publication_cutoff_is_sent_as_additional_filter(self):
        captured = []
        def opener(request, timeout):
            captured.append(request)
            return io.BytesIO(b'{"message":{"items":[],"total-results":0}}')
        self.client(opener, retries=0).fetch(ISSN, AT, AT, "*", 100, pub_cutoff="2026-09-23")
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(captured[0].full_url).query)
        self.assertIn("from-pub-date:2026-09-23", query["filter"][0])
        self.assertIn("from-index-date:", query["filter"][0])

    def test_transport_retry_is_bounded(self):
        opener = mock.Mock(side_effect=urllib.error.URLError("synthetic network failure"))
        client = self.client(opener, retries=2)
        with self.assertRaisesRegex(monitor.MonitorError, "transport/JSON"):
            client.fetch(ISSN, AT, AT, "*", 100)
        self.assertEqual(opener.call_count, 3)
        self.assertEqual(client.requests, 3)

    def test_request_budget_is_global(self):
        opener = mock.Mock(return_value=io.BytesIO(b'{"message":{"items":[]}}'))
        client = self.client(opener, retries=0, max_requests=1)
        client.fetch(ISSN, AT, AT, "*", 100)
        with self.assertRaisesRegex(monitor.MonitorError, "request budget"):
            client.fetch(ISSN, AT, AT, "*", 100)
        self.assertEqual(opener.call_count, 1)

    def test_malformed_response_is_not_empty_success(self):
        opener = mock.Mock(return_value=io.BytesIO(b'{"message":{"total-results":0}}'))
        with self.assertRaisesRegex(monitor.MonitorError, "Malformed Crossref"):
            self.client(opener, retries=0).fetch(ISSN, AT, AT, "*", 100)

    def test_http_429_retries_then_recovers(self):
        error = urllib.error.HTTPError("https://example.invalid", 429, "synthetic throttle", {"Retry-After": "0"}, None)
        opener = mock.Mock(side_effect=[error, io.BytesIO(b'{"message":{"items":[]}}')])
        client = self.client(opener, retries=1)
        self.assertEqual(client.fetch(ISSN, AT, AT, "*", 100)["items"], [])
        self.assertEqual(opener.call_count, 2)

    def test_nonretryable_http_error_stops(self):
        error = urllib.error.HTTPError("https://example.invalid", 404, "synthetic missing", {}, None)
        opener = mock.Mock(side_effect=error)
        with self.assertRaisesRegex(monitor.MonitorError, "HTTP 404"):
            self.client(opener, retries=3).fetch(ISSN, AT, AT, "*", 100)
        self.assertEqual(opener.call_count, 1)


class SummaryValidationTests(unittest.TestCase):
    def setUp(self):
        self.state, self.batch = collected()
        self.summaries = valid_summaries(self.batch)

    def assert_invalid(self, phrase):
        result = monitor.validate_summaries(self.batch, self.summaries)
        self.assertFalse(result["valid"], result)
        self.assertIn(phrase, " ".join(result["errors"]))

    def test_empty_template_is_deterministic_without_model_attestation(self):
        _, batch = collected([])
        summaries = monitor.summary_template(batch)
        self.assertEqual(summaries["generator"]["route"], "deterministic_not_required")
        self.assertIsNone(summaries["generator"]["model"])
        monitor.parse_time(summaries["generator"]["generated_at"])
        self.assertEqual(summaries["papers"], [])
        self.assertTrue(monitor.validate_summaries(batch, summaries)["valid"])

    def test_empty_batch_rejects_fabricated_luna_attestation(self):
        _, batch = collected([])
        summaries = monitor.summary_template(batch)
        summaries["generator"] = {"model": "gpt-6-luna", "route": "subscription_agent", "generated_at": AT}
        result = monitor.validate_summaries(batch, summaries)
        self.assertFalse(result["valid"])
        self.assertIn("fabricated model attestation", " ".join(result["errors"]))

    def test_nonempty_batch_cannot_bypass_model_route_with_deterministic_claim(self):
        self.summaries["generator"] = {"model": None, "route": "deterministic_not_required", "generated_at": AT}
        self.assert_invalid("gpt-6-luna subscription_agent")

    def test_valid_abstract_pair_passes_with_semantic_review_warning(self):
        result = monitor.validate_summaries(self.batch, self.summaries)
        self.assertTrue(result["valid"], result)
        self.assertIn("do not prove bilingual or causal fidelity", " ".join(result["warnings"]))

    def test_missing_abstract_requires_exact_bilingual_placeholders(self):
        _, batch = collected([raw_paper(abstract=None)])
        summaries = valid_summaries(batch)
        self.assertEqual(summaries["papers"][0]["summary_en"], monitor.MISSING_EN)
        self.assertEqual(summaries["papers"][0]["summary_zh"], monitor.MISSING_ZH)
        self.assertTrue(monitor.validate_summaries(batch, summaries)["valid"])
        for field, value in [("summary_en", "The study proves a causal effect."),
                             ("summary_zh", "研究证明存在因果效应。"),
                             ("limitations_en", "A small sample may limit generalization."),
                             ("claims", [{"en": "An unsupported finding"}])]:
            with self.subTest(field=field):
                altered = copy.deepcopy(summaries)
                altered["papers"][0][field] = value
                result = monitor.validate_summaries(batch, altered)
                self.assertFalse(result["valid"])
                self.assertIn("fixed missing-abstract text", " ".join(result["errors"]))

    def test_unsupported_summary_number_is_rejected(self):
        self.summaries["papers"][0]["summary_en"] = "Output increased by 99%."
        self.assert_invalid("number absent from source abstract")

    def test_unsupported_chinese_adjacent_number_is_rejected(self):
        self.summaries["papers"][0]["summary_zh"] = "处理组的产出提高了99%。"
        self.assert_invalid("number absent from source abstract")

    def test_number_extraction_handles_chinese_adjacency_sign_and_decimal(self):
        self.assertEqual(monitor.numbers("产出下降了−10.5%，样本包括1,200家企业"), {"-10.5%", "1200"})

    def test_unsupported_claim_number_is_rejected_even_if_elsewhere_in_abstract(self):
        self.summaries["papers"][0]["claims"][0]["en"] = "Output increased for 120 firms."
        self.assert_invalid("claim number absent from its evidence quote")

    def test_unsupported_title_number_is_rejected(self):
        self.summaries["papers"][0]["title_zh"] = "对 77 个国家的研究"
        self.assert_invalid("number absent from source title")

    def test_obvious_direction_mismatch_is_rejected(self):
        self.summaries["papers"][0]["claims"][0]["direction"] = "negative"
        self.assert_invalid("direction contradicts")

    def test_nonverbatim_quote_is_rejected(self):
        self.summaries["papers"][0]["claims"][0]["evidence_quote"] = "This quotation is absent."
        self.assert_invalid("must occur verbatim")

    def test_abstract_summary_without_claims_is_rejected(self):
        self.summaries["papers"][0]["claims"] = []
        self.assert_invalid("needs source-grounded claims")

    def test_exactly_one_summary_for_each_doi_is_required(self):
        self.summaries["papers"].append(copy.deepcopy(self.summaries["papers"][0]))
        self.assert_invalid("Exactly one summary")

    def test_daily_highlight_limit_is_five(self):
        _, batch = collected([raw_paper("10.1234/paper-" + str(i)) for i in range(6)])
        summaries = valid_summaries(batch)
        result = monitor.validate_summaries(batch, summaries)
        self.assertFalse(result["valid"])
        self.assertIn("Too many highlights", " ".join(result["errors"]))

    def test_unselected_abstract_uses_fixed_index_placeholder(self):
        summaries = monitor.summary_template(self.batch)
        summaries["generator"]["generated_at"] = AT
        summaries["papers"][0]["title_zh"] = "合成证据与产出"
        self.assertEqual(summaries["papers"][0]["summary_en"], monitor.INDEX_EN)
        self.assertEqual(summaries["papers"][0]["summary_zh"], monitor.INDEX_ZH)
        self.assertTrue(monitor.validate_summaries(self.batch, summaries)["valid"])
        summaries["papers"][0]["summary_en"] = QUOTE
        self.assertFalse(monitor.validate_summaries(self.batch, summaries)["valid"])

    def test_selected_highlights_require_bilingual_selection_reasons(self):
        self.summaries["papers"][0]["selection_reason_zh"] = ""
        self.assert_invalid("selection_reason_zh")

    def test_metadata_only_title_translation_cannot_invent_numbers(self):
        _, batch = collected([raw_paper(abstract=None)])
        summaries = valid_summaries(batch)
        summaries["papers"][0]["title_zh"] = "关于 99 家企业的研究"
        result = monitor.validate_summaries(batch, summaries)
        self.assertFalse(result["valid"], result)
        self.assertIn("number absent from source title", " ".join(result["errors"]))

    def test_selection_reason_cannot_introduce_unsupported_numbers(self):
        self.summaries["papers"][0]["selection_reason_en"] = "Important because it reports a 99% increase."
        self.assert_invalid("number absent from source")

    def test_source_evidence_and_hash_are_bound(self):
        self.summaries["papers"][0]["source_hash"] = "wrong"
        self.assert_invalid("source hash/evidence mismatch")

    def test_wrong_generator_route_and_missing_timestamp_are_rejected(self):
        self.summaries["generator"] = {"model": "some-paid-api-model", "route": "api"}
        self.assert_invalid("subscription_agent")
        result = monitor.validate_summaries(self.batch, self.summaries)
        self.assertIn("generated_at timestamp required", " ".join(result["errors"]))

    def test_bilingual_content_is_required(self):
        self.summaries["papers"][0]["summary_zh"] = "Only English text."
        self.assert_invalid("Chinese title and summary required")

    def test_daily_synthesis_is_rejected(self):
        self.summaries["synthesis"] = [{"heading_en": "Pattern", "heading_zh": "模式", "text_en": QUOTE,
                                        "text_zh": "产出提高", "source_dois": ["10.1234/example"],
                                        "inference_label": "Curated synthesis / 编辑综合判断"}]
        self.assert_invalid("weekly-only")

    def test_paper_or_batch_tampering_fails_integrity(self):
        altered = copy.deepcopy(self.batch)
        altered["papers"][0]["abstract"] += " Extra claim."
        with self.assertRaisesRegex(monitor.MonitorError, "Batch integrity"):
            monitor.validate_batch(altered)
        monitor.seal_batch(altered)
        with self.assertRaisesRegex(monitor.MonitorError, "source integrity"):
            monitor.validate_batch(altered)


class DeliveryStateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        self.state, self.batch = collected()
        self.summaries = valid_summaries(self.batch)
        self.manifest = monitor.render(self.batch, self.summaries, self.directory / "rendered")

    def prepare(self):
        return monitor.prepare_delivery(self.state, self.batch, self.summaries, self.manifest, recipient=RECIPIENT)

    def test_empty_daily_status_can_render_prepare_and_confirm_without_model(self):
        state, batch = collected([])
        summaries = monitor.summary_template(batch)
        self.assertEqual(summaries["generator"]["route"], "deterministic_not_required")
        manifest = monitor.render(batch, summaries, self.directory / "empty-daily")
        text = (self.directory / "empty-daily" / "digest.txt").read_text(encoding="utf-8")
        self.assertIn("No eligible new records in this Crossref scan", text)
        envelope = monitor.prepare_delivery(state, batch, summaries, manifest, recipient=RECIPIENT)
        self.assertEqual(envelope["dois"], [])
        self.assertEqual(state["checkpoints"], {})
        self.assertEqual(state["deliveries"][envelope["delivery_id"]]["status"], "prepared")
        monitor.finish_delivery(state, envelope["delivery_id"], "sent", message_id="synthetic-empty-status-id",
                                evidence="Synthetic confirmed Gmail empty-status result")
        self.assertEqual(state["checkpoints"], batch["proposed_checkpoints"])
        self.assertEqual(state["delivered"]["daily"], {})
        self.assertEqual(state["archive"], {})
        self.assertEqual(state["deliveries"][envelope["delivery_id"]]["status"], "sent")

    def test_preparing_send_does_not_advance_checkpoints_or_mark_delivered(self):
        original_checkpoints = copy.deepcopy(self.state["checkpoints"])
        envelope = self.prepare()
        self.assertTrue(envelope["must_persist_before_send"])
        self.assertEqual(self.state["deliveries"][envelope["delivery_id"]]["status"], "prepared")
        self.assertEqual(self.state["checkpoints"], original_checkpoints)
        self.assertEqual(self.state["delivered"]["daily"], {})
        self.assertEqual(self.state["archive"], {})

    def test_pending_send_blocks_collect_prepare_weekly_and_empty_advance(self):
        _, empty = collected([], state=self.state)
        self.prepare()
        for action in [lambda: monitor.collect(CONFIG, self.state, FakeClient([]), selected="all", at=AT),
                       lambda: self.prepare(),
                       lambda: monitor.weekly_batch(self.state, at=AT),
                       lambda: monitor.advance_empty(self.state, empty)]:
            with self.subTest(action=action), self.assertRaisesRegex(monitor.MonitorError, "Unreconciled send"):
                action()

    def test_uncertain_send_blocks_retry_and_never_advances(self):
        envelope = self.prepare()
        monitor.finish_delivery(self.state, envelope["delivery_id"], "uncertain", evidence="Synthetic timeout after submit")
        self.assertEqual(self.state["checkpoints"], {})
        self.assertEqual(self.state["delivered"]["daily"], {})
        self.assertEqual(self.state["archive"], {})
        with self.assertRaisesRegex(monitor.MonitorError, "Unreconciled send"):
            monitor.ensure_no_pending(self.state)

    def test_gmail_message_id_and_confirmation_evidence_are_both_required(self):
        envelope = self.prepare()
        for message_id, evidence in [(None, None), ("synthetic-gmail-id", None), (None, "Synthetic Sent readback"), ("", "")]:
            with self.subTest(message_id=message_id, evidence=evidence):
                original = copy.deepcopy(self.state)
                with self.assertRaisesRegex(monitor.MonitorError, "Confirmed Gmail message ID"):
                    monitor.finish_delivery(self.state, envelope["delivery_id"], "sent", message_id=message_id, evidence=evidence)
                self.assertEqual(self.state, original)

    def test_confirmed_delivery_commits_dois_archive_and_checkpoints_once(self):
        envelope = self.prepare()
        record = monitor.finish_delivery(self.state, envelope["delivery_id"], "sent", message_id="synthetic-gmail-id",
                                         evidence="Synthetic confirmed Gmail result and Sent readback")
        self.assertEqual(record["status"], "sent")
        self.assertIn("10.1234/example", self.state["delivered"]["daily"])
        self.assertEqual(self.state["checkpoints"], self.batch["proposed_checkpoints"])
        self.assertIn("10.1234/example", self.state["archive"])
        original = copy.deepcopy(self.state)
        monitor.finish_delivery(self.state, envelope["delivery_id"], "sent", message_id="synthetic-gmail-id", evidence="same confirmation")
        self.assertEqual(self.state, original)
        with self.assertRaisesRegex(monitor.MonitorError, "already sent"):
            monitor.finish_delivery(self.state, envelope["delivery_id"], "not_sent", evidence="contradiction")

    def test_definitive_not_sent_requires_evidence_and_leaves_delivery_uncommitted(self):
        envelope = self.prepare()
        with self.assertRaisesRegex(monitor.MonitorError, "Definitive not-sent"):
            monitor.finish_delivery(self.state, envelope["delivery_id"], "not_sent")
        monitor.finish_delivery(self.state, envelope["delivery_id"], "not_sent", evidence="Synthetic provider rejection before acceptance")
        monitor.ensure_no_pending(self.state)
        self.assertEqual(self.state["checkpoints"], {})
        self.assertEqual(self.state["delivered"]["daily"], {})
        with self.assertRaisesRegex(monitor.MonitorError, "Closed not-sent"):
            monitor.finish_delivery(self.state, envelope["delivery_id"], "sent", message_id="later", evidence="later")

    def test_state_revision_change_blocks_stale_delivery(self):
        self.state["revision"] += 1
        with self.assertRaisesRegex(monitor.MonitorError, "State changed"):
            self.prepare()
        self.assertEqual(self.state["deliveries"], {})

    def test_same_revision_state_hash_change_also_blocks_stale_delivery(self):
        self.state["checkpoints"]["synthetic-change"] = AT
        with self.assertRaisesRegex(monitor.MonitorError, "State changed"):
            self.prepare()

    def test_recipient_is_required_and_has_no_default(self):
        original = copy.deepcopy(self.state)
        with self.assertRaises(TypeError):
            monitor.prepare_delivery(self.state, self.batch, self.summaries, self.manifest)
        self.assertEqual(self.state, original)

    def test_explicit_recipient_is_preserved_in_envelope_and_pending_record(self):
        recipient = "another.reader+digest@example.com"
        envelope = monitor.prepare_delivery(self.state, self.batch, self.summaries, self.manifest, recipient=recipient)
        self.assertEqual(envelope["recipient"], recipient)
        self.assertEqual(self.state["deliveries"][envelope["delivery_id"]]["recipient"], recipient)
        self.assertNotIn("default_recipient", self.manifest)

    def test_invalid_recipient_never_mutates_state(self):
        for recipient in [None, "", " reader@example.com", "reader@example.com ",
                          "Name <reader@example.com>", "reader@example.com,other@example.com",
                          "reader@example.com\r\nBcc: other@example.com", "reader@example.com\n",
                          "reader", "reader@localhost", "reader@-invalid.example.com", "reader@invalid..example.com",
                          ".reader@example.com", "reader..name@example.com", ["reader@example.com"]]:
            with self.subTest(recipient=recipient):
                original = copy.deepcopy(self.state)
                with self.assertRaisesRegex(monitor.MonitorError, "explicit plain email address"):
                    monitor.prepare_delivery(self.state, self.batch, self.summaries, self.manifest, recipient=recipient)
                self.assertEqual(self.state, original)

    def test_cli_requires_recipient_before_reading_or_writing_state(self):
        with mock.patch.object(monitor, "state_read") as read, mock.patch.object(monitor, "write_json") as write:
            with mock.patch("sys.stderr", new=io.StringIO()), self.assertRaises(SystemExit) as error:
                monitor.run_cli(["prepare-delivery", "--state", "unused-state.json", "--batch", "unused-batch.json",
                                 "--summaries", "unused-summaries.json", "--rendered-dir", "unused-rendered",
                                 "--output", "unused-envelope.json"])
        self.assertEqual(error.exception.code, 2)
        read.assert_not_called()
        write.assert_not_called()

    def test_manifest_and_summary_mismatch_blocks_prepare(self):
        self.manifest["summaries_hash"] = "tampered"
        with self.assertRaisesRegex(monitor.MonitorError, "Rendered output or summary"):
            self.prepare()

    def test_nonempty_batch_cannot_advance_without_send(self):
        with self.assertRaisesRegex(monitor.MonitorError, "nonempty batch"):
            monitor.advance_empty(self.state, self.batch)

    def test_empty_batch_advances_only_successful_sources_without_sending(self):
        config = copy.deepcopy(CONFIG)
        config["journals"][0]["issns"] = [ISSN, SECOND_ISSN]
        batch = monitor.collect(config, self.state, FakeClient([page([], total=0), monitor.MonitorError("outage")]), selected="all", at=AT)
        result = monitor.advance_empty(self.state, batch)
        self.assertFalse(result["sent"])
        self.assertEqual(result["advanced_successful_sources"], 1)
        self.assertEqual(self.state["checkpoints"], batch["proposed_checkpoints"])
        self.assertNotIn(monitor.state_scope("daily", "all", SECOND_ISSN), self.state["checkpoints"])

    def test_stale_empty_batch_cannot_advance(self):
        _, batch = collected([], state=self.state)
        self.state["revision"] += 1
        with self.assertRaisesRegex(monitor.MonitorError, "Stale batch"):
            monitor.advance_empty(self.state, batch)

    def test_cli_persists_pending_before_exposing_send_envelope(self):
        state_path, batch_path, summary_path, envelope_path = [self.directory / name for name in
                                                             ("state.json", "batch.json", "summaries.json", "envelope.json")]
        monitor.write_json(state_path, self.state)
        monitor.write_json(batch_path, self.batch)
        monitor.write_json(summary_path, self.summaries)
        original_write = monitor.write_json
        writes = []
        def recording_write(path, value):
            writes.append(Path(path))
            original_write(path, value)
        with mock.patch.object(monitor, "write_json", side_effect=recording_write):
            envelope = monitor.run_cli(["prepare-delivery", "--recipient", RECIPIENT, "--state", str(state_path), "--batch", str(batch_path),
                                        "--summaries", str(summary_path), "--rendered-dir", str(self.directory / "rendered"),
                                        "--output", str(envelope_path)])
        self.assertEqual(writes, [state_path, envelope_path])
        restored = monitor.state_read(state_path)
        self.assertEqual(restored["deliveries"][envelope["delivery_id"]]["status"], "prepared")
        self.assertEqual(restored["checkpoints"], {})

    def test_cli_invalid_recipient_leaves_state_and_output_unchanged(self):
        state_path, batch_path, summary_path = [self.directory / name for name in ("state.json", "batch.json", "summaries.json")]
        for path, value in [(state_path, self.state), (batch_path, self.batch), (summary_path, self.summaries)]:
            monitor.write_json(path, value)
        envelope_path = self.directory / "envelope.json"
        with self.assertRaisesRegex(monitor.MonitorError, "explicit plain email address"):
            monitor.run_cli(["prepare-delivery", "--recipient", "reader@example.com\nBcc: other@example.com",
                             "--state", str(state_path), "--batch", str(batch_path),
                             "--summaries", str(summary_path), "--rendered-dir", str(self.directory / "rendered"),
                             "--output", str(envelope_path)])
        self.assertEqual(monitor.state_read(state_path), self.state)
        self.assertFalse(envelope_path.exists())

    def test_cli_refuses_body_modified_after_render(self):
        state_path, batch_path, summary_path = [self.directory / name for name in ("state.json", "batch.json", "summaries.json")]
        for path, value in [(state_path, self.state), (batch_path, self.batch), (summary_path, self.summaries)]:
            monitor.write_json(path, value)
        html_path = self.directory / "rendered" / "digest.html"
        html_path.write_text(html_path.read_text() + "tampered", encoding="utf-8")
        with self.assertRaisesRegex(monitor.MonitorError, "Rendered body changed"):
            monitor.run_cli(["prepare-delivery", "--recipient", RECIPIENT, "--state", str(state_path), "--batch", str(batch_path),
                             "--summaries", str(summary_path), "--rendered-dir", str(self.directory / "rendered"),
                             "--output", str(self.directory / "envelope.json")])
        self.assertEqual(monitor.state_read(state_path), self.state)


class WeeklyCalendarTests(unittest.TestCase):
    def setUp(self):
        self.state = monitor.fresh_state()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)

    def archive(self, suffix, discovered_at, *, sent_at=AT):
        doi = "10.1234/" + suffix
        _, batch = collected([raw_paper(doi)])
        summaries = valid_summaries(batch)
        self.state["archive"][doi] = {"paper": batch["papers"][0], "summary": summaries["papers"][0],
                                     "discovered_at": discovered_at, "daily_sent_at": sent_at}
        self.state["delivered"]["daily"][doi] = {"gmail_message_id": "synthetic-daily-id"}
        return doi

    def test_default_prior_week_is_monday_to_monday_in_shanghai(self):
        before = self.archive("before", "2026-09-20T15:59:59Z")
        start = self.archive("start", "2026-09-20T16:00:00Z")
        last = self.archive("last", "2026-09-27T15:59:59Z")
        end = self.archive("end", "2026-09-27T16:00:00Z")
        batch, summaries = monitor.weekly_batch(self.state, at=AT)
        self.assertEqual({p["doi"] for p in batch["papers"]}, {start, last})
        self.assertEqual(batch["weekly_period"]["start"], "2026-09-20T16:00:00Z")
        self.assertEqual(batch["weekly_period"]["end_exclusive"], "2026-09-27T16:00:00Z")
        self.assertEqual(batch["weekly_period"]["key"], "2026-09-21@Asia/Shanghai")
        self.assertNotEqual(batch["source_status"], "complete")
        self.assertIsNone(summaries["generator"]["generated_at"])
        self.assertFalse(monitor.validate_summaries(batch, summaries)["valid"])
        self.assertTrue(monitor.validate_summaries(batch, valid_summaries(batch))["valid"])

    def test_week_uses_discovery_date_not_late_daily_send_date(self):
        prior = self.archive("late-send", "2026-09-24T05:00:00Z", sent_at=AT)
        self.archive("old-discovery", "2026-09-18T05:00:00Z", sent_at="2026-09-24T05:00:00Z")
        batch, _ = monitor.weekly_batch(self.state, at=AT)
        self.assertEqual([p["doi"] for p in batch["papers"]], [prior])

    def test_this_week_is_not_a_rolling_seven_day_window(self):
        self.archive("monday-current", "2026-09-28T05:00:00Z")
        self.archive("tuesday-current", "2026-09-29T05:00:00Z")
        batch, _ = monitor.weekly_batch(self.state, at=AT)
        self.assertEqual(batch["papers"], [])

    def test_explicit_prior_monday_can_be_selected(self):
        doi = self.archive("earlier-week", "2026-09-09T05:00:00Z")
        batch, _ = monitor.weekly_batch(self.state, at=AT, week_start="2026-09-07")
        self.assertEqual([p["doi"] for p in batch["papers"]], [doi])
        self.assertEqual(batch["weekly_period"]["key"], "2026-09-07@Asia/Shanghai")

    def test_non_monday_and_unfinished_week_are_rejected(self):
        for date, message in [("2026-09-22", "Monday"), ("2026-09-28", "unfinished")]:
            with self.subTest(date=date), self.assertRaisesRegex(monitor.MonitorError, message):
                monitor.weekly_batch(self.state, at=AT, week_start=date)

    def test_purged_old_week_is_not_reported_as_empty(self):
        with self.assertRaisesRegex(monitor.MonitorError, "predates retained archive"):
            monitor.weekly_batch(self.state, at=AT, week_start="2026-05-04")

    def test_weekly_doi_ledger_is_independent_of_daily_and_prevents_reuse(self):
        doi = self.archive("prior", "2026-09-24T05:00:00Z")
        batch, _ = monitor.weekly_batch(self.state, at=AT)
        self.assertEqual([p["doi"] for p in batch["papers"]], [doi])
        self.state["delivered"]["weekly"][doi] = {"gmail_message_id": "synthetic-weekly-id"}
        batch, _ = monitor.weekly_batch(self.state, at=AT)
        self.assertEqual(batch["papers"], [])

    def test_confirmed_weekly_delivery_closes_period_once(self):
        doi = self.archive("prior", "2026-09-24T05:00:00Z")
        batch, template = monitor.weekly_batch(self.state, at=AT)
        self.assertIsNone(template["generator"]["generated_at"])
        summaries = valid_summaries(batch)
        manifest = monitor.render(batch, summaries, self.directory)
        envelope = monitor.prepare_delivery(self.state, batch, summaries, manifest, recipient=RECIPIENT)
        self.assertEqual(self.state["weekly_periods"], {})
        monitor.finish_delivery(self.state, envelope["delivery_id"], "sent", message_id="synthetic-weekly-id", evidence="Synthetic confirmed Sent result")
        self.assertEqual(self.state["weekly_periods"][batch["weekly_period"]["key"]]["status"], "sent")
        self.assertIn(doi, self.state["delivered"]["weekly"])
        with self.assertRaisesRegex(monitor.MonitorError, "Weekly period.*completed"):
            monitor.weekly_batch(self.state, at=AT)

    def test_weekly_highlight_limit_accepts_eight_and_rejects_nine(self):
        for i in range(9):
            self.archive("prior-" + str(i), "2026-09-24T05:00:00Z")
        batch, _ = monitor.weekly_batch(self.state, at=AT)
        summaries = valid_summaries(batch)
        result = monitor.validate_summaries(batch, summaries)
        self.assertFalse(result["valid"])
        self.assertIn("weekly limit 8", " ".join(result["errors"]))
        indexed = summaries["papers"][-1]
        indexed.update(selected_for_highlight=False, summary_en=monitor.INDEX_EN,
                       summary_zh=monitor.INDEX_ZH, claims=[], selection_reason_en="", selection_reason_zh="")
        result = monitor.validate_summaries(batch, summaries)
        self.assertTrue(result["valid"], result)

    def test_empty_week_template_also_requires_no_model(self):
        batch, summaries = monitor.weekly_batch(self.state, at=AT)
        self.assertEqual(summaries["generator"]["route"], "deterministic_not_required")
        self.assertIsNone(summaries["generator"]["model"])
        self.assertTrue(monitor.validate_summaries(batch, summaries)["valid"])

    def test_empty_week_closes_period_without_sending(self):
        batch, _ = monitor.weekly_batch(self.state, at=AT)
        result = monitor.advance_empty(self.state, batch)
        self.assertFalse(result["sent"])
        self.assertEqual(self.state["weekly_periods"][batch["weekly_period"]["key"]]["status"], "empty")
        self.assertEqual(self.state["deliveries"], {})

    def test_completed_week_cannot_be_overwritten_by_empty_advance(self):
        batch, _ = monitor.weekly_batch(self.state, at=AT)
        key = batch["weekly_period"]["key"]
        self.state["weekly_periods"][key] = {"status": "sent", "gmail_message_id": "synthetic-prior-id"}
        with self.assertRaisesRegex(monitor.MonitorError, "Weekly period.*completed"):
            monitor.weekly_batch(self.state, at=AT)
        # Exercise the independent state-transition guard on an otherwise
        # integrity-valid empty batch referring to the completed period.
        batch["state_revision"] = self.state["revision"]
        batch["base_state_hash"] = monitor.digest(self.state)
        monitor.seal_batch(batch)
        original = copy.deepcopy(self.state)
        with self.assertRaisesRegex(monitor.MonitorError, "Weekly period.*completed"):
            monitor.advance_empty(self.state, batch)
        self.assertEqual(self.state, original)

    def test_uncertain_weekly_send_does_not_close_period(self):
        self.archive("prior", "2026-09-24T05:00:00Z")
        batch, template = monitor.weekly_batch(self.state, at=AT)
        self.assertIsNone(template["generator"]["generated_at"])
        summaries = valid_summaries(batch)
        manifest = monitor.render(batch, summaries, self.directory)
        envelope = monitor.prepare_delivery(self.state, batch, summaries, manifest, recipient=RECIPIENT)
        monitor.finish_delivery(self.state, envelope["delivery_id"], "uncertain")
        self.assertEqual(self.state["weekly_periods"], {})
        self.assertEqual(self.state["delivered"]["weekly"], {})
        with self.assertRaisesRegex(monitor.MonitorError, "Unreconciled send"):
            monitor.weekly_batch(self.state, at=AT)


class RenderingAndPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)

    def test_html_escapes_untrusted_metadata_and_generated_text(self):
        state, batch = collected()
        paper = batch["papers"][0]
        paper["title"] = '<img src=x onerror="alert(1)"> & unsafe'
        paper["authors"] = ["<script>alert('author')</script>"]
        paper["journal"] = "<unsafe-journal>"
        paper["source_hash"] = monitor.paper_hash(paper)
        monitor.seal_batch(batch)
        summaries = valid_summaries(batch)
        summaries["papers"][0]["title_zh"] = "中文 <script>危险()</script>"
        summaries["papers"][0]["summary_en"] = QUOTE + " <img src=x onerror=boom>"
        monitor.render(batch, summaries, self.directory)
        rendered = (self.directory / "digest.html").read_text(encoding="utf-8")
        self.assertNotIn("<img src=x", rendered)
        self.assertNotIn("<script>", rendered)
        self.assertNotIn("<unsafe-journal>", rendered)
        self.assertIn("&lt;img", rendered)
        self.assertIn("&lt;script&gt;", rendered)
        self.assertIn("&lt;unsafe-journal&gt;", rendered)
        self.assertIn("&amp; unsafe", rendered)

    def test_rendered_dates_show_created_without_claiming_publication(self):
        _, batch = collected([raw_paper(publication=None, abstract=None)])
        monitor.render(batch, valid_summaries(batch), self.directory)
        rendered = (self.directory / "digest.txt").read_text(encoding="utf-8")
        self.assertIn("published-online: unknown / 未知", rendered)
        self.assertIn("published-print: unknown / 未知", rendered)
        self.assertIn("created: 2026-09-29", rendered)
        self.assertIn(monitor.MISSING_EN, rendered)
        self.assertIn(monitor.MISSING_ZH, rendered)

    def test_export_import_round_trip_preserves_pending_ledger(self):
        state = monitor.fresh_state()
        state["revision"] = 4
        state["deliveries"]["synthetic"] = {"status": "uncertain", "subject": "合成数据"}
        source, snapshot, destination = [self.directory / name for name in ("source.json", "snapshot.json", "restored.json")]
        monitor.write_json(source, state)
        exported = monitor.run_cli(["export-state", "--state", str(source), "--snapshot", str(snapshot)])
        imported = monitor.run_cli(["import-state", "--state", str(destination), "--snapshot", str(snapshot)])
        self.assertEqual(exported["state_sha256"], imported["state_sha256"])
        self.assertEqual(monitor.state_read(destination), state)
        with self.assertRaisesRegex(monitor.MonitorError, "Unreconciled send"):
            monitor.ensure_no_pending(monitor.state_read(destination))

    def test_corrupt_snapshot_is_rejected(self):
        source, snapshot, destination = [self.directory / name for name in ("source.json", "snapshot.json", "restored.json")]
        monitor.write_json(source, monitor.fresh_state())
        monitor.run_cli(["export-state", "--state", str(source), "--snapshot", str(snapshot)])
        corrupted = monitor.read_json(snapshot)
        corrupted["state"]["revision"] += 1
        monitor.write_json(snapshot, corrupted)
        with self.assertRaisesRegex(monitor.MonitorError, "checksum"):
            monitor.run_cli(["import-state", "--state", str(destination), "--snapshot", str(snapshot)])
        self.assertFalse(destination.exists())

    def test_import_rejects_rollback_and_same_revision_divergence(self):
        destination, snapshot = self.directory / "state.json", self.directory / "snapshot.json"
        latest = monitor.fresh_state()
        latest["revision"] = 5
        monitor.write_json(destination, latest)
        for revision in [4, 5]:
            with self.subTest(revision=revision):
                old = copy.deepcopy(latest)
                old["revision"] = revision
                old["checkpoints"]["divergent"] = AT
                monitor.write_json(snapshot, {"format": "journal-monitor-state-v1", "sha256": monitor.digest(old), "state": old})
                with self.assertRaisesRegex(monitor.MonitorError, "rollback|divergent"):
                    monitor.run_cli(["import-state", "--state", str(destination), "--snapshot", str(snapshot)])
                self.assertEqual(monitor.state_read(destination), latest)

    def test_missing_state_requires_restore_and_init_never_overwrites(self):
        path = self.directory / "state.json"
        with self.assertRaisesRegex(monitor.MonitorError, "State absent"):
            monitor.state_read(path)
        monitor.run_cli(["init-state", "--state", str(path), "--confirm-first-run"])
        before = path.read_bytes()
        with self.assertRaisesRegex(monitor.MonitorError, "already exists"):
            monitor.run_cli(["init-state", "--state", str(path), "--confirm-first-run"])
        self.assertEqual(path.read_bytes(), before)

    def test_unknown_delivery_status_is_rejected(self):
        state = monitor.fresh_state()
        state["deliveries"]["synthetic"] = {"status": "maybe_sent"}
        with self.assertRaisesRegex(monitor.MonitorError, "Unrecognized send status"):
            monitor.validate_state(state)


if __name__ == "__main__":
    unittest.main(verbosity=2)

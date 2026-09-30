# Journal catalogue provenance

Verified on 2026-09-30. `journals.json` has 51 distinct journals, 101 verified ISSNs, and the sets `ft50` (50), `utd24` (24), and `focus16` (16). Every ISSN passes the standard modulus-11 check-digit validation, and no ISSN appears under two journals.

## Ranking membership

- **2026 FT50:** Singapore Management University Libraries, [Updating your FT50 search strategies: Verified ISSNs for literature search in Scopus and Web of Science](https://library.smu.edu.sg/topics-insights/updating-your-ft50-search-strategies-verified-issns-literature-search-scopus-and), published 14 August 2026. This institutional source provides the complete 2026 list, print ISSNs, and most electronic ISSNs. It reports that the April 2026 revision added Academy of Management Annals, American Sociological Review, and Psychological Science and removed Human Relations, Journal of Business Ethics, and Organization Studies. This catalogue uses the revised list; the institutional source is not the Financial Times itself.
- **UTD24:** UT Dallas Naveen Jindal School of Management's [official research rankings overview and list of journals](https://jsom.utdallas.edu/the-utd-top-100-business-school-research-rankings/index.php). Twenty-three journals are also in the revised FT50. Its “Journal on Computing” entry is normalized to the publisher's title, **INFORMS Journal on Computing**. Therefore the union contains 50 + 24 - 23 = **51 journals**.
- Title typography is normalized: optional leading “The” follows familiar publisher titles; “Manufacturing and Service Operations Management” is represented as “Manufacturing & Service Operations Management.” ISSN matching, not title substring matching, should establish journal identity.

## Electronic ISSNs supplementing the SMU table

The catalogue supplements blank electronic-ISSN cells using publishers or the ISSN International Centre:

- Academy of Management Journal: 1948-0989; Academy of Management Review: 1930-3807. [Academy of Management subscription and library information](https://www.aom.org/publications/journal-information/subscriptions-and-library-information/) also independently confirms Annals 1941-6520 / 1941-6067
- Accounting, Organizations and Society: [1873-6289](https://portal.issn.org/resource/issn/1873-6289)
- Journal of Accounting and Economics: [1879-1980](https://portal.issn.org/resource/ISSN/1879-1980)
- Journal of Business Venturing: [1873-2003](https://portal.issn.org/resource/ISSN/1873-2003)
- Journal of Financial Economics: [1879-2774](https://portal.issn.org/resource/ISSN/1879-2774)
- MIT Sloan Management Review: [1532-8937](https://portal.issn.org/resource/ISSN/1532-8937). Its print identifier remains 1532-9194; the registry's “incorrect ISSN” annotation on the *online* record concerns applying the print identifier to that medium, not invalidating the print record
- Research Policy: [1873-7625](https://portal.issn.org/resource/ISSN/1873-7625)
- Harvard Business Review retains the verified print identifier only, [0017-8012](https://portal.issn.org/resource/ISSN/0017-8012). No separate electronic identifier is asserted
- INFORMS Journal on Computing: **1091-9856 (print), 1526-5528 (online)**, verified in [the publisher's editorial-board page](https://pubsonline.informs.org/doi/pdf/10.1287/ijoc.2024.eb.v3605) and its [journal site](https://pubsonline.informs.org/journal/ijoc)

Every journal's `source_urls` includes its membership sources and any supplemental identifier sources.

## Focus16 scope

The `focus16` subset is an optional editorial selection, not a ranking organization's official journal set:

1. Strategic Management Journal
2. Organization Science
3. Academy of Management Journal
4. Academy of Management Review
5. Administrative Science Quarterly
6. Journal of International Business Studies
7. Strategic Entrepreneurship Journal
8. Journal of Business Venturing
9. Entrepreneurship Theory and Practice
10. Research Policy
11. Journal of Management
12. Journal of Management Studies
13. Academy of Management Annals
14. Management Science
15. Information Systems Research
16. MIS Quarterly

`default_set: "focus16"` is retained as a catalogue selection/ranking hint. The CLI collection default is **all 51 journals**. Set `--set all` explicitly in orchestration so a catalogue helper cannot silently narrow collection to 16 journals.

## Operational caveats

- ISSN verification establishes journal identity, not the availability or completeness of a particular API's article feed. Each upstream's coverage still needs separate validation; zero returned records is not evidence that a journal published nothing.
- The SMU source notes that Scopus may return unrelated titles even for an ISSN filter because of indexing problems. Retain journal identity checks downstream.
- MIT's [10 September 2026 announcement](https://mitsloan.mit.edu/press/update-mit-sloan-management-review) says MIT Sloan Management Review ends print after its fall issue, continues regular digital content through November 2026, and plans a new fully digital version in winter. Preserve its current FT50 membership, but revalidate the publication's feed and identifiers when that transition occurs.

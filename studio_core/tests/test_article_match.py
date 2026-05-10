from __future__ import annotations

from studio_core.article_match import normalize_article, normalize_filename_stem


def test_normalize_article_strips_specials_and_lowercases() -> None:
    assert normalize_article("8M0095485") == "8m0095485"
    assert normalize_article("BMW-12345") == "bmw12345"
    assert normalize_article("  abc 123 ") == "abc123"
    assert normalize_article("AB-CD/EF.GH") == "abcdefgh"


def test_normalize_filename_stem_strips_extension() -> None:
    assert normalize_filename_stem("8M0095485.jpg") == "8m0095485"
    assert normalize_filename_stem("/tmp/inputs/BMW-12345.jpeg") == "bmw12345"
    assert normalize_filename_stem("part_877767K01.PNG") == "part877767k01"


def test_normalize_filename_stem_short_returns_empty() -> None:
    # too short to be a real article — caller skips matching
    assert normalize_filename_stem("a.jpg") == ""
    assert normalize_filename_stem("ab.png") == ""
    assert normalize_filename_stem("12.webp") == ""


def test_normalized_pairs_match_when_only_specials_differ() -> None:
    # the actual match is == on normalized forms
    assert normalize_article("BMW-12345") == normalize_article("bmw 12345")
    assert normalize_article("8M-0095485") == normalize_filename_stem("8M0095485.jpg")

from __future__ import annotations

import re
from pathlib import PurePosixPath

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_MIN_ARTICLE_LEN = 4


def normalize_article(s: str) -> str:
    """Lowercase + strip every non-alphanumeric char.

    Used both sides of the article match (filename stem, candidate article) to
    make the comparison case-insensitive and resistant to dashes/spaces/etc.
    """
    return _NON_ALNUM.sub("", s.lower())


def normalize_filename_stem(filename: str) -> str:
    """Take a filename (with or without path), drop extension, normalize.

    Returns "" when the resulting stem is shorter than the minimum article
    length — short stems generate too many false matches and are skipped by
    the caller.
    """
    stem = PurePosixPath(filename).stem
    norm = normalize_article(stem)
    if len(norm) < _MIN_ARTICLE_LEN:
        return ""
    return norm

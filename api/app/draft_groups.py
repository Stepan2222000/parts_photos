"""Groups that use temporary draft collages (one-day capture mode)."""
from __future__ import annotations

from uuid import UUID

REAL_PHOTOS_GROUP_ID = UUID("721bf726-cdda-4ca8-bf22-f345ca0f677b")
DEFECT_PHOTOS_GROUP_ID = UUID("edce2987-daae-4339-8330-8cb96ad912bf")

DRAFT_GROUP_IDS: frozenset[UUID] = frozenset({REAL_PHOTOS_GROUP_ID, DEFECT_PHOTOS_GROUP_ID})


def is_draft_group(group_id: UUID) -> bool:
    return group_id in DRAFT_GROUP_IDS

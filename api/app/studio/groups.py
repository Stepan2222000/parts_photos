"""Studio group configuration — hardcoded UUID → role/owner_kind/defect_filter map.

This is config-as-code: roles change rarely (new group = PR, not API call).
Group rows still live in `photo_groups` for naming and ordering — this module
only adds the Studio-specific behavior on top.

If a group_id appears in the DB but not here, it's treated as `studio_role=none`
(invisible to Studio).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
from uuid import UUID

StudioRole = Literal["source", "target", "none"]
OwnerKind = Literal["smart_part", "instance"]
DefectFilter = Literal["with", "without", "any"]


@dataclass(frozen=True)
class GroupConfig:
    studio_role: StudioRole
    owner_kind: OwnerKind
    defect_filter: DefectFilter


# UUIDs taken from prod DB (parts_photos.photo_groups). See STUDIO_GROUPS_TARGETS.md
# for the rationale per row.
GROUP_SETTINGS: dict[UUID, GroupConfig] = {
    # Эталонные на публикацию — read-only smart_part references, source for Studio
    UUID("ae697d8d-e803-42c4-9982-ecefbf8a8cdf"): GroupConfig("source", "smart_part", "any"),
    # Реальные на публикацию — instance, only without-defect items, Studio target
    UUID("3cf67240-7597-451a-8ec1-fb097afdeb88"): GroupConfig("target", "instance", "without"),
    # Дефектные на публикацию — instance, only with-defect items, Studio target
    UUID("a1790194-efa0-4dda-bed4-d8bc15b3b624"): GroupConfig("target", "instance", "with"),
    # Avito 2-й аккаунт — instance, any defect state, Studio target
    UUID("fa0df9bb-f285-4eb2-ab46-cd24e520a4e1"): GroupConfig("target", "instance", "any"),
    # Поступления — tracking-based, outside Studio entirely
    UUID("b66cc603-0bf2-4010-a602-a871f56d3e66"): GroupConfig("none", "instance", "any"),
    # Реальные фотографии — instance, without-defect, source-only
    UUID("721bf726-cdda-4ca8-bf22-f345ca0f677b"): GroupConfig("source", "instance", "without"),
    # Дефектные фотографии — instance, with-defect, source-only
    UUID("edce2987-daae-4339-8330-8cb96ad912bf"): GroupConfig("source", "instance", "with"),
}


def get(group_id: UUID) -> GroupConfig | None:
    return GROUP_SETTINGS.get(group_id)


def studio_targets() -> list[UUID]:
    return [gid for gid, cfg in GROUP_SETTINGS.items() if cfg.studio_role == "target"]


def is_studio_source(group_id: UUID) -> bool:
    cfg = GROUP_SETTINGS.get(group_id)
    return cfg is not None and cfg.studio_role == "source"


def defect_filter_sql(cfg: GroupConfig) -> str:
    """SQL fragment to AND into the items query for this group's defect_filter."""
    if cfg.defect_filter == "with":
        return "AND defect = true"
    if cfg.defect_filter == "without":
        return "AND defect = false"
    return ""

"""Studio group configuration — hardcoded UUID → role/owner_kind/defect_filter map.

Config-as-code: roles change rarely (new group = PR, not API call). Group rows
still live in `photo_groups` for naming/ordering — this module only adds the
Studio-specific behavior on top.

If a group_id appears in DB but not here, treated as `studio_role=none`
(invisible to Studio). The `accepts_defects` flag is the matrix gate: a target
with `accepts_defects=False` refuses any source whose `defect_filter='with'`.
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
    accepts_defects: bool = True


GROUP_SETTINGS: dict[UUID, GroupConfig] = {
    # Эталонные на публикацию — canonical smart_part references; now also a
    # Studio target (smart_part-level), but defects forbidden ("дефект в
    # эталон нельзя").
    UUID("ae697d8d-e803-42c4-9982-ecefbf8a8cdf"):
        GroupConfig("target", "smart_part", "any", accepts_defects=False),
    # Реальные на публикацию — instance, only without-defect items, curated.
    UUID("3cf67240-7597-451a-8ec1-fb097afdeb88"):
        GroupConfig("target", "instance", "without", accepts_defects=False),
    # Дефектные на публикацию — instance, only with-defect items.
    UUID("a1790194-efa0-4dda-bed4-d8bc15b3b624"):
        GroupConfig("target", "instance", "with", accepts_defects=True),
    # Avito 2-й аккаунт — smart_part-level target, accepts everything.
    UUID("fa0df9bb-f285-4eb2-ab46-cd24e520a4e1"):
        GroupConfig("target", "smart_part", "any", accepts_defects=True),
    # Поступления — outside Studio entirely.
    UUID("b66cc603-0bf2-4010-a602-a871f56d3e66"):
        GroupConfig("none", "instance", "any"),
    # Реальные фотографии — instance, without-defect, source-only.
    UUID("721bf726-cdda-4ca8-bf22-f345ca0f677b"):
        GroupConfig("source", "instance", "without"),
    # Дефектные фотографии — instance, with-defect, source-only.
    UUID("edce2987-daae-4339-8330-8cb96ad912bf"):
        GroupConfig("source", "instance", "with"),
}

# Convenient aliases used in matching/UI.
GROUP_NAMES: dict[UUID, str] = {
    UUID("ae697d8d-e803-42c4-9982-ecefbf8a8cdf"): "Эталонные на публикацию",
    UUID("3cf67240-7597-451a-8ec1-fb097afdeb88"): "Реальные на публикацию",
    UUID("a1790194-efa0-4dda-bed4-d8bc15b3b624"): "Дефектные на публикацию",
    UUID("fa0df9bb-f285-4eb2-ab46-cd24e520a4e1"): "Avito 2-й аккаунт",
    UUID("b66cc603-0bf2-4010-a602-a871f56d3e66"): "Поступления",
    UUID("721bf726-cdda-4ca8-bf22-f345ca0f677b"): "Реальные фотографии",
    UUID("edce2987-daae-4339-8330-8cb96ad912bf"): "Дефектные фотографии",
}


def get(group_id: UUID) -> GroupConfig | None:
    return GROUP_SETTINGS.get(group_id)


def studio_targets() -> list[UUID]:
    return [gid for gid, cfg in GROUP_SETTINGS.items() if cfg.studio_role == "target"]


def is_transfer_allowed(source_group_id: UUID | None, target_group_id: UUID) -> bool:
    """`source_group_id=None` ↔ fresh upload (no source group)."""
    tgt = GROUP_SETTINGS.get(target_group_id)
    if tgt is None or tgt.studio_role != "target":
        return False
    if source_group_id is None:
        return True

    src = GROUP_SETTINGS.get(source_group_id)
    if src is None or src.studio_role == "none":
        return False  # unknown group, or one Studio doesn't read from

    src_defective = src.defect_filter == "with"
    if src_defective and not tgt.accepts_defects:
        return False
    if not src_defective and tgt.defect_filter == "with":
        # Clean source can't be promoted into a defects-only target —
        # wouldn't be honest about the item's state.
        return False
    return True


# ---------------------------------------------------------------------------
# Direct physical move (no Studio generation)
# ---------------------------------------------------------------------------
#
# Raw photos may be *physically* promoted into a publication channel — the photo
# row is repointed and the object relocated, nothing is generated. The allowed
# routes are deliberately NARROWER than `is_transfer_allowed` (the Studio
# matrix, which also permits e.g. Реальные→Эталонные / Avito2). Here each source
# maps to exactly its own publication channel.
DIRECT_MOVE_TARGETS: dict[UUID, tuple[UUID, ...]] = {
    # Реальные фотографии → Реальные на публикацию
    UUID("721bf726-cdda-4ca8-bf22-f345ca0f677b"): (
        UUID("3cf67240-7597-451a-8ec1-fb097afdeb88"),
    ),
    # Дефектные фотографии → Дефектные на публикацию
    UUID("edce2987-daae-4339-8330-8cb96ad912bf"): (
        UUID("a1790194-efa0-4dda-bed4-d8bc15b3b624"),
    ),
}


def direct_move_targets(source_group_id: UUID) -> list[UUID]:
    """Publication channels a source group's raw photos may be moved into."""
    return list(DIRECT_MOVE_TARGETS.get(source_group_id, ()))


def is_direct_move_allowed(source_group_id: UUID, target_group_id: UUID) -> bool:
    return target_group_id in DIRECT_MOVE_TARGETS.get(source_group_id, ())


def transfer_rules_json() -> dict:
    """Frontend-friendly snapshot of the allowed source→target matrix.

    Shape:
      {
        "allowed": {target_uuid: ["upload", source_uuid, ...]}
      }
    """
    targets = studio_targets()
    candidates: list[UUID | None] = [None] + [
        gid for gid in GROUP_SETTINGS  # all known groups, source-or-target
    ]
    out: dict[str, list[str]] = {}
    for tgt_id in targets:
        ok: list[str] = []
        for src in candidates:
            if is_transfer_allowed(src, tgt_id):
                ok.append("upload" if src is None else str(src))
        out[str(tgt_id)] = ok
    return {"allowed": out}

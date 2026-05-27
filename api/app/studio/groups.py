"""Studio group configuration — hardcoded UUID → role/owner_kind/condition_filter map.

Config-as-code: roles change rarely (new group = PR, not API call). Group rows
still live in `photo_groups` for naming/ordering — this module only adds the
Studio-specific behavior on top.

If a group_id appears in DB but not here, treated as `studio_role=none`
(invisible to Studio). `condition_filter` is the item-state gate: an instance
target with `condition_filter` in ('personal', 'defect') only accepts items
whose `condition` matches; 'any' (and smart_part targets) accept everything.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from fastapi import HTTPException

StudioRole = Literal["source", "target", "none"]
OwnerKind = Literal["smart_part", "instance"]
ConditionFilter = Literal["personal", "defect", "not_defect", "any"]


@dataclass(frozen=True)
class GroupConfig:
    studio_role: StudioRole
    owner_kind: OwnerKind
    condition_filter: ConditionFilter
    # Для 'any'-таргетов: принимать ли источники с condition_filter='defect'.
    # У эталонных = False (референс не делаем из дефектного фото).
    accepts_defect_sources: bool = True


GROUP_SETTINGS: dict[UUID, GroupConfig] = {
    # Эталонные на публикацию — canonical smart_part references; also a Studio
    # target (smart_part-level). No item condition check (smart_part owner).
    UUID("ae697d8d-e803-42c4-9982-ecefbf8a8cdf"):
        GroupConfig("target", "smart_part", "any", accepts_defect_sources=False),
    # Реальные на публикацию — instance, only personal-condition items, curated.
    UUID("3cf67240-7597-451a-8ec1-fb097afdeb88"):
        GroupConfig("target", "instance", "personal"),
    # Дефектные на публикацию — instance, only defect-condition items.
    UUID("a1790194-efa0-4dda-bed4-d8bc15b3b624"):
        GroupConfig("target", "instance", "defect"),
    # Avito 2-й аккаунт — smart_part-level target, no item condition check.
    UUID("fa0df9bb-f285-4eb2-ab46-cd24e520a4e1"):
        GroupConfig("target", "smart_part", "any"),
    # Поступления — outside Studio entirely.
    UUID("b66cc603-0bf2-4010-a602-a871f56d3e66"):
        GroupConfig("none", "instance", "any"),
    # Реальные фотографии — instance, source-only; любые НЕ-дефектные (new+personal).
    UUID("721bf726-cdda-4ca8-bf22-f345ca0f677b"):
        GroupConfig("source", "instance", "not_defect"),
    # Дефектные фотографии — instance, defect-condition, source-only.
    UUID("edce2987-daae-4339-8330-8cb96ad912bf"):
        GroupConfig("source", "instance", "defect"),
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


ALL_CONDITIONS = ("new", "personal", "defect")


def condition_allowed(item_condition: str, condition_filter: ConditionFilter) -> bool:
    """Годится ли состояние экземпляра под фильтр группы. ЕДИНОЕ место правила.
    any → любое; not_defect → всё кроме defect; personal/defect → точное совпадение.
    """
    if condition_filter == "any":
        return True
    if condition_filter == "not_defect":
        return item_condition != "defect"
    return item_condition == condition_filter


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

    # 'any' target (smart_part channels) accepts any known source. Otherwise the
    # source's condition_filter must match the target's exactly — a personal
    # source can't be promoted into a defect-only channel and vice versa.
    if tgt.condition_filter == "any":
        # 'any' принимает personal/new источники, но таргет может отказывать
        # дефектным источникам (эталонные: референс не из дефектного фото).
        if src.condition_filter == "defect" and not tgt.accepts_defect_sources:
            return False
        return True
    # Иначе перенос разрешён, если есть состояние экземпляра, годное И источнику, И цели
    # (напр. «Реальные фото» not_defect → «Реальные публ» personal: personal проходит оба).
    return any(
        condition_allowed(cnd, src.condition_filter) and condition_allowed(cnd, tgt.condition_filter)
        for cnd in ALL_CONDITIONS
    )


def assert_item_condition_allowed(item_condition: str, group_id: UUID) -> None:
    """The ONE place that enforces an item's condition against a group.

    Raises HTTPException(422) when the group is an instance channel restricted to
    a single condition ('personal'/'defect') and the item doesn't match. No-op
    for smart_part groups, 'any' filters, or unknown groups.
    """
    cfg = GROUP_SETTINGS.get(group_id)
    if cfg is None or cfg.owner_kind != "instance":
        return
    if not condition_allowed(item_condition, cfg.condition_filter):
        raise HTTPException(
            422,
            f"item condition '{item_condition}' не подходит для группы "
            f"(нужно: {cfg.condition_filter})",
        )


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

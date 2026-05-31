from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException

from ..db import pool
from ..models import (
    Group,
    GroupCreate,
    GroupPatch,
    GroupPositionUpdate,
    MoveTarget,
)
from ..studio import groups as gconfig

router = APIRouter(prefix="/groups", tags=["groups"])


def _creation_mode(group_id) -> tuple[str | None, str | None]:
    """(owner_kind, condition_filter) for the create flow, or (None, None) when
    the group has no manual-creation mode: absent from config, or
    studio_role=='none' (e.g. "Поступления" — track-number owner, handled
    separately)."""
    cfg = gconfig.get(group_id)
    if cfg is None or cfg.studio_role == "none":
        return None, None
    return cfg.owner_kind, cfg.condition_filter


@router.get("", response_model=list[Group])
async def list_groups() -> list[Group]:
    rows = await pool().fetch(
        """
        SELECT
            g.id, g.name, g.description, g.is_reference, g.position,
            g.created_at, g.updated_at,
            COUNT(DISTINCT c.id) AS collages_count,
            COUNT(p.id) FILTER (WHERE p.state = 'uploaded') AS photos_count
        FROM photo_groups g
        LEFT JOIN photo_collages c ON c.group_id = g.id
        LEFT JOIN photos p          ON p.collage_id = c.id
        GROUP BY g.id
        ORDER BY g.position ASC, g.name ASC
        """
    )
    out: list[Group] = []
    for r in rows:
        owner_kind, condition_filter = _creation_mode(r["id"])
        owner_optional, title_required, owner_free = gconfig.creation_flags(r["id"])
        out.append(Group(
            **dict(r),
            owner_kind=owner_kind,
            condition_filter=condition_filter,
            allows_video=gconfig.allows_video(r["id"]),
            owner_optional=owner_optional,
            title_required=title_required,
            owner_free=owner_free,
        ))
    return out


@router.get("/{group_id}/move-targets", response_model=list[MoveTarget])
async def list_move_targets(group_id: UUID) -> list[MoveTarget]:
    """Publication channels this group's raw photos may be physically moved
    into (config-as-code in studio/groups.py). Empty for groups that aren't a
    direct-move source — the frontend hides the move action then."""
    target_ids = gconfig.direct_move_targets(group_id)
    if not target_ids:
        return []
    rows = await pool().fetch(
        "SELECT id, name FROM photo_groups WHERE id = ANY($1::uuid[]) ORDER BY position ASC",
        target_ids,
    )
    return [MoveTarget(id=r["id"], name=r["name"]) for r in rows]


@router.post("", response_model=Group, status_code=201)
async def create_group(payload: GroupCreate) -> Group:
    if payload.is_reference:
        existing = await pool().fetchval(
            "SELECT 1 FROM photo_groups WHERE is_reference = true"
        )
        if existing:
            raise HTTPException(409, "Reference group already exists; only one is allowed")

    try:
        row = await pool().fetchrow(
            """
            INSERT INTO photo_groups (name, description, is_reference, position)
            VALUES ($1, $2, $3, COALESCE((SELECT MAX(position) + 1 FROM photo_groups), 1))
            RETURNING id, name, description, is_reference, position, created_at, updated_at
            """,
            payload.name, payload.description, payload.is_reference,
        )
    except Exception as e:
        raise HTTPException(409, f"Group name must be unique: {e}") from e

    return Group(**dict(row), collages_count=0, photos_count=0)


@router.patch("/{group_id}", response_model=Group)
async def patch_group(group_id: UUID, payload: GroupPatch) -> Group:
    fields: list[str] = []
    values: list = []
    if payload.name is not None:
        values.append(payload.name)
        fields.append(f"name = ${len(values)}")
    if payload.description is not None:
        values.append(payload.description)
        fields.append(f"description = ${len(values)}")
    if not fields:
        raise HTTPException(400, "Nothing to update")

    values.append(group_id)
    row = await pool().fetchrow(
        f"""
        UPDATE photo_groups SET {", ".join(fields)}, updated_at = now()
        WHERE id = ${len(values)}
        RETURNING id, name, description, is_reference, position, created_at, updated_at
        """,
        *values,
    )
    if row is None:
        raise HTTPException(404, "Group not found")
    return Group(**dict(row), collages_count=0, photos_count=0)


@router.put("/positions", status_code=204)
async def reorder_groups(updates: list[GroupPositionUpdate]) -> None:
    """Atomic reorder of groups in the sidebar. Validates that the request
    covers exactly the live groups in the table — no missing, no extras."""
    if not updates:
        raise HTTPException(400, "Empty payload")

    async with pool().acquire() as conn:
        async with conn.transaction():
            alive = await conn.fetchval("SELECT COUNT(*) FROM photo_groups")
            if alive != len(updates):
                raise HTTPException(
                    409,
                    f"Group set changed: have {alive} in DB, got {len(updates)} in request",
                )

            await conn.executemany(
                "UPDATE photo_groups SET position = $2, updated_at = now() WHERE id = $1",
                [(u.group_id, u.position) for u in updates],
            )

            seen = await conn.fetchval(
                "SELECT COUNT(DISTINCT id) FROM photo_groups WHERE id = ANY($1::uuid[])",
                [u.group_id for u in updates],
            )
            if seen != len(updates):
                raise HTTPException(409, "One or more group IDs not found")


@router.delete("/{group_id}", status_code=204)
async def delete_group(group_id: UUID) -> None:
    row = await pool().fetchrow(
        """
        DELETE FROM photo_groups
        WHERE id = $1 AND is_reference = false
        RETURNING id
        """,
        group_id,
    )
    if row is not None:
        return
    # Either the row didn't exist or it's a reference group. Disambiguate.
    is_ref = await pool().fetchval(
        "SELECT is_reference FROM photo_groups WHERE id = $1", group_id
    )
    if is_ref is None:
        raise HTTPException(404, "Group not found")
    raise HTTPException(403, "Cannot delete the reference group from UI")

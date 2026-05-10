from __future__ import annotations

from enum import StrEnum


class OptionKey(StrEnum):
    REPLACE_BG = "replace_bg"
    IMPROVE_LIGHTING = "improve_lighting"
    STRAIGHTEN_BOX = "straighten_box"
    FIX_PART_DEFECTS = "fix_part_defects"
    CLEAN_PART_DIRT = "clean_part_dirt"
    REDO_LABELS = "redo_labels"
    SUBSTITUTE_DATE = "substitute_date"
    REMOVE_EXTRAS = "remove_extras"
    REMOVE_OTHERS_WATERMARK = "remove_others_watermark"
    ADD_WATERMARK = "add_watermark"


OPTION_KEYS: tuple[OptionKey, ...] = tuple(OptionKey)


OPTION_LABELS: dict[OptionKey, str] = {
    OptionKey.REPLACE_BG: "Replace background",
    OptionKey.IMPROVE_LIGHTING: "Improve lighting",
    OptionKey.STRAIGHTEN_BOX: "Straighten packaging",
    OptionKey.FIX_PART_DEFECTS: "Fix part defects (dents, scratches)",
    OptionKey.CLEAN_PART_DIRT: "Clean dirt off the part",
    OptionKey.REDO_LABELS: "Flatten wrinkled labels",
    OptionKey.SUBSTITUTE_DATE: "Substitute date on label",
    OptionKey.REMOVE_EXTRAS: "Remove extra objects in frame",
    OptionKey.REMOVE_OTHERS_WATERMARK: "Remove third-party watermarks",
    OptionKey.ADD_WATERMARK: "Add my watermark",
}


_DEFAULTS: dict[OptionKey, bool] = {
    OptionKey.REPLACE_BG: False,
    OptionKey.IMPROVE_LIGHTING: False,
    OptionKey.STRAIGHTEN_BOX: False,
    OptionKey.FIX_PART_DEFECTS: False,
    OptionKey.CLEAN_PART_DIRT: False,
    OptionKey.REDO_LABELS: False,
    OptionKey.SUBSTITUTE_DATE: False,
    OptionKey.REMOVE_EXTRAS: False,
    OptionKey.REMOVE_OTHERS_WATERMARK: True,
    OptionKey.ADD_WATERMARK: False,
}


def defaults() -> dict[str, bool]:
    return {k.value: v for k, v in _DEFAULTS.items()}


def coerce_options(raw: dict[str, object] | None) -> dict[OptionKey, bool]:
    """Take a dict from API/CLI/DB and return a clean {OptionKey: bool} map.

    Unknown keys are dropped silently. Missing keys take the default.
    """
    raw = raw or {}
    out: dict[OptionKey, bool] = {}
    for key in OPTION_KEYS:
        if key.value in raw:
            out[key] = bool(raw[key.value])
        else:
            out[key] = _DEFAULTS[key]
    return out

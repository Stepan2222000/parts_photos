from __future__ import annotations

from datetime import date

from studio_core.options import OptionKey, defaults
from studio_core.prompt_builder import OPTION_KEYS_ORDER, build_prompt


def test_defaults_match_option_keys() -> None:
    d = defaults()
    assert set(d.keys()) == {k.value for k in OPTION_KEYS_ORDER}
    assert d[OptionKey.REMOVE_OTHERS_WATERMARK.value] is True
    for k, v in d.items():
        if k != OptionKey.REMOVE_OTHERS_WATERMARK.value:
            assert v is False, f"option {k} should default to False"


def test_build_prompt_includes_legend_and_lockdown() -> None:
    p = build_prompt(defaults())
    assert "Image 1: source product photo" in p
    assert "Hard invariants" in p
    assert "FINAL LOCKDOWN" in p
    assert "MUST NOT CHANGE:" in p
    # default has only one option ON → CHANGES TO PERFORM has at least one entry
    assert "CHANGES TO PERFORM:" in p


def test_replace_bg_adds_image_2_legend() -> None:
    opts = defaults()
    opts[OptionKey.REPLACE_BG.value] = True
    p = build_prompt(opts, has_background=True)
    assert "Image 2: background reference" in p
    # The "do" line for replace_bg references Image 2
    assert "Image 2" in p
    # the matching skip line is gone
    assert "Do NOT change the background" not in p


def test_unselected_options_appear_as_skip_lines() -> None:
    # all OFF
    opts = {k.value: False for k in OPTION_KEYS_ORDER}
    p = build_prompt(opts)
    # every skip line present
    assert "Do NOT change the background" in p
    assert "Do NOT modify lighting" in p
    assert "Do NOT modify the packaging shape" in p
    assert "Do NOT modify the part surface in any way" in p
    assert "Do NOT modify labels or stickers" in p
    assert "Do NOT modify any date" in p
    assert "Do NOT remove any physical objects" in p
    assert "Do NOT remove watermarks, logos, or overlay text" in p
    assert "Do NOT add any watermark" in p
    # CHANGES TO PERFORM is empty marker
    assert "(none — only the lockdowns apply)" in p


def test_substitute_date_uses_today() -> None:
    today = date(2026, 5, 10)
    opts = defaults()
    opts[OptionKey.SUBSTITUTE_DATE.value] = True
    p = build_prompt(opts, today=today)
    assert "today = 2026-05-10" in p
    # ~3 months before today = ~2026-02-09
    assert "target around 2026-02-09" in p


def test_custom_prompt_inserted_before_final_lockdown() -> None:
    p = build_prompt(defaults(), custom_prompt="please keep blue tint")
    assert "USER ADDITIONAL INSTRUCTIONS" in p
    user_idx = p.index("USER ADDITIONAL INSTRUCTIONS")
    final_idx = p.index("FINAL LOCKDOWN")
    assert user_idx < final_idx
    assert "please keep blue tint" in p


def test_empty_custom_prompt_omitted() -> None:
    p1 = build_prompt(defaults(), custom_prompt="")
    p2 = build_prompt(defaults(), custom_prompt="   ")
    p3 = build_prompt(defaults(), custom_prompt=None)
    assert "USER ADDITIONAL INSTRUCTIONS" not in p1
    assert "USER ADDITIONAL INSTRUCTIONS" not in p2
    assert "USER ADDITIONAL INSTRUCTIONS" not in p3


def test_add_watermark_legend_when_enabled() -> None:
    opts = defaults()
    opts[OptionKey.ADD_WATERMARK.value] = True
    p = build_prompt(opts, has_watermark=True)
    assert "Image 2: watermark image" in p  # since no bg, watermark becomes Image 2

    opts[OptionKey.REPLACE_BG.value] = True
    p2 = build_prompt(opts, has_background=True, has_watermark=True)
    assert "Image 2: background reference" in p2
    assert "Image 3: watermark image" in p2


def test_unknown_option_keys_dropped() -> None:
    opts = defaults() | {"some_unknown_key": True, "also_invalid": False}
    p = build_prompt(opts)  # must not raise
    assert "FINAL LOCKDOWN" in p


def test_aspect_ratio_instruction_present() -> None:
    p = build_prompt(defaults())
    assert "Match the aspect ratio of Image 1" in p
    assert "1024x1024" in p
    assert "1024x1536" in p
    assert "1536x1024" in p

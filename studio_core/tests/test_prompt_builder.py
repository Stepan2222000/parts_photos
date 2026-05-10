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
    assert "Изображение 1: исходное фото товара" in p
    assert "Жёсткие инварианты" in p
    assert "ФИНАЛЬНЫЙ ЛОКДАУН" in p
    assert "ЧТО НЕЛЬЗЯ МЕНЯТЬ:" in p
    assert "ЧТО НУЖНО СДЕЛАТЬ:" in p


def test_replace_bg_adds_image_2_legend() -> None:
    opts = defaults()
    opts[OptionKey.REPLACE_BG.value] = True
    p = build_prompt(opts, has_background=True)
    assert "Изображение 2: фоновый референс" in p
    assert "Изображение 2" in p
    # соответствующая «не трогай» строка ушла
    assert "НЕ меняй фон" not in p


def test_unselected_options_appear_as_skip_lines() -> None:
    # все OFF
    opts = {k.value: False for k in OPTION_KEYS_ORDER}
    p = build_prompt(opts)
    assert "НЕ меняй фон" in p
    assert "НЕ меняй освещение" in p
    assert "НЕ меняй форму упаковки" in p
    assert "НЕ меняй поверхность запчасти" in p
    assert "НЕ меняй наклейки и этикетки" in p
    assert "НЕ меняй ни одну дату" in p
    assert "НЕ убирай из кадра" in p
    assert "НЕ убирай вотермарки" in p
    assert "НЕ добавляй никаких собственных вотермарок" in p
    # CHANGES TO PERFORM пустая
    assert "(ничего — применяются только локдауны)" in p


def test_substitute_date_uses_today() -> None:
    today = date(2026, 5, 10)
    opts = defaults()
    opts[OptionKey.SUBSTITUTE_DATE.value] = True
    p = build_prompt(opts, today=today)
    assert "сегодня = 2026-05-10" in p
    # ~3 месяца до сегодня = ~2026-02-09
    assert "цель около 2026-02-09" in p


def test_custom_prompt_inserted_before_final_lockdown() -> None:
    p = build_prompt(defaults(), custom_prompt="оставь синий оттенок")
    assert "ДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ ПОЛЬЗОВАТЕЛЯ" in p
    user_idx = p.index("ДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ ПОЛЬЗОВАТЕЛЯ")
    final_idx = p.index("ФИНАЛЬНЫЙ ЛОКДАУН")
    assert user_idx < final_idx
    assert "оставь синий оттенок" in p


def test_empty_custom_prompt_omitted() -> None:
    p1 = build_prompt(defaults(), custom_prompt="")
    p2 = build_prompt(defaults(), custom_prompt="   ")
    p3 = build_prompt(defaults(), custom_prompt=None)
    assert "ДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ ПОЛЬЗОВАТЕЛЯ" not in p1
    assert "ДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ ПОЛЬЗОВАТЕЛЯ" not in p2
    assert "ДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ ПОЛЬЗОВАТЕЛЯ" not in p3


def test_add_watermark_legend_when_enabled() -> None:
    opts = defaults()
    opts[OptionKey.ADD_WATERMARK.value] = True
    p = build_prompt(opts, has_watermark=True)
    # без bg, watermark становится Изображение 2
    assert "Изображение 2: вотермарк" in p

    opts[OptionKey.REPLACE_BG.value] = True
    p2 = build_prompt(opts, has_background=True, has_watermark=True)
    assert "Изображение 2: фоновый референс" in p2
    assert "Изображение 3: вотермарк" in p2


def test_unknown_option_keys_dropped() -> None:
    opts = defaults() | {"some_unknown_key": True, "also_invalid": False}
    p = build_prompt(opts)  # не должно падать
    assert "ФИНАЛЬНЫЙ ЛОКДАУН" in p


def test_aspect_ratio_instruction_present() -> None:
    p = build_prompt(defaults())
    assert "соотношение сторон по Изображению 1" in p
    assert "1024x1024" in p
    assert "1024x1536" in p
    assert "1536x1024" in p

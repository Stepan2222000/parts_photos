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


def test_build_prompt_includes_legend_and_rules() -> None:
    p = build_prompt(defaults())
    assert "Изображение 1: исходное фото товара" in p
    assert "Стандартные правила редактирования" in p
    assert "приоритет за инструкциями пользователя" in p
    assert "Дополнительные подсказки по качеству" in p
    assert "ЧТО НЕЛЬЗЯ МЕНЯТЬ:" in p
    assert "ЧТО НУЖНО СДЕЛАТЬ:" in p


def test_user_prompt_takes_priority_over_defaults() -> None:
    p = build_prompt(defaults(), custom_prompt="сделай фон красным")
    # лейбл «дополнительные инструкции» помечен как приоритетный
    assert "имеют приоритет над стандартными правилами" in p
    # больше нет строк, говорящих что lockdown побеждает пользователя
    assert "побеждает локдаун" not in p
    assert "ФИНАЛЬНЫЙ ЛОКДАУН" not in p


def test_dirt_cleaning_does_not_remove_store_stickers() -> None:
    opts = defaults()
    opts[OptionKey.CLEAN_PART_DIRT.value] = True
    p = build_prompt(opts)
    # явно сказано что наклейки магазинов и ценники остаются
    assert "Наклейки магазинов и ценники" in p
    # do-блок чистки грязи тоже не упоминает их
    do_section_idx = p.index("Почисти запчасть от грязи")
    do_section = p[do_section_idx : do_section_idx + 600]
    assert "наклейки магазинов" not in do_section.lower() or "не грязь" in do_section.lower()


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
    assert "НЕ убирай царапины" in p
    assert "НЕ чисти запчасть от грязи" in p
    assert "НЕ меняй наклейки и этикетки" in p
    assert "НЕ меняй ни одну дату" in p
    assert "НЕ убирай из кадра" in p
    assert "НЕ убирай вотермарки" in p
    assert "НЕ добавляй никаких собственных вотермарок" in p
    # CHANGES TO PERFORM пустая
    assert "(ничего — применяются только локдауны)" in p


def test_dirt_and_defects_are_independent() -> None:
    # Грязь и царапины — разные понятия. Включаем чистку грязи, дефекты OFF.
    opts = {k.value: False for k in OPTION_KEYS_ORDER}
    opts[OptionKey.CLEAN_PART_DIRT.value] = True
    p = build_prompt(opts)
    # включена чистка грязи
    assert "Почисти запчасть от грязи" in p
    # дефекты по-прежнему явно запрещены к удалению
    assert "НЕ убирай царапины, вмятины" in p

    # обратный случай
    opts2 = {k.value: False for k in OPTION_KEYS_ORDER}
    opts2[OptionKey.FIX_PART_DEFECTS.value] = True
    p2 = build_prompt(opts2)
    assert "Убери физические дефекты" in p2
    assert "НЕ чисти запчасть от грязи" in p2


def test_substitute_date_uses_today() -> None:
    today = date(2026, 5, 10)
    opts = defaults()
    opts[OptionKey.SUBSTITUTE_DATE.value] = True
    p = build_prompt(opts, today=today)
    assert "сегодня = 2026-05-10" in p
    # ~3 месяца до сегодня = ~2026-02-09
    assert "цель около 2026-02-09" in p


def test_custom_prompt_inserted_before_quality_hints() -> None:
    p = build_prompt(defaults(), custom_prompt="оставь синий оттенок")
    assert "ДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ ПОЛЬЗОВАТЕЛЯ" in p
    user_idx = p.index("ДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ ПОЛЬЗОВАТЕЛЯ")
    hints_idx = p.index("Дополнительные подсказки по качеству")
    assert user_idx < hints_idx
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
    assert "Дополнительные подсказки по качеству" in p


def test_aspect_ratio_set_externally() -> None:
    # Size/aspect ratio are now set via the API request, not dictated in the
    # prompt — the prompt must not pin specific pixel dimensions.
    p = build_prompt(defaults())
    assert "соотношение сторон результата задаются извне" in p
    assert "1024x1536" not in p
    assert "1536x1024" not in p

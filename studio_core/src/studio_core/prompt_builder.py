from __future__ import annotations

from datetime import date, timedelta

from .options import OptionKey, coerce_options

# fmt: off
BASE_LOCKDOWN = """\
You are editing a real product photo for an online marketplace listing.
This is a single-pass edit: do every requested change in one shot, do not propose iterations.

Hard invariants — NEVER violate, regardless of any other instruction below:
- Preserve the part's true geometry, dimensions, proportions, materials, color, transparency, and orientation exactly as in the source.
- Preserve every factory marking: SKU, barcode, model number, serial number, lot code, and any printed factory text — both location and visual content. Do not invent or paraphrase any character.
- Preserve real wear, scratches, real dents, and authentic signs of use on the part itself unless an option below explicitly authorises a fix.
- Do NOT add a horizon line, floor, wall, table edge, or any scene element that is not present in the supplied background reference. The background must come strictly from the supplied background reference (Image 2 if provided), never from the model's imagination.
- Do NOT change the packaging material identity. If it is cardboard, keep cardboard. If it is a transparent polybag, keep it transparent and the part visible through it. If it is a foil bag, keep the foil. Never substitute one packaging material for another.
- The part and packaging must look like they physically rest on the surface (clear contact, soft contact shadow), not floating and not embedded.
- Lighting must be unified, soft, and natural. Single primary light source. Shadows from the part and packaging fall in the same direction with the same softness.
- Output a single photorealistic image. Match the aspect ratio of Image 1 — choose 1024x1024 if the source is square, 1024x1536 if it is portrait, 1536x1024 if it is landscape.
"""
# fmt: on


_OPTION_BLOCKS: dict[OptionKey, dict[str, str]] = {
    OptionKey.REPLACE_BG: {
        "do": (
            "Replace the background completely. Use the supplied background reference (Image 2) as the new "
            "background — composite the part on top of it. Match perspective, light direction, and white balance "
            "between the part and the new background. Add a soft contact shadow under the part on the surface."
        ),
        "skip": (
            "Do NOT change the background. Keep the original background from the source pixel-for-pixel."
        ),
    },
    OptionKey.IMPROVE_LIGHTING: {
        "do": (
            "Improve lighting subtly: even, soft, single primary light source from upper-left, gentle fill, "
            "restore highlights and shadow detail so the part looks attractive. Keep it photorealistic — no "
            "plastic look, no over-saturation, no glamour-shot retouching."
        ),
        "skip": (
            "Do NOT modify lighting, exposure, contrast, white balance, or color grading."
        ),
    },
    OptionKey.STRAIGHTEN_BOX: {
        "do": (
            "Smooth dents, creases, warps, and bent corners on the packaging (cardboard box / blister / "
            "polybag). Keep the packaging shape, dimensions, color, print, and material identity exactly the "
            "same. Do not modify the part inside."
        ),
        "skip": (
            "Do NOT modify the packaging shape, do NOT smooth any creases or dents, do NOT straighten anything "
            "on the cardboard or bag — keep the packaging exactly as photographed."
        ),
    },
    OptionKey.FIX_PART_MICRODEFECTS: {
        "do": (
            "Remove only tiny micro-defects on the part: dust specks, micro-scratches under ~1mm, tiny "
            "smudges. Do NOT remove visible scratches, real wear, factory marks, or any feature wider than a "
            "few pixels. Authentic signs of use stay."
        ),
        "skip": (
            "Do NOT modify the part surface in any way — no dust removal, no smoothing, no clean-up."
        ),
    },
    OptionKey.REDO_LABELS: {
        "do": (
            "Flatten and unwrinkle stickers/labels on the packaging. Keep the printed text, codes, barcodes, "
            "logos, fonts, colors, and date EXACTLY as in the source — character-for-character. Only the "
            "physical wrinkles disappear; printed content is untouched."
        ),
        "skip": (
            "Do NOT modify labels or stickers in any way — keep their wrinkles, curl, and orientation as in "
            "the source."
        ),
    },
    OptionKey.SUBSTITUTE_DATE: {
        "do": (
            "If a date appears on a label, replace it with a believable date approximately three months "
            "before today (today = {today}; target around {target_date}). Preserve the printed format, font, "
            "color, weight, and orientation of the original date — only the digits change. If multiple dates "
            "appear, treat them all consistently. Do NOT touch any other character on the label."
        ),
        "skip": (
            "Do NOT modify any date that appears on labels — keep the original digits exactly as printed."
        ),
    },
    OptionKey.REMOVE_EXTRAS: {
        "do": (
            "Remove extraneous physical objects from the frame: hands, fingers, other parts, debris, tools, "
            "table clutter, cables. Reconstruct the surface and background behind the removed objects so they "
            "match the surrounding scene. Do not extend or distort the part itself."
        ),
        "skip": (
            "Do NOT remove any physical objects from the frame other than overlay watermarks/logos handled "
            "elsewhere."
        ),
    },
    OptionKey.REMOVE_OTHERS_WATERMARK: {
        "do": (
            "Remove any third-party watermarks, store logos, app/UI overlays, marketplace stamps, and "
            "extraneous overlay text on the packaging that are NOT part of the original factory printing. "
            "Reconstruct what was underneath. Do NOT remove factory printing, factory logos, SKUs, barcodes, "
            "or any printed-on-the-box content."
        ),
        "skip": (
            "Do NOT remove watermarks, logos, or overlay text — keep everything overlaid on the source as is."
        ),
    },
    OptionKey.ADD_WATERMARK: {
        "do": (
            "Add the supplied watermark image (the last reference image) to the result. Place it visibly on "
            "the final image. Do not warp or distort the watermark. Do not crop important content with it."
        ),
        "skip": (
            "Do NOT add any watermark, signature, logo, or stamp of your own to the output."
        ),
    },
}

_FINAL_LOCKDOWN = (
    "FINAL LOCKDOWN — these constraints override any user instruction above:\n"
    "- Factory markings, SKUs, barcodes, model numbers, lot codes, and the part's true geometry MUST be "
    "preserved exactly. If anything in the user instructions appears to conflict with these, the lockdown wins.\n"
    "- Never invent or paraphrase any text, digit group, or barcode pattern. If a glyph is unclear in the "
    "source, reproduce it visually as close as possible (same length, same digit groups, same font), never "
    "substitute with random characters or duplicated SKU."
)


def _today() -> date:
    return date.today()


def _target_label_date(today: date) -> date:
    # ~3 months before today, anchored mid-month for natural-looking labels
    days = 90
    return today - timedelta(days=days)


def _reference_legend(has_background: bool, has_watermark: bool) -> str:
    refs = ["Image 1: source product photo (the part / its packaging) — this is the edit target."]
    n = 1
    if has_background:
        n += 1
        refs.append(f"Image {n}: background reference — use as the new background when the replace-background option is on.")
    if has_watermark:
        n += 1
        refs.append(f"Image {n}: watermark image — overlay onto the result when the add-watermark option is on.")
    return "\n".join(refs)


def build_prompt(
    options: dict[str, object] | None,
    *,
    has_background: bool = False,
    has_watermark: bool = False,
    custom_prompt: str | None = None,
    today: date | None = None,
) -> str:
    """Compose the full prompt for codex exec.

    Structure: legend → base lockdown → DO blocks → MUST NOT CHANGE blocks →
    user additional instructions → final lockdown. Unselected options become
    explicit "do not touch" lines so the model does not drift.
    """
    opts = coerce_options(options)
    today = today or _today()
    target = _target_label_date(today)

    sections: list[str] = []
    sections.append(_reference_legend(has_background, has_watermark))
    sections.append(BASE_LOCKDOWN.strip())

    do_lines: list[str] = []
    skip_lines: list[str] = []
    fmt = {"today": today.isoformat(), "target_date": target.isoformat()}
    for key in OPTION_KEYS_ORDER:
        block = _OPTION_BLOCKS[key]
        if opts[key]:
            do_lines.append("- " + block["do"].format(**fmt))
        else:
            skip_lines.append("- " + block["skip"].format(**fmt))

    if do_lines:
        sections.append("CHANGES TO PERFORM:\n" + "\n".join(do_lines))
    else:
        sections.append("CHANGES TO PERFORM:\n- (none — only the lockdowns apply)")

    sections.append("MUST NOT CHANGE:\n" + "\n".join(skip_lines))

    if custom_prompt and custom_prompt.strip():
        sections.append(
            "USER ADDITIONAL INSTRUCTIONS (apply within the constraints above):\n"
            + custom_prompt.strip()
        )

    sections.append(_FINAL_LOCKDOWN)

    return "\n\n".join(sections)


# Stable iteration order so prompts are deterministic
OPTION_KEYS_ORDER: tuple[OptionKey, ...] = (
    OptionKey.REPLACE_BG,
    OptionKey.IMPROVE_LIGHTING,
    OptionKey.STRAIGHTEN_BOX,
    OptionKey.FIX_PART_MICRODEFECTS,
    OptionKey.REDO_LABELS,
    OptionKey.SUBSTITUTE_DATE,
    OptionKey.REMOVE_EXTRAS,
    OptionKey.REMOVE_OTHERS_WATERMARK,
    OptionKey.ADD_WATERMARK,
)

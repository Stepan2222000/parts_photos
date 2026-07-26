-- Background type of the photo's ORIGINAL (canonical) shot, from the
-- July-2026 classification pass (colour heuristics + vision review of hard
-- cases). Drives filters/curation in the design panel; hand-editable.
-- Apply order: after migration_012_backgrounds.sql.

ALTER TABLE photos
    ADD COLUMN IF NOT EXISTS bg_kind text;

-- Values in use: cream_marble | white_marble | branded_backdrop | raw |
-- grey_studio | scheme_doc | screenshot_ui | other_unclear

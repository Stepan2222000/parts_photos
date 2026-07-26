# Parts Photos Handoff

## Goal
- Process the full `plan_etalon.json` volume.
- For each photo, save:
  - original source image
  - generated result image
  - per-item metadata
- Save final outputs on Desktop, not only in tmp.

## Source Data
- Main dataset: `/Users/stepan/Desktop/marble_task/data/plan_etalon.json`
- Total records: `272`
- Marble reference: `/Users/stepan/Desktop/marble_1_calacatta.png`

## Geometry Rule
- `flat` only for strict top-down flat-lay shots.
- `corner` for any front / front-3-4 / visible-depth shot.

## Generation Rule
- Keep product unchanged.
- Replace only background with Calacatta marble.
- Preserve labels, text, packaging, shadows, reflections, crop, scale, orientation.

## Required Output Structure
- Root folder on Desktop.
- One folder per photo:
  - `source.png` or `source.jpg`
  - `result.png`
  - `meta.json`

Recommended item path format:
- `items/<idx>__<collage_id>__<photo_id>/`

## Important Operational Facts
- Tmp scripts are allowed and preferred for runners.
- Do not write helper scripts into the repo.
- User explicitly asked to keep scripts in tmp files.
- Final images must be copied/saved to Desktop.

## What Was Already Learned
- Earlier small-batch tests showed:
  - `corner` logic is correct for visible-depth shots
  - `flat` logic is correct for true top-down shots
- Image proxy often returns wrong output sizes:
  - square requests may return `1254x1254`
  - some vertical requests may return wrong dimensions too
- This must be logged per item in metadata.

## Critical Bug Already Found
- First full-run attempts produced truncated source files.
- Cause: downloader accepted existing file without validating full image decode.
- Fix required:
  - download to temp file
  - validate with full `PIL.Image.load()`
  - only then move to final `source.*`
  - retry invalid source downloads

## Important Failed Attempts
These folders are not reliable and should be treated as bad runs:
- `/Users/stepan/Desktop/parts_photos_full_run_2026-06-30`
- `/Users/stepan/Desktop/parts_photos_full_run_2026-06-30_rerun1`

## Background Process Problem
- Foreground run works.
- Background long-running process in this environment kept dying almost immediately.
- Do not assume `nohup` backgrounding is reliable here.
- Safer approach: continue in a live long-running session and monitor progress.

## Current Best Direction
1. Use the validated downloader.
2. Run full processing from a live session.
3. Keep concurrency conservative, e.g. `3`.
4. For each item, save:
   - source
   - result
   - meta
5. In `meta.json`, record at least:
   - `idx`
   - `collage_id`
   - `photo_id`
   - `mode`
   - `orig_source`
   - `src_url`
   - `fallback_url`
   - `requested_size`
   - `actual_size`
   - attempts / retries
   - final status (`ok`, `size_mismatch`, `failed`)

## User Preferences
- Do not ask repetitive or obvious questions.
- Be concise.
- Save generated images to Desktop.
- For every photo, keep the pair: source + result.

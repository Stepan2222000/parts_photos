-- «Примеры с рынка» — positive-референсы реальных фото запчастей на smart.
--
-- Отдельный канал примеров: реальные фото запчастей из чужих объявлений
-- (Avito/eBay и т.п.) — референс «как выглядит хорошая деталь» для VL-моделей,
-- чтобы они сравнивали предложения с примерами, а не рассуждали вслепую.
-- Это НЕ эталонные (те могут быть сгенерированы) и НЕ «Реальные фотографии»
-- (те — наши складские экземпляры).
--
-- Устройство:
--   • группа с фиксированным UUID (config-as-code: studio/groups.py);
--   • коллаж в группе = ОДИН пример; owner_kind/owner_id всегда NULL —
--     привязка к smart живёт ТОЛЬКО в smart_part_examples (единственный
--     источник правды, без дублирования в owner_id);
--   • на один smart — много примеров, position задаёт порядок показа моделям;
--   • создание — только через POST /examples (generic POST /collages в эту
--     группу API отклоняет);
--   • только положительные примеры, provenance объявления не храним.
--
-- NULL-owner коллажи не конфликтуют с photo_collages_owner_unique (NULLs
-- distinct в btree-unique) — партиальный индекс менять не нужно.
--
-- Apply order: after migration_009_photos_source_copy.sql.
-- Идемпотентно — деплой прогоняет все migration_*.sql на каждом релизе.

BEGIN;

INSERT INTO photo_groups (id, name, description, is_reference, position)
VALUES (
    '024e74e8-bf6b-45be-bc78-18cf08cc27b9',
    'Примеры с рынка',
    'Реальные примеры фото запчастей с рынка (чужие объявления Avito/eBay). '
    'Один коллаж = один пример; привязка к smart — в smart_part_examples. '
    'Положительные референсы для VL-моделей.',
    false,
    COALESCE((SELECT MAX(position) + 1 FROM photo_groups), 1)
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS smart_part_examples (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- FK на smart.parts невозможен (другая БД) — формат чекаем локально,
    -- существование валидирует API через smart_ext (FDW).
    smart_part_id TEXT        NOT NULL
                              CHECK (smart_part_id ~ '^smart_[0-9]{8}$'),
    collage_id    UUID        NOT NULL UNIQUE
                              REFERENCES photo_collages(id) ON DELETE CASCADE,
    position      INTEGER     NOT NULL CHECK (position > 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Порядок примеров внутри одного smart уникален.
    UNIQUE (smart_part_id, position)
);

CREATE INDEX IF NOT EXISTS idx_smart_part_examples_smart
    ON smart_part_examples (smart_part_id);

COMMENT ON TABLE smart_part_examples IS
    'Связь smart-запчасть → коллаж-пример в группе «Примеры с рынка». '
    'Один коллаж = один пример, на smart — много примеров. Каноническая '
    'привязка (owner_id коллажа в этой группе всегда NULL).';
COMMENT ON COLUMN smart_part_examples.smart_part_id IS
    'Smart-артикул (smart.parts.id). Существование валидирует API через FDW.';
COMMENT ON COLUMN smart_part_examples.collage_id IS
    'Коллаж-пример (UNIQUE: коллаж принадлежит ровно одному smart).';
COMMENT ON COLUMN smart_part_examples.position IS
    'Порядок показа примеров моделям внутри smart (>0, MAX+1 при создании).';

COMMIT;

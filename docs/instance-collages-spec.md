# Спека: привязка коллажей к конкретным item'ам учёта (instance owners)

Статус: **согласовано, проверено на живых данных, к реализации.**
Принцип проекта, действующий и здесь: **никаких тихих/глупых фолбеков** — любая
неоднозначность или несоответствие завершается явной ошибкой с понятным
сообщением, а не «подставим что-нибудь по умолчанию».

> Дизайн ниже **проверен через live API на реальной базе** (см. раздел 12).
> Ключевые выводы тестов уже учтены: численный ввод требует отдельного
> id-пути; кросс-серверный FDW-join не используем; «Поступления» под item-пикер
> не попадают.

---

## 1. Контекст и проблема

У каждого коллажа (`photo_collages`) есть владелец — пара `owner_kind` +
`owner_id`. Владелец двух видов:

- **`smart_part`** — позиция каталога `smart` (`smart_ext.parts`, id вида
  `smart_10001062`). Коллаж = «фотографии этого артикула на уровне
  номенклатуры». Имя/артикулы тянутся из smart через postgres_fdw.
- **`instance`** — **конкретная физическая единица** из учёта
  (`uchet_ext.items`, целочисленный `id`). У неё своё состояние: `defect`,
  `defect_note`, складской `status`, `note`, и ссылка `smart_part_id` на
  номенклатуру. Коллаж = «фотографии именно этой штуки».

**Проблема.** Ручное создание коллажа («+ New collage» → `CreateCollageDialog`)
**всегда** шлёт `owner_kind: "smart_part"` и ищет владельца только по
smart-каталогу, **игнорируя назначение группы**. Бэкенд `create_collage` тоже
не сверяет вид владельца с группой. Из-за этого в instance-группы (Реальные/
Дефектные фотографии и …на публикацию) могли попадать smart-парт коллажи.

**Цель.** В instance-группах владелец выбирается как **конкретный item учёта**.
Поиск — единым полем: вводишь что угодно (id экземпляра / артикул / smart-id /
название) → получаешь **сразу список подходящих экземпляров**, каждый подписан
своей запчастью.

---

## 2. Доменная модель

### 2.1 `smart_ext.parts` (каталог smart, read-only через FDW, сервер smart_server)

| Колонка | Тип | Назначение |
|---|---|---|
| `id` | text | `smart_NNNNNNNN` |
| `name` | text | человекочитаемое название |
| `articles` | text[] | список артикулов (**бывают чисто цифровые**, напр. `8307973`) |
| `is_draft` | bool | черновик (не фильтруем) |

### 2.2 `uchet_ext.items` (учёт, read-only через FDW, сервер uchet_server)

| Колонка | Тип | Назначение |
|---|---|---|
| `id` | integer | уникальный id физического экземпляра |
| `smart_part_id` | text | к какой позиции smart относится |
| `defect` | bool | бракованный/дефектный экземпляр |
| `defect_note` | text \| null | описание дефекта |
| `status` | text | складской статус (`in_stock`, …) |
| `note` | text \| null | произвольная заметка |

У item **нет своего имени** — название/артикул берём из `smart_ext.parts` по
`smart_part_id`. В UI экземпляр представляем как `#<id> · <название> · <артикул>`
+ бейдж дефекта (+ `defect_note`, если есть).

### 2.3 Хранение владельца

`photo_collages.owner_id` — `text`. Для `smart_part` там `smart_NNN`, для
`instance` — **строковое представление целого id экземпляра** (`"232"`). Так уже
хранит Studio-перенос, формат совместим. Уникальность —
`UNIQUE(group_id, owner_kind, owner_id)` (проверено в БД).

### 2.4 Важно: НЕ джойним два FDW-сервера в одном SQL

`smart_ext.parts` и `uchet_ext.items` живут на **разных** foreign-серверах.
postgres_fdw проталкивает join вниз только когда обе таблицы на одном сервере;
иначе тянет порознь и джойнит локально (подтверждено докой PostgreSQL). Поэтому
**все операции «item ↔ smart» делаем двумя отдельными батч-запросами и сшиваем в
Python** — ровно как уже устроен `studio/article_match_db.py::_build_by_group`.
Единый `JOIN smart_ext.parts … uchet_ext.items` запрещён.

---

## 3. Конфигурация групп (единственный источник истины)

`api/app/studio/groups.py` → `GROUP_SETTINGS`: карта `group_uuid →
(studio_role, owner_kind, defect_filter, accepts_defects)`. Новая группа/смена
роли — правка кода/PR, не запрос в API. Параллельных списков групп не заводим.

| Группа | `studio_role` | `owner_kind` | `defect_filter` | Item-пикер? |
|---|---|---|---|---|
| Эталонные на публикацию | target | smart_part | any (дефекты запрещены) | нет (smart) |
| Avito 2-й аккаунт | target | smart_part | any | нет (smart) |
| Реальные на публикацию | target | instance | without | **да** |
| Дефектные на публикацию | target | instance | with | **да** |
| Реальные фотографии | source | instance | without | **да** |
| Дефектные фотографии | source | instance | with | **да** |
| Поступления | **none** | instance | any | **нет** (трек — отдельная задача) |

**Правило выбора режима создания коллажа по группе** (вычисляется на бэке):

- `cfg is None` → создание **не сконфигурировано** → запрещено;
- `studio_role == "none"` → создание этим механизмом **не поддержано**
  (это «Поступления»: владелец — трек-номер, отдельная задача) → запрещено;
- `owner_kind == "smart_part"` → smart-пикер (как сейчас);
- `owner_kind == "instance"` (и роль не `none`) → **item-пикер** (раздел 5).

`defect_filter` — жёсткий отбор экземпляров: `with` → только `defect=true`;
`without` → только `defect=false`; `any` → без ограничения по дефекту.

---

## 4. Поведение создания коллажа

### 4.1 Выбор сценария

`/groups` (раздел 7.1) отдаёт каждой группе `owner_kind` и `defect_filter`, **но
обнуляет их (`null`) для групп без режима создания** (нет в конфиге или
`studio_role=none`). Фронт читает строго это:

- `owner_kind == null` → кнопка «New collage» **задизейблена** с подписью
  «создание коллажей для этой группы не настроено» (это «Поступления»);
- `owner_kind == "smart_part"` → smart-пикер;
- `owner_kind == "instance"` → item-пикер.

`/studio/target-groups` для этого не подходит — там только target'ы, а
source-группы (Реальные/Дефектные фотографии) тоже instance.

### 4.2 Жёсткое навязывание вида владельца (фикс бага)

`create_collage` обязан:

- `cfg = GROUP_SETTINGS.get(group_id)`; если `None` или `studio_role=="none"`
  → **422** «group is not configured for collage creation» (никакого молчаливого
  smart_part);
- если `payload.owner_kind != cfg.owner_kind` → **422** с пояснением;
- затем `validate_owner_exists(owner_kind, owner_id, group_id)` (раздел 6).

Это закрывает исходный баг: smart-парт в instance-группу больше не пройдёт.

---

## 5. UX item-пикера (instance-группа)

**Одно поле ввода**, debounce, поиск на каждый осмысленный ввод. Никакого
переключателя режимов и никакого «сначала выбери запчасть» — **сразу строки
экземпляров**. Что ввели, то и матчим (источник истины — серверный
`/studio/lookup/item-search`, раздел 7.2):

- ввод параллельно трактуется (а) как **id экземпляра** (если это целое) и
  (б) как **smart-id / название / артикул** запчасти (ILIKE-подстрока);
- каждая строка результата: `#<id> · <название smart-парта> · <артикул>`,
  бейдж дефекта, `defect_note` (если есть), метка «уже есть коллаж».

Ранжирование (проверено): **точный id экземпляра → точный артикул → префикс
smart/название/артикул → вхождение**. Внутри одной запчасти — её экземпляры по
возрастанию id. Лимит ~30 строк.

Правила без глупых фолбеков:

- **Прямое попадание по id** показывается всегда, даже если не проходит
  `defect_filter` или не `in_stock` — но **выбор заблокирован** с явной
  причиной («дефект не подходит для этой группы» / «нет на складе»). Не прячем и
  не подменяем.
- **Матчи по тексту** (артикул/smart/название) дают только **годные**
  экземпляры (нужный дефект-класс + `in_stock`) — чтобы не зашумлять список
  заведомо неподходящими.
- Экземпляр **с существующим коллажом** в этой группе помечается; клик ведёт на
  существующий коллаж, дубль не создаётся.
- Запрос дал совпавшую запчасть, но **годных экземпляров нет** → приглушённая
  подсказка «запчасть найдена, но нет подходящих экземпляров (in_stock +
  дефект-класс)». На реальных данных это частый кейс — не выглядит как «пусто».
- Совсем ничего не нашли → честное «ничего не найдено». Ничего не авто-создаём.

---

## 6. Валидация на бэкенде (без глупых фолбеков)

`validate_owner_exists(kind, owner_id, group_id)`:

- **smart_part**: `owner_id` есть в `smart_ext.parts`, иначе 422.
- **instance**:
  1. `owner_id` парсится в целое — иначе 422 «item_id must be integer»;
  2. экземпляр есть в `uchet_ext.items` — иначе 422 «item not found»;
  3. `status == 'in_stock'` — иначе 422 «item is not in stock»
     (согласовано: in_stock везде, включая «…на публикацию»; ослабление — только
     явной правкой спеки);
  4. проходит `defect_filter` группы — иначе 422 «item defect state does not
     match group».

Все ошибки — явные HTTP-коды с текстом.

---

## 7. Контракты эндпоинтов

### 7.1 `GET /groups` (расширяется)

К каждому элементу добавляются:

```
owner_kind:    "smart_part" | "instance" | null
defect_filter: "with" | "without" | "any" | null
```

Берутся из `GROUP_SETTINGS`, **но `null`, если группы нет в конфиге или
`studio_role == "none"`** (см. 4.1). Также к instance-коллажам в ответах
коллажей добавляются enrichment-поля (раздел 8).

### 7.2 `GET /studio/lookup/item-search?q=&group_id=&limit=` (**новый, основной**)

Единый поиск экземпляров для item-пикера. Гейт: группа в конфиге,
`owner_kind == "instance"`, `studio_role != "none"` — иначе 400.

Алгоритм (батч, без кросс-серверного join):
1. `parts`: `SELECT id,name,articles FROM smart_ext.parts WHERE id ILIKE q OR
   name ILIKE q OR EXISTS(unnest(articles) a WHERE a ILIKE q) LIMIT K`;
2. `items`: `SELECT id,smart_part_id,defect,defect_note,status FROM
   uchet_ext.items WHERE smart_part_id = ANY(matched_ids) AND status='in_stock'
   [AND defect=…]` (defect-фильтр на текстовые матчи);
3. **id-путь**: если `q` — целое, отдельно `SELECT … WHERE id = q` (без
   defect/stock фильтра — вернём как есть с флагами);
4. `existing`: `SELECT owner_id,id FROM photo_collages WHERE group_id=$ AND
   owner_kind='instance' AND owner_id = ANY(item_ids_text)`;
5. сшивка + ранжирование в Python (раздел 5), лимит.

Элемент ответа:

```
{
  item_id: int,
  smart_part_id: str,
  smart_part_name: str | null,
  article: str | null,            // лучший совпавший артикул для подписи
  defect: bool,
  defect_note: str | null,
  status: str,
  in_stock: bool,
  passes_filter: bool,            // проходит ли defect_filter группы
  selectable: bool,               // in_stock AND passes_filter
  block_reason: str | null,       // почему нельзя выбрать (если !selectable)
  existing_collage_id: uuid | null
}
```

`parts_matched` (для подсказки «запчасть есть, экземпляров нет») фронт выводит
сам: если строк нет, но был непустой ввод ≥ порога — показывает hint
(сервер может вернуть `parts_matched` в заголовке/обёртке; в простом варианте —
фронт делает вывод по пустому списку + длине запроса).

> Реализационная заметка: «smart-первый» эндпоинт `/studio/lookup/items`
> (target-only) остаётся как есть для Studio-переноса; **новый** item-search его
> не трогает.

### 7.3 `POST /collages` (правила ужесточаются)

Тело без изменений (`group_id, owner_kind, owner_id`) + проверки 4.2 и 6.
Уникальность — существующая `(group_id, owner_kind, owner_id)` → 409.

---

## 8. Отображение привязанного экземпляра (enrichment)

«У каждого коллажа показывать, к какому item он привязан» — обязательно везде:
грид группы, страница коллажа, хлебные крошки, результаты поиска.

Бэкенд обогащает instance-коллажи (батч, без кросс-join): по `owner_id` →
`uchet_ext.items` (defect, defect_note, smart_part_id) → `smart_ext.parts`
(name, articles). Поля в `Collage`/`CollageDetail`:

```
owner_name:        str | null   // название smart-парта (для instance — через item)
owner_articles:    str[]        // артикулы smart-парта
owner_defect:      bool | null  // только для instance
owner_defect_note: str | null   // только для instance
```

UI instance-коллажа: `#<owner_id> · <owner_name> · <первый артикул>`, бейдж
«дефект» (+ заметка). smart-коллажи — без изменений.

---

## 9. Уникальность и пограничные случаи

- **Один экземпляр — один коллаж в группе** (`UNIQUE(group_id, owner_kind,
  owner_id)`). В разных instance-группах один item даёт разные коллажи (норм).
- **Item сменил дефект-статус после создания** — коллаж не перепривязывается
  (отдельная задача при необходимости).
- **Группа не в конфиге / role=none** — создание запрещено (422 / дизейбл).
- **Прямой id чужого дефект-класса или не in_stock** — показываем, выбор
  блокируем с причиной.

---

## 10. Что НЕ входит в эту итерацию

- «Поступления» (трек-номер, `owner_kind=arrival`) — отдельная задача; сейчас в
  ней создание задизейблено.
- Чистка старых smart-парт коллажей в instance-группах — на живом сервере их нет
  (instance-группы пустые), после фикса не появятся.
- Перепривязка при смене дефект-статуса.
- Изменение Studio-переноса — он уже создаёт instance-коллажи корректно.

---

## 11. Затрагиваемые файлы

- `api/app/studio/groups.py` — источник истины (читаем).
- `api/app/models.py` — `Group.owner_kind/defect_filter`; enrichment-поля в `Collage`/`CollageDetail`.
- `api/app/routers/groups.py` — owner_kind/defect_filter в ответ (null для role=none).
- `api/app/routers/owners.py` — `validate_owner_exists(kind, owner_id, group_id)`.
- `api/app/routers/collages.py` — навязывание owner_kind + enrichment в `_query_collages`/`get_collage`.
- `api/app/studio/article_match_db.py` — helper `search_items(q, group_id, limit, conn)` + helper enrichment по списку item-id.
- `api/app/routers/studio.py` — `GET /studio/lookup/item-search`.
- `api/app/studio/schemas.py` — `ItemSearchResult`.
- `web/lib/types.ts`, `web/lib/api.ts` — типы + `studio.itemSearch`.
- `web/components/collages/NewCollageButton.tsx` — прокинуть owner_kind/defect_filter, дизейбл при null.
- `web/components/collages/CreateCollageDialog.tsx` — ветвление smart/instance.
- `web/components/collages/ItemPicker.tsx` (+ `.module.css`) — единый item-поиск.
- `web/components/collages/CollageGrid.tsx`, `web/components/owners/OwnerCard.tsx` — `#id` + дефект для instance.

---

## 12. Что проверено на живых данных (через публичный API)

1. **Все instance-группы пустые** (0 коллажей) → миграция не нужна.
2. **Артикулы бывают чисто цифровые** (`8307973`) → правило «цифры = только id»
   неверно; нужен единый поиск + отдельный id-путь.
3. **Численный ввод требует id-пути**: `q="232"` по тексту вернул экземпляры
   запчастей, где `232` *внутри артикула* — а сам item #232 (smart_10000136)
   нашёлся только прямым id-резолвом. Поэтому exact-id ставим первым.
4. **defect_filter + in_stock** отрабатывают (чистый экземпляр в `with`-группе →
   пусто); дефектных in_stock сейчас в базе нет, но фильтр корректен.
5. **Кросс-серверный FDW-join** не нужен (доки + структура) → батч-запросы.
6. **Перф**: боевой поиск — ~3 батч-запроса (`WHERE` проталкивается на remote),
   не N+1.

---

## 13. Верификация (после реализации)

1. smart-группы целы: «Эталонные»/«Avito» — поиск по smart, владелец smart_part.
2. instance, текстовый ввод: «Реальные на публикацию» → название/артикул → видны
   только бездефектные in_stock экземпляры → выбор → коллаж `owner_kind=instance`.
3. instance, ввод id: цифровой id → карточка экземпляра; id дефектного в
   «Реальные …» → показан, выбор заблокирован с причиной.
4. Навязывание: POST `/collages` `owner_kind=smart_part` в instance-группу → 422.
5. Несуществующий / не in_stock item → 422.
6. Дубль (группа, item) → 409 либо UI ведёт на существующий коллаж.
7. «Поступления»: кнопка создания задизейблена.
8. Отображение: instance-коллаж показывает `#id · название · артикул` + дефект.
</content>
</invoke>

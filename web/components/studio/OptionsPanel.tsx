"use client";

import type { StudioOptionKey, StudioOptions } from "@/lib/types";
import s from "./OptionsPanel.module.css";

const OPTIONS: { key: StudioOptionKey; label: string; hint: string }[] = [
  {
    key: "replace_bg",
    label: "Заменить задний фон",
    hint: "Берём фон из библиотеки, тени и перспективу подгоняем",
  },
  {
    key: "improve_lighting",
    label: "Улучшить освещение",
    hint: "Мягкий свет, аккуратно — без пластикового глянца",
  },
  {
    key: "straighten_box",
    label: "Выровнять коробку",
    hint: "Сглаживаем вмятины и заломы упаковки. Деталь не трогаем",
  },
  {
    key: "fix_part_microdefects",
    label: "Убрать микродефекты на детали",
    hint: "Только пыль и микро-царапины. Реальный износ остаётся",
  },
  {
    key: "redo_labels",
    label: "Расправить мятые наклейки",
    hint: "Печатный текст и коды — без изменений",
  },
  {
    key: "substitute_date",
    label: "Подменить дату на этикетке",
    hint: "На правдоподобную «~3 месяца назад», формат сохраняется",
  },
  {
    key: "remove_extras",
    label: "Убрать посторонние предметы",
    hint: "Руки, мусор, лишние детали в кадре",
  },
  {
    key: "remove_others_watermark",
    label: "Убрать чужие вотермарки",
    hint: "Логотипы магазинов, оверлеи приложений. Заводская печать остаётся",
  },
  {
    key: "add_watermark",
    label: "Добавить мой вотермарк",
    hint: "Картинка из библиотеки накладывается на результат",
  },
];

interface Props {
  options: StudioOptions;
  onChange: (key: StudioOptionKey, value: boolean) => void;
  customPrompt: string;
  onCustomPromptChange: (v: string) => void;
}

const CUSTOM_LIMIT = 2000;

export default function OptionsPanel({
  options,
  onChange,
  customPrompt,
  onCustomPromptChange,
}: Props) {
  return (
    <div className={s.card}>
      <div className={s.head}>
        <div>
          <h3 className={s.title}>Что делаем</h3>
          <p className={s.sub}>
            Выбранное модель сделает. То что не выбрано — явно запрещено трогать.
          </p>
        </div>
      </div>

      <ul className={s.list}>
        {OPTIONS.map((opt) => (
          <li key={opt.key} className={s.row}>
            <button
              type="button"
              className={`${s.toggle} ${options[opt.key] ? s.on : ""}`}
              onClick={() => onChange(opt.key, !options[opt.key])}
              aria-pressed={options[opt.key]}
            >
              <span className={s.knob} />
            </button>
            <div className={s.text}>
              <span className={s.label}>{opt.label}</span>
              <span className={s.hint}>{opt.hint}</span>
            </div>
          </li>
        ))}
      </ul>

      <div className={s.customHead}>
        <h4 className={s.customTitle}>Свой prompt</h4>
        <span className={s.counter}>
          {customPrompt.length} / {CUSTOM_LIMIT}
        </span>
      </div>
      <textarea
        className={s.textarea}
        rows={4}
        maxLength={CUSTOM_LIMIT}
        value={customPrompt}
        onChange={(e) => onCustomPromptChange(e.target.value)}
        placeholder="Дополнительные инструкции — например «фон тёплый бежевый, мягкая контактная тень»"
      />
    </div>
  );
}

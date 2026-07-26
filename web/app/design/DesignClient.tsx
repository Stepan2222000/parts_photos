"use client";

import { useState } from "react";
import type { BackgroundsOverview, StudioAsset, WatermarkConfig } from "@/lib/types";
import BackgroundsClient from "./BackgroundsClient";
import WatermarkClient from "./WatermarkClient";
import s from "./design.module.css";

type Tab = "backgrounds" | "watermark";

interface Props {
  initialOverview: BackgroundsOverview;
  initialConfig: WatermarkConfig;
  initialLibrary: StudioAsset[];
}

export default function DesignClient({
  initialOverview,
  initialConfig,
  initialLibrary,
}: Props) {
  const [tab, setTab] = useState<Tab>("backgrounds");

  return (
    <div>
      <div className={s.tabs}>
        <button
          type="button"
          className={`${s.tab} ${tab === "backgrounds" ? s.tabActive : ""}`}
          onClick={() => setTab("backgrounds")}
        >
          Задние фоны
        </button>
        <button
          type="button"
          className={`${s.tab} ${tab === "watermark" ? s.tabActive : ""}`}
          onClick={() => setTab("watermark")}
        >
          Вотермарк
        </button>
      </div>

      {tab === "backgrounds" ? (
        <BackgroundsClient initialOverview={initialOverview} />
      ) : (
        <WatermarkClient
          initialConfig={initialConfig}
          initialLibrary={initialLibrary}
        />
      )}
    </div>
  );
}

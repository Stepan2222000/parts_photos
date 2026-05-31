"use client";

import { useState } from "react";
import CollageGrid from "./CollageGrid";
import type { Collage } from "@/lib/types";

type Cond = "all" | "not_defect" | "defect";

const OPTS: { key: Cond; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "not_defect", label: "Без дефекта" },
  { key: "defect", label: "Только дефект" },
];

/** Collage grid with an optional client-side condition filter, for instance
 * groups (e.g. «Реальные фотографии», which now mixes conditions). Filters the
 * already-loaded list by each collage's enriched `owner_condition`. */
export default function GroupCollages({
  collages,
  showFilter,
}: {
  collages: Collage[];
  showFilter: boolean;
}) {
  const [cond, setCond] = useState<Cond>("all");

  const filtered =
    !showFilter || cond === "all"
      ? collages
      : collages.filter((c) =>
          cond === "defect"
            ? c.owner_condition === "defect"
            : c.owner_condition !== "defect",
        );

  return (
    <>
      {showFilter && (
        <div style={{ display: "flex", gap: 6, margin: "18px 0 -8px" }}>
          {OPTS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setCond(o.key)}
              style={{
                height: 30,
                padding: "0 12px",
                borderRadius: 7,
                fontSize: 12.5,
                fontFamily: "inherit",
                cursor: "pointer",
                border:
                  cond === o.key
                    ? "1px solid var(--brand-coral)"
                    : "1px solid var(--border-strong)",
                background:
                  cond === o.key
                    ? "var(--brand-coral-soft, rgba(204,120,92,0.12))"
                    : "transparent",
                color: cond === o.key ? "var(--brand-coral-active)" : "var(--text-muted)",
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      <CollageGrid collages={filtered} />
    </>
  );
}

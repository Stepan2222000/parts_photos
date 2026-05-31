"use client";

import { useState } from "react";
import type { ConditionFilter, OwnerKind } from "@/lib/types";
import CreateCollageDialog from "./CreateCollageDialog";

interface Props {
  groupId: string;
  ownerKind: OwnerKind | null;
  conditionFilter: ConditionFilter | null;
  ownerOptional?: boolean;
  titleRequired?: boolean;
}

const BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  height: 36,
  padding: "0 16px",
  borderRadius: 8,
  fontWeight: 500,
  fontSize: 13.5,
  fontFamily: "inherit",
};

export default function NewCollageButton({
  groupId,
  ownerKind,
  conditionFilter,
  ownerOptional = false,
  titleRequired = false,
}: Props) {
  const [open, setOpen] = useState(false);

  // No creation mode for this group (e.g. "Поступления" — track-number owner).
  if (!ownerKind) {
    return (
      <button
        type="button"
        disabled
        title="Создание коллажей для этой группы не настроено"
        style={{
          ...BTN,
          background: "transparent",
          color: "var(--text-faint)",
          border: "1px dashed var(--border-strong)",
          cursor: "not-allowed",
        }}
      >
        <PlusIcon />
        New collage
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          ...BTN,
          background: "var(--brand-coral)",
          color: "#fff",
          border: "1px solid var(--brand-coral-active)",
          boxShadow: "var(--shadow-coral-inset)",
          cursor: "pointer",
        }}
      >
        <PlusIcon />
        New collage
      </button>
      {open && (
        <CreateCollageDialog
          groupId={groupId}
          ownerKind={ownerKind}
          conditionFilter={conditionFilter}
          ownerOptional={ownerOptional}
          titleRequired={titleRequired}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

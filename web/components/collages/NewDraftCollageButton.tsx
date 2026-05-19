"use client";

import { useState } from "react";
import CreateDraftCollageDialog from "./CreateDraftCollageDialog";

interface Props {
  groupId: string;
}

export default function NewDraftCollageButton({ groupId }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          height: 36,
          padding: "0 16px",
          background: "var(--brand-coral)",
          color: "#fff",
          border: "1px solid var(--brand-coral-active)",
          borderRadius: 8,
          boxShadow: "var(--shadow-coral-inset)",
          fontWeight: 500,
          fontSize: 13.5,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        New collage
      </button>
      {open && <CreateDraftCollageDialog groupId={groupId} onClose={() => setOpen(false)} />}
    </>
  );
}

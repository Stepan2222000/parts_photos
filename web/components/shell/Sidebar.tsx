"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Group } from "@/lib/types";
import CreateGroupDialog from "./CreateGroupDialog";
import SortableGroups from "./SortableGroups";
import ThemeToggle from "./ThemeToggle";
import s from "./Sidebar.module.css";

interface Props {
  groups: Group[];
  activeGroupId?: string;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export default function Sidebar({
  groups,
  activeGroupId,
  mobileOpen = false,
  onCloseMobile,
}: Props) {
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen || !onCloseMobile) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseMobile?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen, onCloseMobile]);

  return (
    <>
      {showCreate && <CreateGroupDialog onClose={() => setShowCreate(false)} />}

      <div
        className={`${s.backdrop} ${mobileOpen ? s.backdropOpen : ""}`}
        onClick={onCloseMobile}
        aria-hidden
      />

      <aside className={`${s.sidebar} ${mobileOpen ? s.open : ""}`}>
        <div className={s.head}>
          <div className={s.logo}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2 13.5 8 19 5l-3 5 6 1.5-6 1.5 3 5-5.5-3L12 22l-1.5-7L5 19l3-5-6-1.5L8 11 5 5l5.5 3z" />
            </svg>
            Photos
          </div>
          <ThemeToggle className={s.themeBtn} />
        </div>

        <button
          className={s.cta}
          type="button"
          onClick={() => {
            setShowCreate(true);
            onCloseMobile?.();
          }}
          aria-label="New group"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className={s.ctaText}>New group</span>
        </button>

        <div className={s.label}>Channels</div>

        <SortableGroups
          groups={groups}
          activeGroupId={activeGroupId}
          onItemClick={onCloseMobile}
        />

        <div className={s.label}>Tools</div>
        <Link
          href="/photos-search"
          className={s.item}
          onClick={onCloseMobile}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
          <span className={s.name}>Search photos</span>
        </Link>
        <Link
          href="/gaps"
          className={s.item}
          onClick={onCloseMobile}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" strokeDasharray="2 2" />
            <rect x="3" y="14" width="7" height="7" rx="1" strokeDasharray="2 2" />
            <path d="M14 17.5h7M17.5 14v7" />
          </svg>
          <span className={s.name}>Пробелы фото</span>
        </Link>
        <Link
          href="/studio"
          className={s.item}
          onClick={onCloseMobile}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l1.9 4.6L18 9.5l-4.1 1.9L12 16l-1.9-4.6L6 9.5l4.1-1.9L12 3z" />
            <path d="M19 14l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7L19 14z" />
            <path d="M5 16l.5 1.2 1.2.5-1.2.5L5 19.4l-.5-1.2-1.2-.5 1.2-.5L5 16z" />
          </svg>
          <span className={s.name}>Studio</span>
        </Link>

        <div className={s.spacer} />
        <div className={s.acct}>
          <div className={s.av}>SS</div>
          <div>
            <div className={s.acctName}>Степан</div>
            <div className={s.acctSub}>Local</div>
          </div>
        </div>
      </aside>
    </>
  );
}

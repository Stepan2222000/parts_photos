"use client";

import Link from "next/link";
import { useState } from "react";
import type { Group } from "@/lib/types";
import CreateGroupDialog from "./CreateGroupDialog";
import SortableGroups from "./SortableGroups";
import ThemeToggle from "./ThemeToggle";
import s from "./Sidebar.module.css";

interface Props {
  groups: Group[];
  activeGroupId?: string;
}

export default function Sidebar({ groups, activeGroupId }: Props) {
  const [showCreate, setShowCreate] = useState(false);

  return (
    <aside className={s.sidebar}>
      {showCreate && <CreateGroupDialog onClose={() => setShowCreate(false)} />}

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
        onClick={() => setShowCreate(true)}
        aria-label="New group"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className={s.ctaText}>New group</span>
      </button>

      <div className={s.label}>Channels</div>

      <SortableGroups groups={groups} activeGroupId={activeGroupId} />

      <div className={s.label}>Tools</div>
      <Link href="/photos-search" className={s.item}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
        <span className={s.name}>Search photos</span>
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
  );
}

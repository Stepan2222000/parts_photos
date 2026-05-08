"use client";

import { useState } from "react";
import type { Group } from "@/lib/types";
import Sidebar from "./Sidebar";
import s from "./Shell.module.css";

interface Props {
  groups: Group[];
  activeGroupId?: string;
  crumbs: { label: string; href?: string; here?: boolean }[];
  topbarRight?: React.ReactNode;
  children: React.ReactNode;
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

export default function Shell({ groups, activeGroupId, crumbs, topbarRight, children }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className={s.shell}>
      <Sidebar
        groups={groups}
        activeGroupId={activeGroupId}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <main className={s.main}>
        <header className={s.topbar}>
          <button
            type="button"
            className={s.hamburger}
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <MenuIcon />
          </button>
          <nav className={s.crumbs}>
            {crumbs.map((c, i) => (
              <span key={i}>
                {i > 0 && <span className={s.sep}> / </span>}
                <span className={c.here ? s.here : undefined}>{c.label}</span>
              </span>
            ))}
          </nav>
          <div className={s.spacer} />
          {topbarRight}
        </header>
        <div className={s.content}>{children}</div>
      </main>
    </div>
  );
}

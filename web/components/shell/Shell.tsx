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

export default function Shell({ groups, activeGroupId, crumbs, topbarRight, children }: Props) {
  return (
    <div className={s.shell}>
      <Sidebar groups={groups} activeGroupId={activeGroupId} />
      <main className={s.main}>
        <header className={s.topbar}>
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

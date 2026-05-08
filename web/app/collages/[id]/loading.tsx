import s from "./loading.module.css";

export default function CollageLoading() {
  return (
    <div className={s.shell}>
      <aside className={s.sidebar}>
        <div className={s.sLogo} />
        <div className={s.sCta} />
        {[...Array(5)].map((_, i) => (
          <div key={i} className={s.sItem} />
        ))}
      </aside>
      <main className={s.main}>
        <div className={s.topbar} />
        <div className={s.content}>
          <div className={s.card}>
            <div className={s.cardThumb} />
            <div className={s.cardMeta}>
              <div className={`${s.bar} ${s.barWide}`} />
              <div className={`${s.bar} ${s.barNarrow}`} />
              <div className={`${s.bar} ${s.barNarrow}`} />
            </div>
          </div>
          <div className={s.h2} />
          <div className={s.grid}>
            {[...Array(6)].map((_, i) => (
              <div key={i} className={s.tile} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

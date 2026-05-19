"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import s from "./GroupSearch.module.css";

interface Props {
  initialQ: string;
  resultsCount: number;
  draftMode?: boolean;
}

const DEBOUNCE_MS = 250;

export default function GroupSearch({ initialQ, resultsCount, draftMode = false }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(initialQ);
  const serverQRef = useRef(initialQ);

  useEffect(() => {
    serverQRef.current = initialQ;
    setQ(initialQ);
  }, [initialQ]);

  useEffect(() => {
    if (q === serverQRef.current) return;

    const handle = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams.toString());
      const trimmed = q.trim();
      if (trimmed) next.set("q", trimmed);
      else next.delete("q");

      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [pathname, q, router, searchParams]);

  return (
    <div className={s.wrap}>
      <div className={s.inputWrap} role="search">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            draftMode ? "Поиск по комментарию" : "Поиск по названию, smart-id или артикулу"
          }
          className={s.input}
          type="search"
        />
      </div>
      {initialQ && (
        <div className={s.stats}>
          <strong>{resultsCount}</strong> результат(ов) по запросу «{initialQ}»
        </div>
      )}
    </div>
  );
}

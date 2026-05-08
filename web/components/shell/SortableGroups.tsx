"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { Group } from "@/lib/types";
import { api, ApiError } from "@/lib/api";
import s from "./Sidebar.module.css";

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="icon-star">
      <path d="M12 2 13.5 8 19 5l-3 5 6 1.5-6 1.5 3 5-5.5-3L12 22l-1.5-7L5 19l3-5-6-1.5L8 11 5 5l5.5 3z" />
    </svg>
  );
}
function StackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 12l9 4 9-4M3 17l9 4 9-4" />
    </svg>
  );
}

function SortableItem({
  group,
  active,
  onClick,
}: {
  group: Group;
  active: boolean;
  onClick?: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 2 : undefined,
    opacity: isDragging ? 0.85 : 1,
  };

  return (
    <Link
      ref={setNodeRef}
      style={style}
      href={`/groups/${group.id}`}
      className={`${s.item} ${active ? s.itemActive : ""} ${isDragging ? s.itemDragging : ""}`}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      {group.is_reference ? <StarIcon /> : <StackIcon />}
      <span className={s.name}>{group.name}</span>
      <span className={s.count}>{group.collages_count}</span>
    </Link>
  );
}

interface Props {
  groups: Group[];
  activeGroupId?: string;
  onItemClick?: () => void;
}

export default function SortableGroups({ groups: initial, activeGroupId, onItemClick }: Props) {
  const router = useRouter();
  const dndId = useId();
  const [groups, setGroups] = useState(initial);

  useEffect(() => {
    setGroups(initial);
  }, [initial]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = groups.findIndex((g) => g.id === active.id);
    const newIndex = groups.findIndex((g) => g.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const prev = groups;
    const next = arrayMove(groups, oldIndex, newIndex).map((g, i) => ({
      ...g,
      position: i + 1,
    }));
    setGroups(next);

    try {
      await api.groups.reorder(
        next.map((g) => ({ group_id: g.id, position: g.position })),
      );
      router.refresh();
    } catch (err) {
      setGroups(prev);
      if (err instanceof ApiError && err.status === 409) {
        alert("Список групп изменился. Обнови страницу и попробуй ещё раз.");
        router.refresh();
      } else {
        alert(`Не удалось переставить группы: ${err}`);
      }
    }
  }

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={groups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
        {groups.map((g) => (
          <SortableItem
            key={g.id}
            group={g}
            active={activeGroupId === g.id}
            onClick={onItemClick}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}

import { ApiError } from "./api";

/** Human-readable message for failed client-side fetch calls. */
export function formatApiError(e: unknown): string {
  if (e instanceof ApiError) {
    try {
      const parsed = JSON.parse(e.body) as { detail?: unknown };
      if (typeof parsed.detail === "string") return parsed.detail;
    } catch {
      /* not JSON */
    }
    return e.body || e.message;
  }
  if (e instanceof TypeError && e.message === "Load failed") {
    return (
      "Нет связи с API. Убедись, что API запущен (обычно :3200) и в api/.env в WEB_ORIGIN есть http://localhost:3000."
    );
  }
  return String(e);
}

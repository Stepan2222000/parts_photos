import { redirect } from "next/navigation";
import { api } from "@/lib/api";

export default async function HomePage() {
  const groups = await api.groups.list();
  if (groups.length === 0) {
    redirect("/groups/empty");
  }
  redirect(`/groups/${groups[0].id}`);
}

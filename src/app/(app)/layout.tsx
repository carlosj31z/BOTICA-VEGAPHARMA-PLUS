import { redirect } from "next/navigation";
import { perfilActual, supabaseServer } from "@/lib/supabase/server";
import { AppProvider } from "@/components/app-context";
import { Shell } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const perfil = await perfilActual();
  if (!perfil) redirect("/login?inactivo=1");
  const sb = await supabaseServer();
  const { data: empresa } = await sb.from("empresa").select("*").eq("id", 1).single();
  return (
    <AppProvider perfil={perfil} empresa={empresa ?? {}}>
      <Shell>{children}</Shell>
    </AppProvider>
  );
}

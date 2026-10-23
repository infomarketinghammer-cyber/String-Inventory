import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { operationTabs } from "@/server/services/production";
import { ProductionView } from "../ProductionView";

/** Production / Operations — one operation's tab, e.g. /production/grinding. */
export default async function ProductionOperationPage(props: {
  params: Promise<{ op: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const [{ op }, sp] = await Promise.all([props.params, props.searchParams]);
  await requireUser();
  const tabs = await operationTabs();
  if (!tabs.some((t) => t.slug === op)) notFound();
  return <ProductionView tab={op} tabs={tabs} ok={sp.ok} err={sp.err} />;
}

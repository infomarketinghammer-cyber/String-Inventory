import { requireUser } from "@/server/auth/session";
import { operationTabs } from "@/server/services/production";
import { ProductionView } from "./ProductionView";

/** Production / Operations — "All" tab (every lot in production, whatever its current operation). */
export default async function ProductionPage(props: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await props.searchParams;
  await requireUser();
  return <ProductionView tabs={await operationTabs()} ok={sp.ok} err={sp.err} />;
}

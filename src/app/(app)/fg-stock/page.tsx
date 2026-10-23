import DashboardCardDetailPage from "../dashboard/[card]/page";

/**
 * FG Stock: every Finished Goods lot in FG Stores (created only by an approved Final Inspection), with its
 * source production lot, inspection, dispatches and balance. Same view as the dashboard "FG Available" card.
 */
export default function FgStockPage() {
  return DashboardCardDetailPage({ params: Promise.resolve({ card: "fg-available" }) });
}

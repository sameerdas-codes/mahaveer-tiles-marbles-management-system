import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api/api";

function formatCurrency(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getSupplierName(purchase) {
  return purchase.supplier_name || "Unknown Supplier";
}

function getBillNumber(purchase) {
  return purchase.bill_number || `PUR-${String(purchase.id).padStart(4, "0")}`;
}

function PurchaseHistory({ onNavigate }) {
  const [purchases, setPurchases] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [recordTypeFilter, setRecordTypeFilter] = useState("All");
  const [expandedPurchaseId, setExpandedPurchaseId] = useState(null);

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const [purchaseResponse, draftResponse] = await Promise.all([
          apiFetch("/api/purchases/"),
          apiFetch("/api/purchase-drafts/"),
        ]);
        const [purchaseData, draftData] = await Promise.all([
          purchaseResponse.json(),
          draftResponse.json(),
        ]);
        if (!purchaseResponse.ok || !draftResponse.ok) {
          const failedData = !purchaseResponse.ok ? purchaseData : draftData;
          throw new Error(
            failedData.detail ||
              failedData.message ||
              "Could not load all purchase history.",
          );
        }
        setPurchases(
          Array.isArray(purchaseData)
            ? purchaseData
            : purchaseData.results || [],
        );
        setDrafts(
          Array.isArray(draftData) ? draftData : draftData.results || [],
        );
      } catch (loadError) {
        setError(loadError.message || "Could not load all purchase history.");
      } finally {
        setLoading(false);
      }
    };
    loadHistory();
  }, []);

  const historyRecords = useMemo(() => {
    const purchaseRecords = purchases.map((purchase) => ({
      ...purchase,
      history_key: `purchase-${purchase.id}`,
      record_type: "Purchase",
      history_status: purchase.is_confirmed
        ? "Confirmed"
        : "Pending confirmation",
      display_supplier: getSupplierName(purchase),
    }));
    const draftRecords = drafts.map((draft) => {
      const items = Array.isArray(draft.items) ? draft.items : [];
      const subtotal = items.reduce(
        (sum, item) =>
          sum +
          Number(
            item.total ||
              Number(item.quantity || 0) *
                Number(item.purchase_price || 0),
          ),
        0,
      );
      return {
        ...draft,
        history_key: `draft-${draft.id}`,
        record_type: "OCR upload",
        history_status: draft.is_verified ? "Verified OCR" : "Needs review",
        display_supplier:
          draft.supplier_name || draft.original_supplier_name || "Unknown Supplier",
        grand_total: subtotal,
        tax: null,
      };
    });
    return [...purchaseRecords, ...draftRecords].sort(
      (left, right) =>
        new Date(right.bill_date || right.created_at || 0) -
        new Date(left.bill_date || left.created_at || 0),
    );
  }, [purchases, drafts]);

  const filteredPurchases = useMemo(() => {
    const searchText = search.trim().toLowerCase();
    return historyRecords.filter((purchase) => {
      const status = purchase.is_confirmed ? "Confirmed" : "Pending";
      const matchesStatus = statusFilter === "All" ||
        purchase.history_status === statusFilter ||
        (purchase.record_type === "Purchase" && status === statusFilter);
      const matchesType =
        recordTypeFilter === "All" ||
        (recordTypeFilter === "Purchases" &&
          purchase.record_type === "Purchase") ||
        (recordTypeFilter === "OCR uploads" &&
          purchase.record_type === "OCR upload");
      const matchesSearch =
        !searchText ||
        getBillNumber(purchase).toLowerCase().includes(searchText) ||
        purchase.display_supplier.toLowerCase().includes(searchText) ||
        String(purchase.id).includes(searchText);
      return matchesStatus && matchesType && matchesSearch;
    });
  }, [historyRecords, search, statusFilter, recordTypeFilter]);

  const totalAmount = filteredPurchases.reduce(
    (sum, purchase) =>
      sum +
      (purchase.record_type === "Purchase"
        ? Number(purchase.grand_total || 0)
        : 0),
    0,
  );
  const confirmedCount = filteredPurchases.filter(
    (purchase) =>
      purchase.record_type === "Purchase" && purchase.is_confirmed,
  ).length;
  const ocrCount = filteredPurchases.filter(
    (purchase) => purchase.record_type === "OCR upload",
  ).length;

  return (
    <section className="purchase-history-page">
      <header className="purchase-history-header">
        <div>
          <span className="purchase-history-eyebrow">PURCHASE MANAGEMENT</span>
          <h2>Purchase History</h2>
          <p>Purchase transactions and saved OCR bills fetched from your database.</p>
        </div>
        <button
          type="button"
          className="purchase-history-back"
          onClick={() => onNavigate?.("purchases")}
        >
          ← Back to Purchases
        </button>
      </header>

      {error && <div className="purchase-history-error" role="alert">{error}</div>}

      <div className="purchase-history-summary">
        <article>
          <span>History Records</span>
          <strong>{loading ? "—" : filteredPurchases.length}</strong>
        </article>
        <article>
          <span>Confirmed Purchases</span>
          <strong>{loading ? "—" : confirmedCount}</strong>
        </article>
        <article>
          <span>OCR Uploads</span>
          <strong>{loading ? "—" : ocrCount}</strong>
        </article>
        <article>
          <span>Recorded Purchase Total</span>
          <strong>{loading ? "—" : formatCurrency(totalAmount)}</strong>
        </article>
      </div>

      <div className="purchase-history-panel">
        <div className="purchase-history-toolbar">
          <div>
            <span>DATABASE RECORDS</span>
            <h3>Purchases & Uploaded Bills</h3>
          </div>
          <div className="purchase-history-filters">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search bill, supplier or ID..."
              aria-label="Search purchase history"
            />
            <select
              value={recordTypeFilter}
              onChange={(event) => setRecordTypeFilter(event.target.value)}
              aria-label="Filter history record type"
            >
              <option value="All">All Records</option>
              <option value="Purchases">Purchases</option>
              <option value="OCR uploads">OCR Uploads</option>
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label="Filter purchase history by status"
            >
              <option value="All">All Status</option>
              <option value="Confirmed">Confirmed</option>
              <option value="Pending confirmation">Pending confirmation</option>
              <option value="Verified OCR">Verified OCR</option>
              <option value="Needs review">Needs review</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="purchase-history-state">Loading purchases and OCR uploads from backend...</div>
        ) : filteredPurchases.length === 0 ? (
          <div className="purchase-history-state">
            <strong>{historyRecords.length ? "No matching records" : "No purchase history yet"}</strong>
            <span>
              {historyRecords.length
                ? "Try a different search term or status filter."
                : "Saved purchase bills and OCR uploads will appear here."}
            </span>
          </div>
        ) : (
          <div className="purchase-history-list">
            {filteredPurchases.map((purchase) => {
              const items = Array.isArray(purchase.items) ? purchase.items : [];
              const subtotal = items.reduce(
                (sum, item) =>
                  sum +
                  Number(
                    item.total ||
                      Number(item.quantity || 0) *
                        Number(item.purchase_price || 0),
                  ),
                0,
              );
              const expanded = expandedPurchaseId === purchase.history_key;
              return (
                <article className="purchase-history-record" key={purchase.history_key}>
                  <div className="purchase-history-record-main">
                    <div className="purchase-history-bill">
                      <span>{purchase.record_type}: {getBillNumber(purchase)}</span>
                      <small>{purchase.record_type === "Purchase" ? "Purchase" : "OCR upload"} #{purchase.id}</small>
                    </div>
                    <div className="purchase-history-supplier">
                      <span>SUPPLIER</span>
                      <strong>{purchase.display_supplier}</strong>
                    </div>
                    <div className="purchase-history-date">
                      <span>DATE</span>
                      <strong>{formatDate(purchase.bill_date || purchase.created_at)}</strong>
                    </div>
                    <div className="purchase-history-total">
                      <span>GRAND TOTAL</span>
                      <strong>{formatCurrency(purchase.grand_total)}</strong>
                    </div>
                    <span
                      className={`purchase-history-status ${
                        purchase.history_status === "Confirmed" ||
                        purchase.history_status === "Verified OCR"
                          ? "confirmed"
                          : "pending"
                      }`}
                    >
                      {purchase.history_status}
                    </span>
                    <button
                      type="button"
                      className="purchase-history-details-button"
                      aria-expanded={expanded}
                      onClick={() =>
                        setExpandedPurchaseId(
                          expanded ? null : purchase.history_key,
                        )
                      }
                    >
                      {expanded ? "Hide items" : `View ${items.length} item${items.length === 1 ? "" : "s"}`}
                    </button>
                  </div>

                  {expanded && (
                    <div className="purchase-history-items">
                      <div className="purchase-history-item-heading">
                        <strong>Bill items</strong>
                        <span>{items.length} lines</span>
                      </div>
                      {items.length ? (
                        <div className="purchase-history-items-table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>Product</th>
                                <th>Code</th>
                                <th>Size / Weight</th>
                                <th>Quantity</th>
                                <th>Rate</th>
                                <th>Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {items.map((item) => (
                                <tr key={item.id}>
                                    <td>{item.product_name || item.original_product_name || "Product"}</td>
                                    <td>{item.product_code || item.original_product_code || "—"}</td>
                                    <td>{[item.size, item.weight].filter(Boolean).join(" · ") || "—"}</td>
                                    <td>{Number(item.quantity || 0).toLocaleString("en-IN")}</td>
                                  <td>{formatCurrency(item.purchase_price)}</td>
                                    <td>{formatCurrency(
                                      item.total ||
                                        Number(item.quantity || 0) *
                                          Number(item.purchase_price || 0),
                                    )}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="purchase-history-no-items">
                          No item lines were saved for this purchase.
                        </p>
                      )}
                      <div className="purchase-history-totals">
                        <span>Items Subtotal <strong>{formatCurrency(subtotal)}</strong></span>
                        {purchase.record_type === "Purchase" && (
                          <span>Tax <strong>{formatCurrency(purchase.tax)}</strong></span>
                        )}
                        <span>
                          {purchase.record_type === "Purchase" ? "Grand Total" : "Extracted Subtotal"}
                          <strong>{formatCurrency(purchase.grand_total)}</strong>
                        </span>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
        {!loading && (
          <footer className="purchase-history-footer">
            Showing {filteredPurchases.length} of {historyRecords.length} database records
          </footer>
        )}
      </div>
    </section>
  );
}

export default PurchaseHistory;

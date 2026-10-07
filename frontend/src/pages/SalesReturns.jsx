import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api/api";

const list = (data) => (Array.isArray(data) ? data : data.results || []);
const quantityText = (value) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

async function getError(response) {
  const data = await response.json().catch(() => ({}));
  if (typeof data === "string") return data;
  if (data.detail || data.message) return data.detail || data.message;
  return Object.values(data).flat().find((value) => typeof value === "string") || "Request failed. Please try again.";
}

function SalesReturns({ dataRevision = 0 }) {
  const [sales, setSales] = useState([]);
  const [returns, setReturns] = useState([]);
  const [saleId, setSaleId] = useState("");
  const [quantities, setQuantities] = useState({});
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      const [salesResponse, returnsResponse] = await Promise.all([
        apiFetch("/api/sales/"),
        apiFetch("/api/sale-returns/"),
      ]);
      const [salesData, returnsData] = await Promise.all([
        salesResponse.json(), returnsResponse.json(),
      ]);
      if (!salesResponse.ok || !returnsResponse.ok) {
        throw new Error((!salesResponse.ok ? salesData : returnsData).detail || "Could not load returns data.");
      }
      setSales(list(salesData).filter((sale) => sale.is_confirmed));
      setReturns(list(returnsData));
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Could not load returns.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [dataRevision]);

  const selectedSale = sales.find((sale) => String(sale.id) === saleId);
  const returnableItems = useMemo(() => {
    if (!selectedSale) return [];
    const sold = new Map();
    (selectedSale.items || []).forEach((item) => {
      const current = sold.get(item.product) || {
        product: item.product,
        name: item.product_name,
        code: item.product_code,
        quantity: 0,
      };
      current.quantity += Number(item.quantity || 0);
      sold.set(item.product, current);
    });
    const alreadyReturned = new Map();
    returns.filter((record) => Number(record.sale) === selectedSale.id).forEach((record) => {
      (record.items || []).forEach((item) => {
        alreadyReturned.set(
          item.product,
          (alreadyReturned.get(item.product) || 0) + Number(item.quantity || 0),
        );
      });
    });
    return [...sold.values()].map((item) => ({
      ...item,
      remaining: Math.max(0, item.quantity - (alreadyReturned.get(item.product) || 0)),
    })).filter((item) => item.remaining > 0);
  }, [selectedSale, returns]);

  const submitReturn = async (event) => {
    event.preventDefault();
    const items = returnableItems
      .filter((item) => Number(quantities[item.product] || 0) > 0)
      .map((item) => ({ product: item.product, quantity: Number(quantities[item.product]) }));
    if (!selectedSale || !items.length) {
      setError("Select a sale and enter a return quantity for at least one item.");
      return;
    }
    const exceeds = items.find((item) => {
      const allowed = returnableItems.find((entry) => entry.product === item.product);
      return item.quantity > allowed.remaining;
    });
    if (exceeds) {
      setError("A return quantity cannot exceed the remaining returnable quantity.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await apiFetch("/api/sale-returns/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sale: selectedSale.id,
          reason,
          items,
        }),
      });
      if (!response.ok) throw new Error(await getError(response));
      setSaleId("");
      setQuantities({});
      setReason("");
      await refresh();
    } catch (saveError) {
      setError(saveError.message || "Could not save return.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="business-page">
      <header className="business-page-header">
        <div><span className="business-eyebrow">AFTER-SALES</span><h1>Sales Returns</h1><p>Record returns against confirmed invoices; accepted items are added back to stock.</p></div>
        <div className="business-header-count"><strong>{loading ? "—" : returns.length}</strong><span>return records</span></div>
      </header>
      {error && <div className="business-alert" role="alert">{error}</div>}

      <div className="business-grid business-grid-returns">
        <form className="business-panel business-form" onSubmit={submitReturn}>
          <div className="business-panel-heading"><div><span className="business-eyebrow">NEW RETURN</span><h2>Record items</h2></div></div>
          <label>
            Confirmed invoice
            <select value={saleId} onChange={(event) => { setSaleId(event.target.value); setQuantities({}); }}>
              <option value="">Select invoice</option>
              {sales.map((sale) => (
                <option key={sale.id} value={sale.id}>
                  {sale.invoice_number} · {sale.customer_name || "Walk-in"} · {new Date(sale.sale_date).toLocaleDateString("en-IN")}
                </option>
              ))}
            </select>
          </label>
          {selectedSale && (
            <div className="business-return-items">
              {returnableItems.length === 0 ? <div className="business-empty compact-empty">All sold quantities on this invoice have already been returned.</div> : returnableItems.map((item) => (
                <label className="business-return-row" key={item.product}>
                  <span><strong>{item.name}</strong><small>Sold {quantityText(item.quantity)} · Returnable {quantityText(item.remaining)}</small></span>
                  <input
                    type="number"
                    min="0"
                    max={item.remaining}
                    step="0.01"
                    value={quantities[item.product] || ""}
                    onChange={(event) => setQuantities((current) => ({ ...current, [item.product]: event.target.value }))}
                    aria-label={`Return quantity for ${item.name}`}
                  />
                </label>
              ))}
            </div>
          )}
          <label>
            Reason (optional)
            <textarea rows="3" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Damage, wrong item, customer request…" />
          </label>
          <button className="business-button primary" disabled={saving || loading || !selectedSale || !returnableItems.length}>
            {saving ? "Saving return…" : "Save return & update stock"}
          </button>
          <small className="business-hint">The server validates cumulative returned quantities and updates stock atomically.</small>
        </form>

        <div className="business-panel">
          <div className="business-panel-heading"><div><span className="business-eyebrow">RETURN REGISTER</span><h2>Return history</h2></div><button className="business-button secondary compact" type="button" onClick={() => { setLoading(true); setError(""); refresh(); }}>Refresh</button></div>
          {loading ? <div className="business-empty">Loading returns…</div> : returns.length === 0 ? <div className="business-empty">No sales returns recorded.</div> : (
            <div className="business-table-wrap">
              <table className="business-table">
                <thead><tr><th>Invoice</th><th>Date</th><th>Items returned</th><th>Reason</th></tr></thead>
                <tbody>{returns.map((record) => (
                  <tr key={record.id}>
                    <td><strong>{record.sale_invoice_number}</strong></td>
                    <td>{record.return_date ? new Date(record.return_date).toLocaleDateString("en-IN") : "—"}</td>
                    <td>{(record.items || []).map((item) => `${item.product_name} × ${quantityText(item.quantity)}`).join(", ") || "—"}</td>
                    <td>{record.reason || "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default SalesReturns;

import { useEffect, useState } from "react";
import { apiFetch } from "../api/api";

const currency = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const localDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

function BusinessReport({ profitLoss = false, dataRevision = 0 }) {
  const today = new Date();
  const [from, setFrom] = useState(localDate(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(localDate(today));
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadReport = async (start = from, end = to) => {
    try {
      const response = await apiFetch(`/api/reports/?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not load report.");
      setReport(data);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Could not load report.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [dataRevision]);

  const summary = report?.summary || {};
  const maxDaily = Math.max(1, ...(report?.daily || []).map((day) => Number(day.sales || 0)));
  const cards = profitLoss
    ? [
      ["Net revenue", currency(summary.net_revenue), "Sales less returns"],
      ["Cost of goods sold", currency(summary.cost_of_goods_sold), "Cost saved at sale time"],
      ["Gross profit", currency(summary.gross_profit), "Revenue after product cost"],
      ["Gross margin", `${Number(summary.gross_margin_percent || 0).toFixed(2)}%`, "Margin on net revenue"],
    ]
    : [
      ["Confirmed sales", summary.sales_count ?? "—", currency(summary.sales_revenue)],
      ["Returns", summary.returns_count ?? "—", currency(summary.return_value)],
      ["Purchases", summary.purchase_count ?? "—", currency(summary.purchase_total)],
      ["Gross profit", currency(summary.gross_profit), "Before operating expenses"],
    ];

  return (
    <section className="business-page">
      <header className="business-page-header">
        <div>
          <span className="business-eyebrow">{profitLoss ? "FINANCIAL PERFORMANCE" : "BUSINESS ANALYTICS"}</span>
          <h1>{profitLoss ? "Profit & Loss" : "Reports"}</h1>
          <p>{profitLoss ? "Sales revenue minus returns and saved product cost." : "A date-filtered view of sales, returns, purchases, and product performance."}</p>
        </div>
        <form className="business-date-filter" onSubmit={(event) => { event.preventDefault(); setLoading(true); setError(""); loadReport(); }}>
          <label>From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>To<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
          <button className="business-button primary" disabled={loading}>{loading ? "Loading…" : "Apply"}</button>
        </form>
      </header>
      {error && <div className="business-alert" role="alert">{error}</div>}

      {profitLoss && report && (
        <div className={`business-notice ${report.cost_basis_complete ? "" : "warning"}`}>
          {report.profit_note}
          {!report.cost_basis_complete && " Some sales in this date range do not have a saved purchase cost, so reported profit may be understated."}
        </div>
      )}

      <div className="business-metric-grid">
        {cards.map(([title, value, description]) => (
          <article className="business-metric" key={title}>
            <span>{title}</span><strong>{loading ? "…" : value}</strong><small>{description}</small>
          </article>
        ))}
      </div>

      <div className="business-grid business-grid-report">
        <section className="business-panel">
          <div className="business-panel-heading"><div><span className="business-eyebrow">DAILY TREND</span><h2>Revenue by day</h2></div></div>
          {loading ? <div className="business-empty">Loading report…</div> : !report?.daily?.length ? <div className="business-empty">No daily data for this period.</div> : (
            <div className="business-bars">
              {report.daily.map((day) => {
                const salesWidth = Math.max(0, (Number(day.sales || 0) / maxDaily) * 100);
                const netWidth = Math.max(0, (Number(day.net || 0) / maxDaily) * 100);
                return (
                  <div className="business-bar-row" key={day.date}>
                    <span>{new Date(`${day.date}T12:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
                    <div className="business-bar-track" title={`Sales ${currency(day.sales)} · Returns ${currency(day.returns)}`}>
                      <i style={{ width: `${salesWidth}%` }} /><b style={{ width: `${netWidth}%` }} />
                    </div>
                    <strong>{currency(day.net)}</strong>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="business-panel">
          <div className="business-panel-heading"><div><span className="business-eyebrow">PAYMENT MIX</span><h2>Sales by payment</h2></div></div>
          {!report?.payment_methods?.length ? <div className="business-empty">{loading ? "Loading…" : "No sales in this period."}</div> : (
            <div className="business-detail-list">
              {report.payment_methods.map((item) => (
                <div key={item.name}><span>{item.name}</span><strong>{currency(item.total)}</strong></div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="business-panel business-products-report">
        <div className="business-panel-heading"><div><span className="business-eyebrow">PRODUCT PERFORMANCE</span><h2>Top selling products</h2></div></div>
        {!report?.top_products?.length ? <div className="business-empty">{loading ? "Loading…" : "No product sales in this period."}</div> : (
          <div className="business-table-wrap">
            <table className="business-table">
              <thead><tr><th>Product</th><th>Quantity sold</th><th>Gross line revenue</th></tr></thead>
              <tbody>{report.top_products.map((product) => (
                <tr key={product.product_id}><td><strong>{product.product_name}</strong></td><td>{Number(product.quantity || 0).toLocaleString("en-IN")}</td><td>{currency(product.revenue)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}

export default BusinessReport;

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api/api";

const PERIOD_OPTIONS = [
  { value: 7, label: "Last 7 Days" },
  { value: 30, label: "Last 30 Days" },
  { value: 90, label: "Last 3 Months" },
];

const CATEGORY_COLORS = [
  "#00d084",
  "#55a8ff",
  "#f4b549",
  "#b995eb",
  "#ff7d8d",
  "#43c6c8",
];

const EMPTY_DATA = {
  summary: {
    sales_this_month: "0",
    sales_count_this_month: 0,
    sales_previous_month: "0",
    purchases_this_month: "0",
    purchases_count_this_month: 0,
    purchases_previous_month: "0",
    product_count: 0,
    customer_count: 0,
  },
  sales_chart: [],
  sales_by_category: [],
  recent_products: [],
  low_stock_products: [],
  recent_sales: [],
};

const formatCurrency = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 0,
  })}`;

const formatDate = (value, options = {}) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", options);
};

const formatCompactCurrency = (value) => {
  const amount = Number(value || 0);
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(0)}k`;
  return `₹${amount.toFixed(0)}`;
};

const monthChange = (currentValue, previousValue) => {
  const current = Number(currentValue || 0);
  const previous = Number(previousValue || 0);

  if (previous <= 0) {
    return current > 0 ? "New this month" : "No activity";
  }

  const percentage = ((current - previous) / previous) * 100;
  return `${percentage > 0 ? "+" : ""}${percentage.toFixed(1)}%`;
};

function Dashboard({ onNavigate, onCustomerSelect, dataRevision = 0 }) {
  const [period, setPeriod] = useState(7);
  const [dashboard, setDashboard] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const loadDashboard = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/dashboard/?days=${period}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.detail || `Dashboard could not load (${response.status}).`,
        );
      }

      setDashboard(data);
    } catch (loadError) {
      console.error("Dashboard loading error:", loadError);
      setError(loadError.message || "Dashboard data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    // Fetching is the external sync; state updates follow its async response.
    // eslint-disable-next-line react/set-state-in-effect
    loadDashboard();
  }, [loadDashboard, reloadKey, dataRevision]);

  const summary = dashboard.summary || EMPTY_DATA.summary;
  const chart = dashboard.sales_chart || [];
  const categories = dashboard.sales_by_category || [];
  const recentProducts = dashboard.recent_products || [];
  const lowStockProducts = dashboard.low_stock_products || [];
  const recentSales = dashboard.recent_sales || [];

  const chartMaximum = Math.max(
    0,
    ...chart.map((item) => Number(item.total || 0)),
  );
  const chartScale = chartMaximum || 1;
  const chartPoints = chart.map((item, index) => {
    const width = 700;
    const height = 190;
    const horizontalPadding = chart.length === 1 ? width / 2 : 12;
    const x =
      chart.length === 1
        ? width / 2
        : horizontalPadding +
          (index * (width - horizontalPadding * 2)) / (chart.length - 1);
    const y =
      height - (Number(item.total || 0) / chartScale) * (height - 14);

    return { ...item, x, y };
  });

  const chartLine = chartPoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const chartArea = chartLine
    ? `${chartLine} L ${chartPoints.at(-1).x} 190 L ${chartPoints[0].x} 190 Z`
    : "";
  const categoryTotal = categories.reduce(
    (sum, item) => sum + Number(item.total || 0),
    0,
  );
  let categoryDegrees = 0;
  const categoryGradient = categories.length
    ? `conic-gradient(${categories
        .map((item, index) => {
          const start = categoryDegrees;
          categoryDegrees +=
            categoryTotal > 0
              ? (Number(item.total || 0) / categoryTotal) * 360
              : 0;
          return `${CATEGORY_COLORS[index % CATEGORY_COLORS.length]} ${start}deg ${categoryDegrees}deg`;
        })
        .join(", ")})`
    : "conic-gradient(#284a52 0deg 360deg)";

  const statCards = [
    {
      className: "sales-card",
      icon: "₹",
      label: "Total Sales",
      value: formatCurrency(summary.sales_this_month),
      indicator: monthChange(
        summary.sales_this_month,
        summary.sales_previous_month,
      ),
      description: `${Number(summary.sales_count_this_month || 0)} invoices this month`,
    },
    {
      className: "purchase-card",
      icon: "🛒",
      label: "Total Purchases",
      value: formatCurrency(summary.purchases_this_month),
      indicator: monthChange(
        summary.purchases_this_month,
        summary.purchases_previous_month,
      ),
      description: `${Number(summary.purchases_count_this_month || 0)} purchases this month`,
    },
    {
      className: "product-card",
      icon: "📦",
      label: "Total Products",
      value: Number(summary.product_count || 0).toLocaleString("en-IN"),
      indicator: `${lowStockProducts.length} low`,
      description: "Products in inventory",
    },
    {
      className: "customer-card",
      icon: "👥",
      label: "Total Customers",
      value: Number(summary.customer_count || 0).toLocaleString("en-IN"),
      indicator: "Registered",
      description: "Customers in system",
    },
  ];

  return (
    <div className="dashboard-layout">
      <section className="dashboard-main">
        <div className="dashboard-header">
          <div className="dashboard-heading">
            <span className="dashboard-overline">BUSINESS OVERVIEW</span>
            <h1>Business Dashboard</h1>
            <p>Live business data from your inventory and transaction records.</p>
          </div>

          <div className="dashboard-date">
            <span>Today</span>
            <strong>
              {formatDate(dashboard.today, {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </strong>
          </div>
        </div>

        {error && (
          <div className="dashboard-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => {
                setError("");
                setLoading(true);
                setReloadKey((value) => value + 1);
              }}
            >
              Retry
            </button>
          </div>
        )}

        <div className="dashboard-cards">
          {statCards.map((card) => (
            <div
              className={`dashboard-card ${card.className}`}
              key={card.label}
            >
              <div className="card-top">
                <div className="card-icon">{card.icon}</div>
                <span className="card-indicator">{card.indicator}</span>
              </div>
              <div className="card-content">
                <span>{card.label}</span>
                <h2>{loading ? "…" : card.value}</h2>
                <small>{card.description}</small>
              </div>
            </div>
          ))}
        </div>

        <div className="dashboard-chart-grid">
          <div className="dashboard-panel sales-overview">
            <div className="panel-header">
              <div>
                <span className="panel-label">PERFORMANCE</span>
                <h3>Sales Overview</h3>
                <p>Daily invoice totals for the selected period</p>
              </div>
              <select
                aria-label="Sales chart period"
                value={period}
                onChange={(event) => {
                  setLoading(true);
                  setError("");
                  setPeriod(Number(event.target.value));
                }}
              >
                {PERIOD_OPTIONS.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="sales-chart dashboard-live-chart">
              <div className="chart-y-axis">
                {[4, 3, 2, 1, 0].map((tick) => (
                  <span key={tick}>
                    {formatCompactCurrency((chartMaximum * tick) / 4)}
                  </span>
                ))}
              </div>
              <div className="chart-area">
                {loading ? (
                  <div className="dashboard-chart-message">Loading sales…</div>
                ) : chartPoints.length ? (
                  <svg
                    className="dashboard-sales-svg"
                    viewBox="0 0 700 190"
                    preserveAspectRatio="none"
                    role="img"
                    aria-label="Daily sales chart"
                  >
                    <defs>
                      <linearGradient
                        id="dashboard-sales-fill"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#00d084"
                          stopOpacity="0.3"
                        />
                        <stop
                          offset="100%"
                          stopColor="#00d084"
                          stopOpacity="0.01"
                        />
                      </linearGradient>
                    </defs>
                    {[0, 1, 2, 3, 4].map((tick) => (
                      <line
                        key={tick}
                        x1="0"
                        x2="700"
                        y1={(190 / 4) * tick}
                        y2={(190 / 4) * tick}
                        className="dashboard-chart-gridline"
                      />
                    ))}
                    {chartArea && (
                      <path
                        d={chartArea}
                        fill="url(#dashboard-sales-fill)"
                      />
                    )}
                    {chartLine && (
                      <path
                        d={chartLine}
                        fill="none"
                        className="dashboard-chart-line"
                      />
                    )}
                    {chartPoints
                      .filter(
                        (_, index) =>
                          chartPoints.length <= 10 ||
                          index % Math.ceil(chartPoints.length / 10) === 0 ||
                          index === chartPoints.length - 1,
                      )
                      .map((point) => (
                        <circle
                          key={point.date}
                          cx={point.x}
                          cy={point.y}
                          r="3"
                          className="dashboard-chart-point"
                        >
                          <title>
                            {formatDate(point.date)}: {formatCurrency(point.total)}
                          </title>
                        </circle>
                      ))}
                  </svg>
                ) : (
                  <div className="dashboard-chart-message">
                    No sales recorded in this period.
                  </div>
                )}
                <div className="dashboard-chart-dates">
                  {chart.map((item, index) => {
                    const labelStep = Math.ceil(chart.length / 7);
                    if (
                      index !== 0 &&
                      index !== chart.length - 1 &&
                      index % labelStep !== 0
                    ) {
                      return null;
                    }
                    return (
                      <span key={item.date}>
                        {formatDate(item.date, {
                          day: "numeric",
                          month: period === 7 ? undefined : "short",
                        })}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="dashboard-panel category-panel">
            <div className="panel-header">
              <div>
                <span className="panel-label">BREAKDOWN</span>
                <h3>Sales by Category</h3>
                <p>Item sales within the selected period</p>
              </div>
            </div>

            <div className="category-content">
              <div
                className="category-chart"
                style={{ background: categoryGradient }}
              >
                <div className="category-chart-inner">
                  <strong>{formatCompactCurrency(categoryTotal)}</strong>
                  <span>Item Sales</span>
                </div>
              </div>

              <div className="category-list dashboard-category-list">
                {categories.length ? (
                  categories.map((item, index) => {
                    const percentage =
                      categoryTotal > 0
                        ? (Number(item.total || 0) / categoryTotal) * 100
                        : 0;
                    return (
                      <div className="category-row" key={item.category}>
                        <div className="category-name">
                          <span
                            className="category-dot"
                            style={{
                              backgroundColor:
                                CATEGORY_COLORS[index % CATEGORY_COLORS.length],
                            }}
                          />
                          <span>{item.category}</span>
                        </div>
                        <strong>{percentage.toFixed(0)}%</strong>
                      </div>
                    );
                  })
                ) : (
                  <div className="dashboard-small-empty">
                    No category sales in this period.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="dashboard-bottom-grid">
          <div className="dashboard-panel">
            <div className="panel-header">
              <div>
                <span className="panel-label">INVENTORY</span>
                <h3>Recent Products</h3>
                <p>Latest products added to your database</p>
              </div>
              <button
                type="button"
                className="view-all-button"
                onClick={() => onNavigate?.("products")}
              >
                View Products →
              </button>
            </div>
            {loading ? (
              <div className="dashboard-list-message">Loading products…</div>
            ) : recentProducts.length ? (
              <div className="dashboard-data-list">
                {recentProducts.map((product) => (
                  <div className="dashboard-data-row" key={product.id}>
                    <div>
                      <strong>{product.name}</strong>
                      <span>
                        {product.product_code || product.category}
                      </span>
                    </div>
                    <b>{Number(product.stock).toLocaleString("en-IN")} in stock</b>
                  </div>
                ))}
              </div>
            ) : (
              <div className="dashboard-list-message">
                No products available yet.
              </div>
            )}
          </div>

          <div className="dashboard-panel">
            <div className="panel-header">
              <div>
                <span className="panel-label">ATTENTION</span>
                <h3>Low Stock Products</h3>
                <p>Products below their stock alert limit</p>
              </div>
              <button
                type="button"
                className="view-all-button"
                onClick={() => onNavigate?.("products")}
              >
                View Products →
              </button>
            </div>
            {loading ? (
              <div className="dashboard-list-message">Checking stock…</div>
            ) : lowStockProducts.length ? (
              <div className="dashboard-data-list">
                {lowStockProducts.map((product) => (
                  <div className="dashboard-data-row" key={product.id}>
                    <div>
                      <strong>{product.name}</strong>
                      <span>{product.category}</span>
                    </div>
                    <b className="dashboard-stock-warning">
                      {Number(product.stock).toLocaleString("en-IN")} left
                    </b>
                  </div>
                ))}
              </div>
            ) : (
              <div className="dashboard-list-message">
                No low-stock products need attention.
              </div>
            )}
          </div>
        </div>
      </section>

      <aside className="recent-orders">
        <div className="recent-orders-header">
          <div>
            <span className="panel-label">ACTIVITY</span>
            <h3>Recent Orders</h3>
            <p>Latest sales and invoices</p>
          </div>
        </div>

        {loading ? (
          <div className="dashboard-list-message">Loading recent orders…</div>
        ) : recentSales.length ? (
          <div className="orders-list">
            {recentSales.map((sale) => (
              <div
                className={`order-item ${sale.customer_id ? "order-item-clickable" : ""}`}
                key={sale.id}
                role={sale.customer_id ? "button" : undefined}
                tabIndex={sale.customer_id ? 0 : undefined}
                onClick={() => {
                  if (sale.customer_id) onCustomerSelect?.(sale.customer_id);
                }}
                onKeyDown={(event) => {
                  if (
                    sale.customer_id &&
                    (event.key === "Enter" || event.key === " ")
                  ) {
                    event.preventDefault();
                    onCustomerSelect?.(sale.customer_id);
                  }
                }}
                aria-label={
                  sale.customer_id
                    ? `Open ${sale.customer_name} customer record for invoice ${sale.invoice_number}`
                    : undefined
                }
              >
                <div className="order-icon">🧾</div>
                <div className="order-info">
                  <strong className="order-customer-name">
                    {sale.customer_name || "Walk-in Customer"}
                  </strong>
                  <span>
                    Invoice #{sale.invoice_number} · {formatDate(sale.sale_date)}
                  </span>
                </div>
                <div className="order-right">
                  <strong>{formatCurrency(sale.grand_total)}</strong>
                  <span className="order-status">
                    {sale.is_confirmed ? "Completed" : "Pending"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="dashboard-list-message">
            No sales or invoices recorded yet.
          </div>
        )}

        {error && !recentSales.length && (
          <button
            type="button"
            className="view-all-button"
            onClick={() => {
              setError("");
              setLoading(true);
              setReloadKey((value) => value + 1);
            }}
          >
            Retry loading dashboard
          </button>
        )}
      </aside>
    </div>
  );
}

export default Dashboard;

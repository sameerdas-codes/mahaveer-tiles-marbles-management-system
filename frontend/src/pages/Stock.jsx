import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api/api";

function getProductUnit(category) {
  if (category === "Adhesive" || category === "Grout") return "Kg";
  if (category === "Sanitary") return "Piece";
  return "Box";
}

function getStockStatus(currentStock, minimumStock) {
  if (currentStock <= 0) {
    return "Out of Stock";
  }

  if (currentStock <= minimumStock) {
    return "Low Stock";
  }

  return "In Stock";
}

function getStatusClass(status) {
  if (status === "In Stock") {
    return "stock-status-in";
  }

  if (status === "Low Stock") {
    return "stock-status-low";
  }

  return "stock-status-out";
}

function Inventory({ dataRevision = 0 }) {
  const [stockItems, setStockItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  useEffect(() => {
    const fetchStock = async () => {
      try {
        setLoading(true);
        setError("");
        const response = await apiFetch("/api/products/");
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.detail || "Failed to load stock.");
        }
        const products = Array.isArray(data) ? data : data.results || [];
        setStockItems(products.map((product) => ({
          id: product.id,
          code: product.product_code || "—",
          product: product.name || "",
          category: product.category || "Uncategorized",
          size: product.size || product.weight || "—",
          unit: getProductUnit(product.category),
          currentStock: Number(product.stock || 0),
          minimumStock: Number(product.low_stock_limit || 0),
        })));
      } catch (fetchError) {
        setError(fetchError.message || "Failed to load stock.");
      } finally {
        setLoading(false);
      }
    };
    fetchStock();
  }, [dataRevision]);

  const categories = useMemo(
    () => [...new Set(stockItems.map((item) => item.category).filter(Boolean))],
    [stockItems],
  );

  const totalItems = stockItems.length;

  const inStockCount = stockItems.filter(
    (item) =>
      getStockStatus(item.currentStock, item.minimumStock) === "In Stock"
  ).length;

  const lowStockCount = stockItems.filter(
    (item) =>
      getStockStatus(item.currentStock, item.minimumStock) === "Low Stock"
  ).length;

  const outOfStockCount = stockItems.filter(
    (item) =>
      getStockStatus(item.currentStock, item.minimumStock) === "Out of Stock"
  ).length;

  const filteredStock = useMemo(() => {
    return stockItems.filter((item) => {
      const status = getStockStatus(
        item.currentStock,
        item.minimumStock
      );

      const searchText = search.toLowerCase().trim();

      const matchesSearch =
        item.product.toLowerCase().includes(searchText) ||
        item.code.toLowerCase().includes(searchText);

      const matchesCategory =
        categoryFilter === "All" ||
        item.category === categoryFilter;

      const matchesStatus =
        statusFilter === "All" ||
        status === statusFilter;

      return (
        matchesSearch &&
        matchesCategory &&
        matchesStatus
      );
    });
  }, [
    stockItems,
    search,
    categoryFilter,
    statusFilter,
  ]);

  return (
    <section className="inventory-page">

      {/* PAGE HEADER */}
      <div className="inventory-header">
        <div>
          <span className="inventory-eyebrow">
            INVENTORY MANAGEMENT
          </span>

          <h2 className="inventory-title">
            Stock
          </h2>

          <p className="inventory-subtitle">
            Monitor current product stock and availability
          </p>
        </div>
      </div>

      {error && <div className="inventory-empty" role="alert">{error}</div>}

      {/* SUMMARY CARDS */}
      <div className="inventory-summary-grid">

        <div className="inventory-summary-card">
          <div className="inventory-summary-icon">
            ▤
          </div>

          <div>
            <span>Total Items</span>
            <strong>{totalItems}</strong>
          </div>
        </div>

        <div className="inventory-summary-card">
          <div className="inventory-summary-icon inventory-icon-in">
            ✓
          </div>

          <div>
            <span>In Stock</span>
            <strong>{inStockCount}</strong>
          </div>
        </div>

        <div className="inventory-summary-card">
          <div className="inventory-summary-icon inventory-icon-low">
            !
          </div>

          <div>
            <span>Low Stock</span>
            <strong>{lowStockCount}</strong>
          </div>
        </div>

        <div className="inventory-summary-card">
          <div className="inventory-summary-icon inventory-icon-out">
            ×
          </div>

          <div>
            <span>Out of Stock</span>
            <strong>{outOfStockCount}</strong>
          </div>
        </div>

      </div>

      {/* FILTER BAR */}
      <div className="inventory-toolbar">

        <div className="inventory-search">
          <span>⌕</span>

          <input
            type="text"
            placeholder="Search product or code..."
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
          />
        </div>

        <select
          className="inventory-filter"
          value={categoryFilter}
          onChange={(event) =>
            setCategoryFilter(event.target.value)
          }
        >
          <option value="All">
            All Categories
          </option>

          {categories.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>

        <select
          className="inventory-filter"
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value)
          }
        >
          <option value="All">
            All Stock
          </option>

          <option value="In Stock">
            In Stock
          </option>

          <option value="Low Stock">
            Low Stock
          </option>

          <option value="Out of Stock">
            Out of Stock
          </option>
        </select>

      </div>

      {/* STOCK TABLE */}
      <div className="inventory-table-panel">

        <div className="inventory-table-header">
          <div>
            <h3>
              Current Stock
            </h3>

            <p>
              {filteredStock.length} products found
            </p>
          </div>
        </div>

        <div className="inventory-table-wrapper">

          <table className="inventory-table">

            <thead>
              <tr>
                <th>PRODUCT</th>
                <th>CATEGORY</th>
                <th>SIZE / WEIGHT</th>
                <th>UNIT</th>
                <th>CURRENT STOCK</th>
                <th>MIN STOCK</th>
                <th>STATUS</th>
              </tr>
            </thead>

            <tbody>

              {!loading && filteredStock.map((item) => {
                const status = getStockStatus(
                  item.currentStock,
                  item.minimumStock
                );

                return (
                  <tr key={item.id}>

                    <td>
                      <div className="inventory-product">

                        <div className="inventory-product-icon">
                          {item.category === "Adhesive" ||
                          item.category === "Grout"
                            ? "◈"
                            : "▦"}
                        </div>

                        <div>
                          <strong>
                            {item.product}
                          </strong>

                          <span>
                            {item.code}
                          </span>
                        </div>

                      </div>
                    </td>

                    <td>
                      <span className="inventory-category">
                        {item.category}
                      </span>
                    </td>

                    <td>
                      <span className="inventory-size">
                        {item.size}
                      </span>
                    </td>

                    <td>
                      <span className="inventory-unit">
                        {item.unit}
                      </span>
                    </td>

                    <td>
                      <strong className="current-stock">
                        {item.currentStock.toLocaleString(
                          "en-IN"
                        )}
                      </strong>
                    </td>

                    <td>
                      <span className="minimum-stock">
                        {item.minimumStock.toLocaleString(
                          "en-IN"
                        )}
                      </span>
                    </td>

                    <td>
                      <span
                        className={`inventory-status ${getStatusClass(
                          status
                        )}`}
                      >
                        <span className="inventory-status-dot"></span>
                        {status}
                      </span>
                    </td>

                  </tr>
                );
              })}

            </tbody>

          </table>

          {loading ? (
            <div className="inventory-empty">Loading stock...</div>
          ) : filteredStock.length === 0 && (
            <div className="inventory-empty">
              <div>⌕</div>

              <h3>
                No stock found
              </h3>

              <p>
                Try changing your search or filters.
              </p>
            </div>
          )}

        </div>

        <div className="inventory-table-footer">
          Showing {filteredStock.length} of{" "}
          {stockItems.length} products
        </div>

      </div>

    </section>
  );
}

export default Inventory;
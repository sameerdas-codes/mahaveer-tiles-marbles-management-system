import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api/api";

const list = (data) => (Array.isArray(data) ? data : data.results || []);
const currency = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function Customers({
  selectedCustomerId = null,
  onClearCustomerSelection,
  dataRevision = 0,
}) {
  const [customers, setCustomers] = useState([]);
  const [sales, setSales] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [downloadingSaleId, setDownloadingSaleId] = useState(null);
  const [error, setError] = useState("");

  const loadCustomers = async () => {
    try {
      const [customerResponse, salesResponse] = await Promise.all([
        apiFetch("/api/customers/"),
        apiFetch("/api/sales/"),
      ]);
      const [customerData, salesData] = await Promise.all([
        customerResponse.json(),
        salesResponse.json(),
      ]);
      if (!customerResponse.ok || !salesResponse.ok) {
        const failure = !customerResponse.ok ? customerData : salesData;
        throw new Error(failure.detail || "Could not load sales customers.");
      }
      setCustomers(list(customerData));
      setSales(list(salesData));
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Could not load sales customers.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, [dataRevision]);

  useEffect(() => {
    if (!selectedCustomerId) return;
    const customer = customers.find(
      (item) => Number(item.id) === Number(selectedCustomerId),
    );
    if (customer) setSearch(customer.name);
  }, [selectedCustomerId, customers]);

  const downloadInvoice = async (customerId, sale) => {
    if (Number(sale.customer) !== Number(customerId)) {
      setError("This invoice does not belong to the selected customer.");
      return;
    }

    setDownloadingSaleId(sale.id);
    setError("");
    try {
      const response = await apiFetch(`/api/sales/${sale.id}/invoice/`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || data.message || "Could not download this invoice.");
      }
      if (!response.headers.get("Content-Type")?.includes("application/pdf")) {
        throw new Error("The server response was not a PDF invoice.");
      }

      const invoiceBlob = await response.blob();
      const downloadUrl = URL.createObjectURL(invoiceBlob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      const customerPart = customer.name
        .trim()
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "") || "Customer";
      const invoicePart = sale.invoice_number
        .replace(/[^a-z0-9_-]/gi, "-")
        .replace(/-+/g, "-");
      link.download = `${customerPart}-${invoicePart}-${sale.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (downloadError) {
      setError(downloadError.message || "Could not download this invoice.");
    } finally {
      setDownloadingSaleId(null);
    }
  };

  const salesCustomers = useMemo(() => {
    const directory = new Map();
    sales.forEach((sale) => {
      if (sale.customer == null) return;
      const id = Number(sale.customer);
      const customer = customers.find((item) => Number(item.id) === id);
      if (!customer) return;
      const current = directory.get(id) || {
        ...customer,
        saleCount: 0,
        totalSpent: 0,
        lastSaleDate: "",
        bills: [],
      };
      current.saleCount += 1;
      current.totalSpent += Number(sale.grand_total || 0);
      current.bills.push(sale);
      if (!current.lastSaleDate || new Date(sale.sale_date) > new Date(current.lastSaleDate)) {
        current.lastSaleDate = sale.sale_date;
      }
      directory.set(id, current);
    });
    return [...directory.values()].sort((left, right) =>
      new Date(right.lastSaleDate || 0) - new Date(left.lastSaleDate || 0),
    );
  }, [customers, sales]);

  const filtered = useMemo(() => {
    if (selectedCustomerId) {
      return salesCustomers.filter(
        (customer) => Number(customer.id) === Number(selectedCustomerId),
      );
    }
    const query = search.trim().toLowerCase();
    if (!query) return salesCustomers;
    return salesCustomers.filter((customer) =>
      [customer.name, customer.phone, customer.address]
        .some((value) => String(value || "").toLowerCase().includes(query)),
    );
  }, [salesCustomers, search, selectedCustomerId]);

  return (
    <section className="business-page">
      <header className="business-page-header">
        <div>
          <span className="business-eyebrow">CUSTOMER DIRECTORY</span>
          <h1>Customers</h1>
          <p>Customers are added automatically from sales. No manual customer entry is needed.</p>
        </div>
        <div className="business-header-count">
          <strong>{loading ? "—" : salesCustomers.length}</strong>
          <span>customers with sales</span>
        </div>
      </header>

      {error && <div className="business-alert" role="alert">{error}</div>}

      <div className="business-panel">
        <div className="business-panel-heading">
          <div>
            <span className="business-eyebrow">SALES-BASED DIRECTORY</span>
            <h2>Customers from sales</h2>
            {selectedCustomerId && (
              <button
                className="business-button secondary compact"
                type="button"
                onClick={() => {
                  setSearch("");
                  onClearCustomerSelection?.();
                }}
              >
                Clear customer selection
              </button>
            )}
          </div>
          <div className="business-customer-toolbar">
            <input
              className="business-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, phone, address"
              aria-label="Search customers"
            />
            <button
              className="business-button secondary compact"
              type="button"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                loadCustomers();
              }}
            >
              Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="business-empty">Loading customers from sales…</div>
        ) : error ? null : filtered.length === 0 ? (
          <div className="business-empty">
            {salesCustomers.length
              ? "No matching customers."
              : "Customers will appear here automatically after you add a sale with customer details."}
          </div>
        ) : (
          <div className="business-table-wrap">
            <table className="business-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Address</th>
                  <th>Sales</th>
                  <th>Total billed</th>
                  <th>Last sale</th>
                  <th>Bill PDF downloads</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((customer) => (
                  <tr
                    className={
                      Number(customer.id) === Number(selectedCustomerId)
                        ? "business-customer-selected"
                        : ""
                    }
                    key={customer.id}
                  >
                    <td><strong>{customer.name}</strong></td>
                    <td>{customer.phone || "—"}</td>
                    <td>{customer.address || "—"}</td>
                    <td>{customer.saleCount}</td>
                    <td>{currency(customer.totalSpent)}</td>
                    <td>
                      {customer.lastSaleDate
                        ? new Date(customer.lastSaleDate).toLocaleDateString("en-IN")
                        : "—"}
                    </td>
                    <td>
                      <div className="business-customer-bills">
                        {customer.bills
                          .sort((left, right) => new Date(right.sale_date) - new Date(left.sale_date))
                          .map((sale) => (
                            <div className="business-customer-bill" key={sale.id}>
                              <div>
                                <strong>{sale.invoice_number}</strong>
                                <small>
                                  {new Date(sale.sale_date).toLocaleDateString("en-IN")}
                                  {" · "}
                                  {currency(sale.grand_total)}
                                  {" · "}
                                  {sale.is_confirmed ? "Confirmed" : "Pending"}
                                </small>
                              </div>
                              {sale.is_confirmed ? (
                                <button
                                  className="business-button secondary compact"
                                  type="button"
                                  disabled={downloadingSaleId === sale.id}
                                  onClick={() => downloadInvoice(customer.id, sale)}
                                >
                                  {downloadingSaleId === sale.id ? "Downloading…" : "Download PDF"}
                                </button>
                              ) : (
                                <span className="business-status pending">Confirm sale first</span>
                              )}
                            </div>
                          ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

export default Customers;

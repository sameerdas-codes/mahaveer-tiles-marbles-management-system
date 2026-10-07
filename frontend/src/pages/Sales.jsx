import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api/api";

const currency = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const list = (data) => (Array.isArray(data) ? data : data.results || []);

async function requestError(response) {
  const data = await response.json().catch(() => ({}));
  if (typeof data === "string") return data;
  if (data.detail || data.message) return data.detail || data.message;
  return Object.values(data).flat().find((value) => typeof value === "string") ||
    "Request failed. Please try again.";
}

function Sales({ onSalesChanged }) {
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [sales, setSales] = useState([]);
  const [cart, setCart] = useState([]);
  const [productEntries, setProductEntries] = useState([
    { productId: "", quantity: "1", query: "" },
  ]);
  const [activeProductEntry, setActiveProductEntry] = useState(null);
  const [customerId, setCustomerId] = useState("");
  const [newCustomer, setNewCustomer] = useState({
    name: "",
    phone: "",
    address: "",
  });
  const [discount, setDiscount] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      const responses = await Promise.all([
        apiFetch("/api/products/"),
        apiFetch("/api/customers/"),
        apiFetch("/api/sales/"),
      ]);
      const payloads = await Promise.all(responses.map((response) => response.json()));
      const failedIndex = responses.findIndex((response) => !response.ok);
      if (failedIndex >= 0) {
        throw new Error(payloads[failedIndex].detail || "Could not load sales data.");
      }
      setProducts(list(payloads[0]));
      setCustomers(list(payloads[1]));
      setSales(list(payloads[2]));
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Could not load sales data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (activeProductEntry === null) return undefined;

    const closeProductOptions = (event) => {
      if (!event.target.closest?.(".business-product-picker")) {
        setActiveProductEntry(null);
      }
    };

    document.addEventListener("pointerdown", closeProductOptions);
    return () => {
      document.removeEventListener("pointerdown", closeProductOptions);
    };
  }, [activeProductEntry]);

  const subtotal = useMemo(
    () => cart.reduce((sum, item) => sum + Number(item.quantity) * Number(item.selling_price), 0),
    [cart],
  );
  const grandTotal = Math.max(0, subtotal - Number(discount || 0));
  const addProductEntry = () => {
    setProductEntries((current) => [
      ...current,
      { productId: "", quantity: "1", query: "" },
    ]);
  };

  const updateProductEntry = (index, field, value) => {
    setProductEntries((current) => current.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry,
    ));
  };

  const addItems = () => {
    const selectedEntries = productEntries.filter((entry) => entry.productId);
    if (!selectedEntries.length) {
      setError("Select at least one product.");
      return;
    }

    const additions = new Map();
    for (const entry of selectedEntries) {
      const product = products.find(
        (item) => String(item.id) === entry.productId,
      );
      const amount = Number(entry.quantity);
      if (!product || Number(product.stock || 0) <= 0) {
        setError("Choose a product that is currently in stock.");
        return;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        setError(`Enter a valid quantity for ${product.name}.`);
        return;
      }
      additions.set(
        product.id,
        (additions.get(product.id) || 0) + amount,
      );
    }

    for (const [id, amount] of additions) {
      const product = products.find((item) => item.id === id);
      const existingQuantity = Number(
        cart.find((item) => item.product === id)?.quantity || 0,
      );
      if (existingQuantity + amount > Number(product.stock || 0)) {
        setError(
          `Only ${product.stock} ${product.name} currently in stock.`,
        );
        return;
      }
    }

    setCart((current) => {
      const nextCart = [...current];
      for (const [id, amount] of additions) {
        const product = products.find((item) => item.id === id);
        const existingIndex = nextCart.findIndex((item) => item.product === id);
        if (existingIndex >= 0) {
          nextCart[existingIndex] = {
            ...nextCart[existingIndex],
            quantity: Number(nextCart[existingIndex].quantity) + amount,
          };
        } else {
          nextCart.push({
            product: product.id,
            product_name: product.name,
            product_code: product.product_code,
            stock: Number(product.stock || 0),
            quantity: amount,
            selling_price: Number(product.selling_price || 0),
          });
        }
      }
      return nextCart;
    });
    setProductEntries([{ productId: "", quantity: "1", query: "" }]);
    setActiveProductEntry(null);
    setError("");
  };

  const createSale = async (event) => {
    event.preventDefault();
    if (!cart.length) {
      setError("Add at least one product to the sale.");
      return;
    }
    if (Number(discount || 0) < 0 || Number(discount || 0) > subtotal) {
      setError("Discount must be between zero and the sale subtotal.");
      return;
    }
    setSaving(true);
    setError("");
    const invoiceNumber = `SALE-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${Date.now().toString().slice(-6)}`;
    try {
      const response = await apiFetch("/api/sales/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice_number: invoiceNumber,
          customer: customerId && customerId !== "new" ? Number(customerId) : null,
          ...(customerId === "new" ? {
            new_customer_name: newCustomer.name,
            customer_phone: newCustomer.phone,
            customer_address: newCustomer.address,
          } : {}),
          discount: Number(discount || 0),
          payment_method: paymentMethod,
          items: cart.map((item) => ({
            product: item.product,
            quantity: item.quantity,
            selling_price: item.selling_price,
          })),
        }),
      });
      if (!response.ok) throw new Error(await requestError(response));
      onSalesChanged?.();
      setCart([]);
      setDiscount("0");
      setCustomerId("");
      setNewCustomer({ name: "", phone: "", address: "" });
      await refresh();
    } catch (saveError) {
      setError(saveError.message || "Could not create sale.");
    } finally {
      setSaving(false);
    }
  };

  const confirmSale = async (sale) => {
    if (!window.confirm(`Confirm ${sale.invoice_number}? This will deduct the sold quantities from stock.`)) return;
    try {
      const response = await apiFetch(`/api/sales/${sale.id}/confirm/`, { method: "POST" });
      if (!response.ok) throw new Error(await requestError(response));
      onSalesChanged?.();
      await refresh();
    } catch (confirmError) {
      setError(confirmError.message || "Could not confirm sale.");
    }
  };

  const downloadInvoice = async (sale) => {
    setDownloadingId(sale.id);
    setError("");
    try {
      const response = await apiFetch(`/api/sales/${sale.id}/invoice/`);
      if (!response.ok) throw new Error(await requestError(response));
      const invoiceBlob = await response.blob();
      const downloadUrl = URL.createObjectURL(invoiceBlob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      const customerPart = (sale.customer_name || "Walk-in-Customer")
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
      setError(downloadError.message || "Could not download invoice PDF.");
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <section className="business-page">
      <header className="business-page-header">
        <div>
          <span className="business-eyebrow">SALES MANAGEMENT</span>
          <h1>Sales</h1>
          <p>Create a draft invoice, then confirm it to update inventory.</p>
        </div>
        <div className="business-header-count">
          <strong>{loading ? "—" : sales.length}</strong>
          <span>sales on record</span>
        </div>
      </header>
      {error && <div className="business-alert" role="alert">{error}</div>}

      <div className="business-grid business-grid-sales">
        <form className="business-panel business-form" onSubmit={createSale}>
          <div className="business-panel-heading">
            <div><span className="business-eyebrow">NEW TRANSACTION</span><h2>Create sale</h2></div>
          </div>
          <label>
            Customer
            <select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="">Walk-in customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` · ${customer.phone}` : ""}</option>
              ))}
              <option value="new">Add customer with this sale</option>
            </select>
          </label>
          {customerId === "new" && (
            <>
              <label>
                Customer name
                <input
                  required
                  value={newCustomer.name}
                  onChange={(event) => setNewCustomer((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Full name"
                />
              </label>
              <div className="business-inline-fields">
                <label className="business-grow">
                  Phone number
                  <input
                    value={newCustomer.phone}
                    onChange={(event) => setNewCustomer((current) => ({ ...current, phone: event.target.value }))}
                    inputMode="tel"
                    placeholder="Optional; used to match repeat customers"
                  />
                </label>
              </div>
              <label>
                Address
                <input
                  value={newCustomer.address}
                  onChange={(event) => setNewCustomer((current) => ({ ...current, address: event.target.value }))}
                  placeholder="Optional address"
                />
              </label>
            </>
          )}
          <div className="business-panel-heading business-products-heading">
            <div>
              <span className="business-eyebrow">SALE ITEMS</span>
              <h2>Products</h2>
            </div>
            <button
              className="business-button secondary compact"
              type="button"
              onClick={addProductEntry}
            >
              + Add another product
            </button>
          </div>
          <div className="business-product-entries">
            {productEntries.map((entry, index) => {
              const selectedProduct = products.find(
                (product) => String(product.id) === entry.productId,
              );
              const availableProducts = products.filter(
                (product) => {
                  const stock = Number(product.stock || 0);
                  const query = (entry.query || "").trim().toLowerCase();
                  return stock > 0 && (
                    !query ||
                    [product.name, product.product_code, product.category]
                      .some((value) =>
                        String(value || "").toLowerCase().includes(query),
                      )
                  );
                },
              );
              const reservedQuantity = selectedProduct
                ? Number(
                    cart.find((item) => item.product === selectedProduct.id)
                      ?.quantity || 0,
                  )
                : 0;
              const remainingStock = selectedProduct
                ? Math.max(
                    0,
                    Number(selectedProduct.stock || 0) - reservedQuantity,
                  )
                : 0;
              return (
                <div className="business-product-entry" key={index}>
                  <div className="business-grow business-product-picker">
                    <label htmlFor={`sale-product-search-${index}`}>
                      Product {index + 1}
                    </label>
                    <input
                      id={`sale-product-search-${index}`}
                      type="search"
                      autoComplete="off"
                      value={entry.query || ""}
                      placeholder="Search in-stock products by name or code"
                      aria-expanded={activeProductEntry === index}
                      aria-controls={`sale-product-options-${index}`}
                      onFocus={() => setActiveProductEntry(index)}
                      onChange={(event) =>
                        setProductEntries((current) =>
                          current.map((currentEntry, entryIndex) =>
                            entryIndex === index
                              ? {
                                  ...currentEntry,
                                  productId: "",
                                  query: event.target.value,
                                }
                              : currentEntry,
                          ),
                        )
                      }
                    />
                    {activeProductEntry === index && (
                      <div
                        className="business-product-options"
                        id={`sale-product-options-${index}`}
                      >
                        {availableProducts.length ? (
                          availableProducts.slice(0, 20).map((product) => (
                            <button
                              className="business-product-option"
                              key={product.id}
                              type="button"
                              onClick={() => {
                                setProductEntries((current) =>
                                  current.map((currentEntry, entryIndex) =>
                                    entryIndex === index
                                      ? {
                                          ...currentEntry,
                                          productId: String(product.id),
                                          query: product.name,
                                        }
                                      : currentEntry,
                                  ),
                                );
                                setActiveProductEntry(null);
                              }}
                            >
                              <span className="business-product-option-name">
                                <strong>{product.name}</strong>
                                <small>
                                  {product.product_code || "No product code"}
                                  {product.category ? ` · ${product.category}` : ""}
                                </small>
                              </span>
                              <span className="business-stock-badge">
                                Stock: {product.stock}
                              </span>
                              <strong className="business-product-option-price">
                                {currency(product.selling_price)}
                              </strong>
                            </button>
                          ))
                        ) : (
                          <div className="business-product-options-empty">
                            {products.some(
                              (product) => Number(product.stock || 0) > 0,
                            )
                              ? "No in-stock products match this search."
                              : "There are currently no products in stock."}
                          </div>
                        )}
                        {availableProducts.length > 20 && (
                          <small className="business-product-options-note">
                            Showing first 20 matches. Refine your search to find another product.
                          </small>
                        )}
                      </div>
                      )}
                  </div>
                  <label className="business-quantity">
                    Qty
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={entry.quantity}
                      onChange={(event) =>
                        updateProductEntry(index, "quantity", event.target.value)
                      }
                    />
                  </label>
                  {productEntries.length > 1 && (
                    <button
                      className="business-button danger compact business-remove-entry"
                      type="button"
                      aria-label={`Remove product row ${index + 1}`}
                      onClick={() => {
                        setActiveProductEntry(null);
                        setProductEntries((current) =>
                          current.filter((_, entryIndex) => entryIndex !== index),
                        );
                      }}
                    >
                      Remove
                    </button>
                  )}
                  <div className="business-hint business-entry-hint">
                    {selectedProduct ? (
                      <>
                        <span className="business-stock-badge prominent">
                          {remainingStock} available
                        </span>
                        <span>
                          {selectedProduct.product_code
                            ? `${selectedProduct.product_code} · `
                            : ""}
                          Unit price: {currency(selectedProduct.selling_price)}
                        </span>
                      </>
                    ) : (
                      <span>Only products currently in stock can be selected.</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <button
            className="business-button primary"
            type="button"
            disabled={!products.some((product) => Number(product.stock || 0) > 0)}
            onClick={addItems}
          >
            Add selected products to sale
          </button>

          <div className="business-cart">
            {cart.length === 0 ? <div className="business-empty compact-empty">Products added to the invoice will appear here.</div> : cart.map((item) => (
              <div className="business-cart-row" key={item.product}>
                <div><strong>{item.product_name}</strong><small>{item.quantity} × {currency(item.selling_price)}</small></div>
                <strong>{currency(item.quantity * item.selling_price)}</strong>
                <button type="button" aria-label={`Remove ${item.product_name}`} onClick={() => setCart((current) => current.filter((row) => row.product !== item.product))}>×</button>
              </div>
            ))}
          </div>

          <div className="business-inline-fields">
            <label className="business-grow">
              Payment method
              <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                {["Cash", "UPI", "Card", "Bank Transfer", "Credit"].map((method) => <option key={method}>{method}</option>)}
              </select>
            </label>
            <label className="business-grow">
              Discount (₹)
              <input type="number" min="0" step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} />
            </label>
          </div>
          <div className="business-totals">
            <span>Subtotal <strong>{currency(subtotal)}</strong></span>
            <span>Grand total <strong>{currency(grandTotal)}</strong></span>
          </div>
          <button className="business-button primary" disabled={saving || loading}>{saving ? "Saving…" : "Save draft sale"}</button>
          <small className="business-hint">Stock changes only after you confirm the sale below.</small>
        </form>

        <div className="business-panel">
          <div className="business-panel-heading">
            <div><span className="business-eyebrow">INVOICE REGISTER</span><h2>Recent sales</h2></div>
            <button type="button" className="business-button secondary compact" onClick={() => { setLoading(true); setError(""); refresh(); }}>Refresh</button>
          </div>
          {loading ? <div className="business-empty">Loading sales…</div> : sales.length === 0 ? (
            <div className="business-empty">No sales have been created yet.</div>
          ) : (
            <div className="business-table-wrap">
              <table className="business-table">
                <thead><tr><th>Invoice / customer</th><th>Items</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>{sales.map((sale) => (
                  <tr key={sale.id}>
                    <td><strong>{sale.invoice_number}</strong><small className="business-cell-note">{sale.customer_name || "Walk-in"} · {sale.sale_date ? new Date(sale.sale_date).toLocaleDateString("en-IN") : "—"}</small></td>
                    <td>{(sale.items || []).length} product(s)</td>
                    <td>{currency(sale.grand_total)}</td>
                    <td><span className={`business-status ${sale.is_confirmed ? "success" : "pending"}`}>{sale.is_confirmed ? "Confirmed" : "Draft"}</span></td>
                    <td className="business-actions">
                      {!sale.is_confirmed && <button className="business-button primary compact" type="button" onClick={() => confirmSale(sale)}>Confirm</button>}
                      {sale.is_confirmed && <button className="business-button secondary compact" type="button" disabled={downloadingId === sale.id} onClick={() => downloadInvoice(sale)}>{downloadingId === sale.id ? "Downloading…" : "Download PDF"}</button>}
                    </td>
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

export default Sales;

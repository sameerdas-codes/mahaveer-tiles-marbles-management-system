import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api/api";

function Suppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const [showModal, setShowModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);

  const emptyForm = {
    name: "",
    contactPerson: "",
    phone: "",
    email: "",
    gstin: "",
    address: "",
    city: "",
    state: "Odisha",
    pincode: "",
    totalPurchases: "",
    outstanding: "",
    status: "Active",
  };

  const [form, setForm] = useState(emptyForm);

  const fetchSuppliers = async () => {
    try {
      const response = await apiFetch("/api/suppliers/");
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Failed to load suppliers.");
      }
      const list = Array.isArray(data) ? data : data.results || [];
      setSuppliers(list.map((supplier) => ({
        id: supplier.id,
        code: `SUP${String(supplier.id).padStart(3, "0")}`,
        name: supplier.name || "",
        contactPerson: supplier.contact_person || "",
        phone: supplier.phone || "",
        email: supplier.email || "",
        gstin: supplier.gstin || "",
        address: supplier.address || "",
        city: supplier.city || "",
        state: supplier.state || "",
        pincode: supplier.pincode || "",
        totalPurchases: Number(supplier.total_purchases || 0),
        outstanding: Number(supplier.outstanding || 0),
        status: supplier.status || "Active",
      })));
    } catch (fetchError) {
      setError(fetchError.message || "Failed to load suppliers.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSuppliers();
  }, []);

  // -----------------------------
  // FILTER
  // -----------------------------

  const filteredSuppliers = useMemo(() => {
    const searchText = search.toLowerCase().trim();

    return suppliers.filter((supplier) => {
      const matchesSearch =
        !searchText ||
        supplier.name.toLowerCase().includes(searchText) ||
        supplier.code.toLowerCase().includes(searchText) ||
        supplier.contactPerson.toLowerCase().includes(searchText) ||
        supplier.phone.includes(searchText) ||
        supplier.gstin.toLowerCase().includes(searchText) ||
        supplier.city.toLowerCase().includes(searchText);

      const matchesStatus =
        statusFilter === "All" ||
        supplier.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [suppliers, search, statusFilter]);

  // -----------------------------
  // SUMMARY
  // -----------------------------

  const totalSuppliers = suppliers.length;

  const activeSuppliers = suppliers.filter(
    (supplier) => supplier.status === "Active"
  ).length;

  const inactiveSuppliers = suppliers.filter(
    (supplier) => supplier.status === "Inactive"
  ).length;

  const totalOutstanding = suppliers.reduce(
    (sum, supplier) =>
      sum + Number(supplier.outstanding || 0),
    0
  );

  // -----------------------------
  // HELPERS
  // -----------------------------

  const formatCurrency = (value) =>
    `₹${Number(value || 0).toLocaleString("en-IN")}`;

  const getInitials = (name) =>
    name
      .split(" ")
      .slice(0, 2)
      .map((word) => word.charAt(0))
      .join("")
      .toUpperCase();

  // -----------------------------
  // MODAL
  // -----------------------------

  const openAddModal = () => {
    setEditingSupplier(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEditModal = (supplier) => {
    setEditingSupplier(supplier);

    setForm({
      name: supplier.name,
      contactPerson: supplier.contactPerson,
      phone: supplier.phone,
      email: supplier.email,
      gstin: supplier.gstin,
      address: supplier.address || "",
      city: supplier.city,
      state: supplier.state,
      pincode: supplier.pincode || "",
      totalPurchases: supplier.totalPurchases,
      outstanding: supplier.outstanding,
      status: supplier.status,
    });

    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingSupplier(null);
    setForm(emptyForm);
  };

  const handleChange = (event) => {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  // -----------------------------
  // SAVE / UPDATE
  // -----------------------------

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.name.trim()) {
      alert("Supplier name is required.");
      return;
    }

    if (!form.phone.trim()) {
      alert("Phone number is required.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      const payload = {
        name: form.name.trim(),
        contact_person: form.contactPerson.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        gstin: form.gstin.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        pincode: form.pincode.trim(),
        outstanding: Number(form.outstanding || 0),
        status: form.status,
      };
      const response = await apiFetch(
        `/api/suppliers/${editingSupplier ? `${editingSupplier.id}/` : ""}`,
        {
          method: editingSupplier ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = response.status === 204 ? {} : await response.json();
      if (!response.ok) {
        throw new Error(
          data.detail || data.phone?.[0] || "Failed to save supplier.",
        );
      }
      closeModal();
      await fetchSuppliers();
    } catch (saveError) {
      setError(saveError.message || "Failed to save supplier.");
    } finally {
      setSaving(false);
    }
  };

  // -----------------------------
  // DELETE
  // -----------------------------

  const handleDelete = async (id) => {
    const supplier = suppliers.find(
      (item) => item.id === id
    );

    if (!supplier) return;

    const confirmed = window.confirm(
      `Delete supplier "${supplier.name}"?`
    );

    if (!confirmed) return;

    try {
      setError("");
      const response = await apiFetch(`/api/suppliers/${id}/`, {
        method: "DELETE",
      });
      const data = response.status === 204 ? {} : await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Failed to delete supplier.");
      }
      await fetchSuppliers();
    } catch (deleteError) {
      setError(deleteError.message || "Failed to delete supplier.");
    }
  };

  // -----------------------------
  // RESET
  // -----------------------------

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("All");
  };

  return (
    <div className="suppliers-page">

      {/* =========================
          HEADER
      ========================== */}

      <div className="suppliers-page-header">

        <div className="suppliers-heading">
          <span className="suppliers-overline">
            PURCHASE MANAGEMENT
          </span>

          <h1>Suppliers</h1>

          <p>
            Manage supplier details and purchase
            relationships.
          </p>
        </div>

        <button
          type="button"
          className="suppliers-add-button"
          onClick={openAddModal}
        >
          <span>+</span>
          Add Supplier
        </button>

      </div>

      {error && <div className="suppliers-main-panel" role="alert">{error}</div>}

      {/* =========================
          SUMMARY CARDS
      ========================== */}

      <div className="suppliers-summary">

        <div className="suppliers-summary-card">
          <div className="suppliers-summary-icon total">
            ▣
          </div>

          <div>
            <span>Total Suppliers</span>
            <strong>{totalSuppliers}</strong>
            <small>Registered suppliers</small>
          </div>
        </div>

        <div className="suppliers-summary-card">
          <div className="suppliers-summary-icon active">
            ✓
          </div>

          <div>
            <span>Active Suppliers</span>
            <strong>{activeSuppliers}</strong>
            <small>Currently active</small>
          </div>
        </div>

        <div className="suppliers-summary-card">
          <div className="suppliers-summary-icon inactive">
            −
          </div>

          <div>
            <span>Inactive Suppliers</span>
            <strong>{inactiveSuppliers}</strong>
            <small>Not currently used</small>
          </div>
        </div>

        <div className="suppliers-summary-card">
          <div className="suppliers-summary-icon due">
            ₹
          </div>

          <div>
            <span>Outstanding</span>
            <strong>
              {formatCurrency(totalOutstanding)}
            </strong>
            <small>Payable to suppliers</small>
          </div>
        </div>

      </div>

      {/* =========================
          TOOLBAR
      ========================== */}

      <section className="suppliers-main-panel">

        <div className="suppliers-toolbar">

          <div className="suppliers-section-title">
            <span>SUPPLIER DIRECTORY</span>
            <h2>All Suppliers</h2>
          </div>

          <div className="suppliers-toolbar-actions">

            <div className="suppliers-search-box">
              <span>⌕</span>

              <input
                type="text"
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder="Search suppliers..."
              />
            </div>

            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value)
              }
              className="suppliers-status-filter"
            >
              <option value="All">
                All Status
              </option>

              <option value="Active">
                Active
              </option>

              <option value="Inactive">
                Inactive
              </option>
            </select>

            <button
              type="button"
              className="suppliers-reset-button"
              onClick={resetFilters}
            >
              Reset
            </button>

          </div>

        </div>

        {/* =========================
            SUPPLIER CARDS
        ========================== */}

        <div className="suppliers-card-grid">

          {loading ? (
            <div className="supplier-empty-state">Loading suppliers...</div>
          ) : filteredSuppliers.length > 0 ? (
            filteredSuppliers.map((supplier) => (

              <div
                className="supplier-card"
                key={supplier.id}
              >

                {/* CARD HEADER */}

                <div className="supplier-card-header">

                  <div className="supplier-card-title">

                    <div className="supplier-avatar">
                      {getInitials(supplier.name)}
                    </div>

                    <div>
                      <h3>{supplier.name}</h3>

                      <span className="supplier-code">
                        {supplier.code}
                      </span>
                    </div>

                  </div>

                  <span
                    className={`supplier-status ${
                      supplier.status === "Active"
                        ? "active"
                        : "inactive"
                    }`}
                  >
                    <i></i>
                    {supplier.status}
                  </span>

                </div>

                {/* CONTACT */}

                <div className="supplier-card-info">

                  <div className="supplier-info-item">
                    <span>PHONE</span>
                    <strong>
                      {supplier.phone || "—"}
                    </strong>
                  </div>

                  <div className="supplier-info-item">
                    <span>GSTIN</span>
                    <strong>
                      {supplier.gstin || "—"}
                    </strong>
                  </div>

                  <div className="supplier-info-item">
                    <span>LOCATION</span>
                    <strong>
                      {supplier.city || "—"},{" "}
                      {supplier.state || ""}
                    </strong>
                  </div>

                </div>

                {/* FINANCIAL */}

                <div className="supplier-card-financial">

                  <div className="supplier-financial-box">
                    <span>Total Purchases</span>

                    <strong>
                      {formatCurrency(
                        supplier.totalPurchases
                      )}
                    </strong>
                  </div>

                  <div
                    className={`supplier-financial-box ${
                      supplier.outstanding > 0
                        ? "due"
                        : "clear"
                    }`}
                  >
                    <span>Outstanding</span>

                    <strong>
                      {formatCurrency(
                        supplier.outstanding
                      )}
                    </strong>
                  </div>

                </div>

                {/* FOOTER */}

                <div className="supplier-card-footer">

                  <span>
                    {supplier.email || "No email added"}
                  </span>

                  <div className="supplier-actions">

                    <button
                      type="button"
                      className="supplier-action edit"
                      onClick={() =>
                        openEditModal(supplier)
                      }
                      title="Edit Supplier"
                    >
                      ✎
                    </button>

                    <button
                      type="button"
                      className="supplier-action delete"
                      onClick={() =>
                        handleDelete(supplier.id)
                      }
                      title="Delete Supplier"
                    >
                      ×
                    </button>

                  </div>

                </div>

              </div>

            ))
          ) : (

            <div className="suppliers-empty">
              <div className="suppliers-empty-icon">
                ♜
              </div>

              <strong>
                No suppliers found
              </strong>

              <span>
                Try changing your search or filter.
              </span>
            </div>

          )}

        </div>

        {/* =========================
            FOOTER
        ========================== */}

        <div className="suppliers-table-footer">

          <span>
            Showing{" "}
            <strong>
              {filteredSuppliers.length}
            </strong>{" "}
            of{" "}
            <strong>
              {suppliers.length}
            </strong>{" "}
            suppliers
          </span>

          <span className="suppliers-footer-status">
            SUPPLIER MASTER
          </span>

        </div>

      </section>

      {/* =========================
          ADD / EDIT MODAL
      ========================== */}

      {showModal && (

        <div className="supplier-modal-overlay">

          <div className="supplier-modal">

            <div className="supplier-modal-header">

              <div>

                <span className="supplier-modal-overline">
                  {editingSupplier
                    ? "UPDATE SUPPLIER"
                    : "NEW SUPPLIER"}
                </span>

                <h2>
                  {editingSupplier
                    ? "Edit Supplier"
                    : "Add Supplier"}
                </h2>

                <p>
                  Maintain supplier contact and
                  business details.
                </p>

              </div>

              <button
                type="button"
                className="supplier-modal-close"
                onClick={closeModal}
              >
                ×
              </button>

            </div>

            <form onSubmit={handleSubmit}>

              <div className="supplier-form-grid">

                <div className="supplier-form-group full">
                  <label>
                    Supplier Name *
                  </label>

                  <input
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    placeholder="Enter supplier/company name"
                    required
                  />
                </div>

                <div className="supplier-form-group">
                  <label>
                    Contact Person
                  </label>

                  <input
                    type="text"
                    name="contactPerson"
                    value={form.contactPerson}
                    onChange={handleChange}
                    placeholder="Contact person name"
                  />
                </div>

                <div className="supplier-form-group">
                  <label>
                    Phone *
                  </label>

                  <input
                    type="tel"
                    name="phone"
                    value={form.phone}
                    onChange={handleChange}
                    placeholder="10 digit mobile number"
                    required
                  />
                </div>

                <div className="supplier-form-group">
                  <label>
                    Email
                  </label>

                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    placeholder="supplier@email.com"
                  />
                </div>

                <div className="supplier-form-group">
                  <label>
                    GSTIN
                  </label>

                  <input
                    type="text"
                    name="gstin"
                    value={form.gstin}
                    onChange={handleChange}
                    placeholder="GST identification number"
                  />
                </div>

                <div className="supplier-form-group full">
                  <label>
                    Address
                  </label>

                  <textarea
                    name="address"
                    value={form.address}
                    onChange={handleChange}
                    placeholder="Supplier address"
                    rows="2"
                  />
                </div>

                <div className="supplier-form-group">
                  <label>City</label>

                  <input
                    type="text"
                    name="city"
                    value={form.city}
                    onChange={handleChange}
                    placeholder="City"
                  />
                </div>

                <div className="supplier-form-group">
                  <label>State</label>

                  <input
                    type="text"
                    name="state"
                    value={form.state}
                    onChange={handleChange}
                    placeholder="State"
                  />
                </div>

                <div className="supplier-form-group">
                  <label>Pincode</label>

                  <input
                    type="text"
                    name="pincode"
                    value={form.pincode}
                    onChange={handleChange}
                    placeholder="Pincode"
                  />
                </div>

                <div className="supplier-form-group">
                  <label>Status</label>

                  <select
                    name="status"
                    value={form.status}
                    onChange={handleChange}
                  >
                    <option value="Active">
                      Active
                    </option>

                    <option value="Inactive">
                      Inactive
                    </option>
                  </select>
                </div>

                <div className="supplier-form-group">
                  <label>
                    Total Purchases
                  </label>

                  <input
                    type="number"
                    name="totalPurchases"
                    value={form.totalPurchases}
                    readOnly
                    disabled
                  />
                </div>

                <div className="supplier-form-group">
                  <label>
                    Outstanding
                  </label>

                  <input
                    type="number"
                    name="outstanding"
                    value={form.outstanding}
                    onChange={handleChange}
                    placeholder="0"
                    min="0"
                  />
                </div>

              </div>

              <div className="supplier-modal-footer">

                <button
                  type="button"
                  className="supplier-cancel-button"
                  onClick={closeModal}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="supplier-save-button"
                  disabled={saving}
                >
                  {saving
                    ? "Saving..."
                    : editingSupplier
                    ? "Update Supplier"
                    : "Save Supplier"}
                </button>

              </div>

            </form>

          </div>

        </div>

      )}

    </div>
  );
}

export default Suppliers;
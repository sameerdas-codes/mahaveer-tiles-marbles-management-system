import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api/api";

const categoryRules = {
  Tiles: {
    measurement: "Size",
    unit: "Box",
  },
  Granite: {
    measurement: "Size",
    unit: "Box",
  },
  Marble: {
    measurement: "Size",
    unit: "Box",
  },
  Adhesive: {
    measurement: "Weight",
    unit: "Kg",
  },
  Grout: {
    measurement: "Weight",
    unit: "Kg",
  },
};

const emptyForm = {
  name: "",
  description: "",
  status: "Active",
};

function getCategoryRule(categoryName) {
  return (
    categoryRules[categoryName] || {
      measurement: "Size",
      unit: "Box",
    }
  );
}

function formatCurrency(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

function formatQuantity(value) {
  return Number(value || 0).toLocaleString("en-IN");
}

function getCategoryIcon(name) {
  switch (name) {
    case "Tiles":
      return "▦";
    case "Granite":
      return "◈";
    case "Marble":
      return "◇";
    case "Adhesive":
      return "▰";
    case "Grout":
      return "▤";
    default:
      return "◫";
  }
}

function Categories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);

  const [form, setForm] = useState(emptyForm);

  const fetchCategories = async () => {
    try {
      const response = await apiFetch("/api/categories/");
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Failed to load categories.");
      }
      const list = Array.isArray(data) ? data : data.results || [];
      setCategories(list.map((category) => ({
        id: category.id,
        name: category.name,
        description: category.description || "",
        status: category.status,
        purchaseQty: Number(category.purchase_qty || 0),
        salesQty: Number(category.sales_qty || 0),
        purchasePrice: Number(category.purchase_price || 0),
        salesPrice: Number(category.sales_price || 0),
      })));
    } catch (fetchError) {
      setError(fetchError.message || "Failed to load categories.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const filteredCategories = useMemo(() => {
    return categories.filter((category) => {
      const matchesSearch = category.name
        .toLowerCase()
        .includes(search.toLowerCase().trim());

      const matchesStatus =
        statusFilter === "All" ||
        category.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [categories, search, statusFilter]);

  const activeCount = categories.filter(
    (category) => category.status === "Active"
  ).length;

  const inactiveCount = categories.filter(
    (category) => category.status === "Inactive"
  ).length;

  const totalCategories = categories.length;

  const openAddModal = () => {
    setEditingCategory(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEditModal = (category) => {
    setEditingCategory(category);

    setForm({
      name: category.name,
      description: category.description,
      status: category.status,
    });

    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingCategory(null);
    setForm(emptyForm);
  };

  const handleFormChange = (event) => {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const handleSave = async (event) => {
    event.preventDefault();

    const name = form.name.trim();
    const description = form.description.trim();

    if (!name) {
      alert("Please enter category name.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      const response = await apiFetch(
        `/api/categories/${editingCategory ? `${editingCategory.id}/` : ""}`,
        {
          method: editingCategory ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description, status: form.status }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data.detail || data.name?.[0] || "Failed to save category.",
        );
      }
      closeModal();
      await fetchCategories();
    } catch (saveError) {
      setError(saveError.message || "Failed to save category.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    const category = categories.find(
      (item) => item.id === id
    );

    if (!category) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete "${category.name}" category?`
    );

    if (!confirmed) return;

    try {
      setError("");
      const response = await apiFetch(`/api/categories/${id}/`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Failed to delete category.");
      }
      await fetchCategories();
    } catch (deleteError) {
      setError(deleteError.message || "Failed to delete category.");
    }
  };

  return (
    <section className="categories-page">

      {/* PAGE HEADER */}
      <div className="categories-header">
        <div>
          <span className="categories-eyebrow">
            INVENTORY MANAGEMENT
          </span>

          <h2 className="categories-title">
            Categories
          </h2>

          <p className="categories-subtitle">
            Category-wise purchase and sales overview
          </p>
        </div>

        <button
          type="button"
          className="category-add-btn"
          onClick={openAddModal}
        >
          <span>＋</span>
          Add Category
        </button>
      </div>

      {error && <div className="categories-empty" role="alert">{error}</div>}

      {/* SUMMARY */}
      <div className="category-summary-grid">

        <div className="category-summary-card">
          <div className="summary-card-icon">
            ◫
          </div>

          <div>
            <span>Total Categories</span>
            <strong>{totalCategories}</strong>
          </div>
        </div>

        <div className="category-summary-card">
          <div className="summary-card-icon active-icon">
            ✓
          </div>

          <div>
            <span>Active Categories</span>
            <strong>{activeCount}</strong>
          </div>
        </div>

        <div className="category-summary-card">
          <div className="summary-card-icon inactive-icon">
            −
          </div>

          <div>
            <span>Inactive Categories</span>
            <strong>{inactiveCount}</strong>
          </div>
        </div>

      </div>

      {/* FILTER BAR */}
      <div className="categories-toolbar">

        <div className="category-search">
          <span className="search-icon">
            ⌕
          </span>

          <input
            type="text"
            placeholder="Search category..."
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
          />
        </div>

        <select
          className="category-status-filter"
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value)
          }
        >
          <option value="All">
            All Categories
          </option>

          <option value="Active">
            Active
          </option>

          <option value="Inactive">
            Inactive
          </option>
        </select>

      </div>

      {/* CATEGORY CARDS */}
      <div className="category-cards-grid">

        {loading && <div className="categories-empty">Loading categories…</div>}

        {filteredCategories.map((category) => {
          const rule = getCategoryRule(category.name);

          return (
            <article
              className="category-performance-card"
              key={category.id}
            >

              {/* CARD HEADER */}
              <div className="category-card-header">

                <div className="category-card-title-area">

                  <div className="category-icon">
                    {getCategoryIcon(category.name)}
                  </div>

                  <div>
                    <h3>
                      {category.name}
                    </h3>

                    <p>
                      {category.description ||
                        "No description"}
                    </p>
                  </div>

                </div>

                <span
                  className={`category-status ${
                    category.status === "Active"
                      ? "status-active"
                      : "status-inactive"
                  }`}
                >
                  <span className="status-dot"></span>
                  {category.status}
                </span>

              </div>

              {/* MEASUREMENT INFO */}
              <div className="category-measurement">

                <span>
                  Measurement
                </span>

                <strong>
                  {rule.measurement}
                </strong>

                <b>
                  {rule.unit}
                </b>

              </div>

              {/* QUANTITY */}
              <div className="category-stats">

                <div className="category-stat-box">
                  <span className="stat-label">
                    Purchase Qty
                  </span>

                  <strong>
                    {formatQuantity(
                      category.purchaseQty
                    )}
                  </strong>

                  <small>
                    {rule.unit}
                  </small>
                </div>

                <div className="category-stat-box">
                  <span className="stat-label">
                    Sales Qty
                  </span>

                  <strong>
                    {formatQuantity(
                      category.salesQty
                    )}
                  </strong>

                  <small>
                    {rule.unit}
                  </small>
                </div>

              </div>

              {/* PRICE */}
              <div className="category-price-section">

                <div className="category-price-row">

                  <div>
                    <span>
                      Purchase Price
                    </span>

                    <strong>
                      {formatCurrency(
                        category.purchasePrice
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      Sales Price
                    </span>

                    <strong>
                      {formatCurrency(
                        category.salesPrice
                      )}
                    </strong>
                  </div>

                </div>

              </div>

              {/* CARD FOOTER */}
              <div className="category-card-footer">

                <span>
                  Category ID: CAT-
                  {String(category.id).padStart(3, "0")}
                </span>

                <div className="category-actions">

                  <button
                    type="button"
                    className="category-edit-btn"
                    onClick={() =>
                      openEditModal(category)
                    }
                    title="Edit category"
                  >
                    ✎
                  </button>

                  <button
                    type="button"
                    className="category-delete-btn"
                    onClick={() =>
                      handleDelete(category.id)
                    }
                    title="Delete category"
                  >
                    ×
                  </button>

                </div>

              </div>

            </article>
          );
        })}

      </div>

      {/* EMPTY STATE */}
      {filteredCategories.length === 0 && (
        <div className="categories-empty">
          <div className="empty-icon">
            ⌕
          </div>

          <h3>
            No categories found
          </h3>

          <p>
            Try changing your search or status filter.
          </p>
        </div>
      )}

      {/* MODAL */}
      {showModal && (
        <div className="category-modal-overlay">

          <div
            className="category-modal"
            onClick={(event) =>
              event.stopPropagation()
            }
          >

            <div className="category-modal-header">

              <div>
                <span>
                  CATEGORY MANAGEMENT
                </span>

                <h3>
                  {editingCategory
                    ? "Edit Category"
                    : "Add Category"}
                </h3>
              </div>

              <button
                type="button"
                className="category-modal-close"
                onClick={closeModal}
              >
                ×
              </button>

            </div>

            <form
              className="category-form"
              onSubmit={handleSave}
            >

              <div className="category-form-field">

                <label>
                  Category Name
                </label>

                <select
                  name="name"
                  value={form.name}
                  onChange={handleFormChange}
                  disabled={Boolean(editingCategory)}
                >
                  <option value="">
                    Select Category
                  </option>

                  {Object.keys(categoryRules).map(
                    (categoryName) => (
                      <option
                        value={categoryName}
                        key={categoryName}
                      >
                        {categoryName}
                      </option>
                    )
                  )}
                </select>

              </div>

              <div className="category-form-field">

                <label>
                  Description
                </label>

                <textarea
                  name="description"
                  value={form.description}
                  onChange={handleFormChange}
                  placeholder="Enter category description..."
                  rows="3"
                />

              </div>

              <div className="category-form-row">

                <div className="category-form-field">

                  <label>
                    Measurement
                  </label>

                  <div className="category-readonly-field">
                    {form.name
                      ? getCategoryRule(form.name)
                          .measurement
                      : "Auto"}
                  </div>

                </div>

                <div className="category-form-field">

                  <label>
                    Unit
                  </label>

                  <div className="category-readonly-field">
                    {form.name
                      ? getCategoryRule(form.name)
                          .unit
                      : "Auto"}
                  </div>

                </div>

              </div>

              <div className="category-form-field">

                <label>
                  Status
                </label>

                <select
                  name="status"
                  value={form.status}
                  onChange={handleFormChange}
                >
                  <option value="Active">
                    Active
                  </option>

                  <option value="Inactive">
                    Inactive
                  </option>
                </select>

              </div>

              <div className="category-modal-actions">

                <button
                  type="button"
                  className="category-cancel-btn"
                  onClick={closeModal}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="category-save-btn"
                  disabled={saving}
                >
                  {saving
                    ? "Saving..."
                    : editingCategory
                    ? "Update Category"
                    : "Save Category"}
                </button>

              </div>

            </form>

          </div>

        </div>
      )}

    </section>
  );
}

export default Categories;
import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api/api";

/* =========================================================
   API
========================================================= */

const API_URL = "/api/products/";

/* =========================================================
   EMPTY FORM
========================================================= */

const emptyForm = {
  name: "",
  code: "",
  category: "Tiles",
  size: "",
  weight: "",
  purchasePrice: "",
  salePrice: "",
  stock: "",
};

/* =========================================================
   CATEGORY LIST
========================================================= */

/* =========================================================
   CATEGORY HELPERS
========================================================= */

const weightCategories = ["Adhesive", "Grout"];

const sizeCategories = ["Tiles", "Marble", "Granite"];

const isWeightCategory = (category) =>
  weightCategories.includes(category);

const isSizeCategory = (category) =>
  sizeCategories.includes(category);

const isSanitaryCategory = (category) =>
  category === "Sanitary";

/* =========================================================
   AUTOMATIC UNIT
========================================================= */

const getProductUnit = (category) => {
  if (category === "Adhesive") return "Kg";
  if (category === "Grout") return "Kg";
  if (category === "Sanitary") return "Piece";
  return "Box";
};

/* =========================================================
   STATUS
========================================================= */

const getStatus = (stock, lowStockLimit = 10) => {
  const quantity = Number(stock || 0);
  const limit = Number(lowStockLimit || 10);

  if (quantity <= 0) return "Out of Stock";

  if (quantity <= limit) return "Low Stock";

  return "In Stock";
};

/* =========================================================
   CURRENCY
========================================================= */

const formatCurrency = (value) => {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
};

/* =========================================================
   SIZE / WEIGHT DISPLAY
========================================================= */

const getSizeOrWeight = (product) => {
  if (isWeightCategory(product.category)) {
    return formatWeight(product.weight || product.size);
  }

  return product.size || product.weight || "—";
};

const formatWeight = (value) => {
  const weight = String(value ?? "").trim();
  if (!weight) return "—";
  return /^\d+(?:[.,]\d+)?$/.test(weight) ? `${weight} Kg` : weight;
};

/* =========================================================
   BACKEND -> FRONTEND
========================================================= */

const mapProductFromAPI = (product) => {
  const stock = Number(product.stock || 0);

  return {
    id: product.id,

    name: product.name || "",

    code: product.product_code || "",

    category: product.category || "Tiles",

    size: product.size || "",

    weight: product.weight || "",

    unit: getProductUnit(product.category || "Tiles"),

    purchasePrice: Number(product.purchase_price || 0),

    salePrice: Number(product.selling_price || 0),

    stock,

    lowStockLimit: Number(
      product.low_stock_limit ?? 10
    ),

    status: getStatus(
      stock,
      product.low_stock_limit
    ),
  };
};

/* =========================================================
   FRONTEND -> BACKEND
========================================================= */

const mapProductToAPI = (form) => {
  return {
    name: form.name.trim(),

    /*
      Product code optional.
      Empty string -> null
    */

    product_code:
      form.code.trim() || null,

    category: form.category,

    size: String(form.size || "").trim(),

    weight: String(form.weight || "").trim(),

    purchase_price:
      Number(form.purchasePrice || 0),

    selling_price:
      Number(form.salePrice || 0),

    stock:
      Number(form.stock || 0),

    /*
      Current Product model has this field.
    */

    low_stock_limit: 10,
  };
};

/* =========================================================
   PRODUCTS
========================================================= */

function Products() {
  const [products, setProducts] = useState([]);
  const [categoryOptions, setCategoryOptions] = useState([]);

  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");

  const [search, setSearch] = useState("");

  const [category, setCategory] = useState("All");

  const [stockFilter, setStockFilter] =
    useState("All");

  const [showModal, setShowModal] =
    useState(false);

  const [editingProduct, setEditingProduct] =
    useState(null);

  const [form, setForm] = useState({
    ...emptyForm,
  });

  /* =======================================================
     FETCH PRODUCTS
  ======================================================= */

  const fetchProducts = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await apiFetch(API_URL);

      if (!response.ok) {
        throw new Error(
          `Failed to load products (${response.status})`
        );
      }

      const data = await response.json();

      /*
        Supports both:
        [...]
        and DRF pagination:
        { results: [...] }
      */

      const list = Array.isArray(data)
        ? data
        : data.results || [];

      setProducts(
        list.map(mapProductFromAPI)
      );
    } catch (err) {
      console.error(err);

      setError(
        err.message ||
          "Unable to load products."
      );
    } finally {
      setLoading(false);
    }
  };

  /* =======================================================
     INITIAL LOAD
  ======================================================= */

  useEffect(() => {
    fetchProducts();

    const fetchCategories = async () => {
      try {
        const response = await apiFetch("/api/categories/");
        if (!response.ok) {
          throw new Error(`Failed to load categories (${response.status})`);
        }
        const data = await response.json();
        const list = Array.isArray(data) ? data : data.results || [];
        setCategoryOptions(list.map((item) => item.name));
      } catch (fetchError) {
        setError(fetchError.message || "Unable to load categories.");
      }
    };

    fetchCategories();
  }, []);

  const categories = useMemo(
    () => [
      "All",
      ...new Set([
        ...categoryOptions,
        ...products.map((product) => product.category).filter(Boolean),
      ]),
    ],
    [categoryOptions, products],
  );

  /* =======================================================
     FILTERED PRODUCTS
  ======================================================= */

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const searchText =
        search.toLowerCase().trim();

      const matchesSearch =
        product.name
          .toLowerCase()
          .includes(searchText) ||
        (product.code || "")
          .toLowerCase()
          .includes(searchText) ||
        product.category
          .toLowerCase()
          .includes(searchText);

      const matchesCategory =
        category === "All" ||
        product.category === category;

      const matchesStock =
        stockFilter === "All" ||
        product.status === stockFilter;

      return (
        matchesSearch &&
        matchesCategory &&
        matchesStock
      );
    });
  }, [
    products,
    search,
    category,
    stockFilter,
  ]);

  /* =======================================================
     SUMMARY
  ======================================================= */

  const totalProducts = products.length;

  const inStock = products.filter(
    (product) =>
      product.status === "In Stock"
  ).length;

  const lowStock = products.filter(
    (product) =>
      product.status === "Low Stock"
  ).length;

  const outOfStock = products.filter(
    (product) =>
      product.status === "Out of Stock"
  ).length;

  /* =======================================================
     OPEN ADD MODAL
  ======================================================= */

  const openAddModal = () => {
    setEditingProduct(null);

    setForm({
      ...emptyForm,
    });

    setError("");

    setShowModal(true);
  };

  /* =======================================================
     OPEN EDIT MODAL
  ======================================================= */

  const openEditModal = (product) => {
    setEditingProduct(product);

    setForm({
      name: product.name || "",

      code: product.code || "",

      category:
        product.category || "Tiles",

      size: product.size || "",

      weight:
        product.weight ?? "",

      purchasePrice:
        product.purchasePrice ?? "",

      salePrice:
        product.salePrice ?? "",

      stock:
        product.stock ?? "",
    });

    setError("");

    setShowModal(true);
  };

  /* =======================================================
     CLOSE MODAL
  ======================================================= */

  const closeModal = () => {
    if (saving) return;

    setShowModal(false);

    setEditingProduct(null);

    setForm({
      ...emptyForm,
    });

    setError("");
  };

  /* =======================================================
     INPUT
  ======================================================= */

  const handleInput = (e) => {
    const { name, value } = e.target;

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  /* =======================================================
     CATEGORY CHANGE
  ======================================================= */

  const handleCategoryChange = (e) => {
    const newCategory = e.target.value;

    const weightCategory =
      isWeightCategory(newCategory);

    const sizeCategory =
      isSizeCategory(newCategory);

    const sanitaryCategory =
      isSanitaryCategory(newCategory);

    setForm((prev) => ({
      ...prev,

      category: newCategory,

      size:
        weightCategory || sanitaryCategory
          ? ""
          : sizeCategory
          ? prev.size
          : "",

      weight:
        sizeCategory || sanitaryCategory
          ? ""
          : weightCategory
          ? prev.weight
          : "",
    }));
  };

  /* =======================================================
     SAVE / UPDATE
  ======================================================= */

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.name.trim()) {
      setError("Product name is required.");
      return;
    }

    try {
      setSaving(true);
      setError("");

      const payload =
        mapProductToAPI(form);

      let response;

      /* ===================================================
         UPDATE
      =================================================== */

      if (editingProduct) {
        response = await apiFetch(
          `${API_URL}${editingProduct.id}/`,
          {
            method: "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify(payload),
          }
        );
      }

      /* ===================================================
         ADD
      =================================================== */

      else {
        response = await apiFetch(API_URL, {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify(payload),
        });
      }

      const data = await response.json();

      if (!response.ok) {
        console.error(
          "Product API error:",
          data
        );

        throw new Error(
          typeof data === "object"
            ? Object.values(data)
                .flat()
                .join(" ")
            : "Unable to save product."
        );
      }

      /*
        Fresh backend data.
      */

      await fetchProducts();

      closeModal();
    } catch (err) {
      console.error(err);

      setError(
        err.message ||
          "Unable to save product."
      );
    } finally {
      setSaving(false);
    }
  };

  /* =======================================================
     DELETE
  ======================================================= */

  const handleDelete = async (id) => {
    const confirmed = window.confirm(
      "Delete this product and any OCR draft item matched to it? Products in purchase or sales history cannot be deleted."
    );

    if (!confirmed) {
      return;
    }

    try {
      setError("");

      const response = await apiFetch(
        `${API_URL}${id}/`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        let message =
          "Unable to delete product.";

        try {
          const data =
            await response.json();

          if (data?.detail) {
            message = data.detail;
          }
        } catch {
          // no JSON response
        }

        throw new Error(message);
      }

      /*
        Remove immediately from UI.
      */

      setProducts((prev) =>
        prev.filter(
          (product) =>
            product.id !== id
        )
      );
    } catch (err) {
      console.error(err);

      setError(
        err.message ||
          "Unable to delete product."
      );
    }
  };

  /* =======================================================
     RESET
  ======================================================= */

  const resetFilters = () => {
    setSearch("");
    setCategory("All");
    setStockFilter("All");
  };

  /* =======================================================
     FORM CATEGORY
  ======================================================= */

  const weightCategory =
    isWeightCategory(form.category);

  const sizeCategory =
    isSizeCategory(form.category);

  const sanitaryCategory =
    isSanitaryCategory(form.category);

  /* =======================================================
     JSX
  ======================================================= */

  return (
    <div className="products-page">

      {/* =================================================
          HEADER
      ================================================= */}

      <div className="products-page-header">

        <div className="products-heading">

          <span className="products-overline">
            INVENTORY MANAGEMENT
          </span>

          <h1>
            Products
          </h1>

          <p>
            Manage your products, pricing and
            stock information.
          </p>

        </div>

        <button
          type="button"
          className="products-add-button"
          onClick={openAddModal}
        >
          <span className="products-add-icon">
            +
          </span>

          Add Product
        </button>

      </div>

      {/* =================================================
          ERROR
      ================================================= */}

      {error && (
        <div
          style={{
            marginBottom: "16px",
            padding: "12px 14px",
            border: "1px solid rgba(255,80,80,.3)",
            borderRadius: "8px",
            color: "#ff8585",
            background:
              "rgba(255,80,80,.06)",
          }}
        >
          {error}
        </div>
      )}

      {/* =================================================
          SUMMARY
      ================================================= */}

      <div className="products-summary">

        <div className="products-summary-card">

          <div className="products-summary-icon total">
            ▦
          </div>

          <div className="products-summary-content">

            <span>Total Products</span>

            <strong>
              {totalProducts}
            </strong>

            <small>
              All products
            </small>

          </div>

        </div>

        <div className="products-summary-card">

          <div className="products-summary-icon stock">
            ✓
          </div>

          <div className="products-summary-content">

            <span>In Stock</span>

            <strong>
              {inStock}
            </strong>

            <small>
              Available products
            </small>

          </div>

        </div>

        <div className="products-summary-card">

          <div className="products-summary-icon low">
            !
          </div>

          <div className="products-summary-content">

            <span>Low Stock</span>

            <strong>
              {lowStock}
            </strong>

            <small>
              Need attention
            </small>

          </div>

        </div>

        <div className="products-summary-card">

          <div className="products-summary-icon out">
            ×
          </div>

          <div className="products-summary-content">

            <span>Out of Stock</span>

            <strong>
              {outOfStock}
            </strong>

            <small>
              Currently unavailable
            </small>

          </div>

        </div>

      </div>

      {/* =================================================
          MAIN PANEL
      ================================================= */}

      <div className="products-main-panel">

        <div className="products-toolbar">

          <div className="products-toolbar-left">

            <div className="products-section-title">

              <span className="products-panel-label">
                INVENTORY
              </span>

              <h2>
                Product List
              </h2>

            </div>

            <div className="products-search-box">

              <span className="products-search-icon">
                ⌕
              </span>

              <input
                type="text"
                placeholder="Search product, code or category..."
                value={search}
                onChange={(e) =>
                  setSearch(e.target.value)
                }
              />

            </div>

          </div>

          <div className="products-filters">

            <select
              value={category}
              onChange={(e) =>
                setCategory(e.target.value)
              }
            >
              {categories.map((item) => (
                <option
                  key={item}
                  value={item}
                >
                  {item === "All"
                    ? "All Categories"
                    : item}
                </option>
              ))}
            </select>

            <select
              value={stockFilter}
              onChange={(e) =>
                setStockFilter(e.target.value)
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

            {(search ||
              category !== "All" ||
              stockFilter !== "All") && (
              <button
                type="button"
                className="products-reset-button"
                onClick={resetFilters}
              >
                Reset
              </button>
            )}

          </div>

        </div>

        {/* =================================================
            TABLE
        ================================================= */}

        <div className="products-table-wrapper">

          <table className="products-table">

            <thead>

              <tr>

                <th>Product</th>

                <th>Product Code</th>

                <th>Category</th>

                <th>Size / Weight</th>

                <th>Unit</th>

                <th>Purchase</th>

                <th>Sale Price</th>

                <th>Stock</th>

                <th>Status</th>

                <th>Action</th>

              </tr>

            </thead>

            <tbody>

              {loading ? (

                <tr>

                  <td
                    colSpan="10"
                    className="products-empty"
                  >

                    <strong>
                      Loading products...
                    </strong>

                  </td>

                </tr>

              ) : filteredProducts.length === 0 ? (

                <tr>

                  <td
                    colSpan="10"
                    className="products-empty"
                  >

                    <div className="products-empty-icon">
                      ▦
                    </div>

                    <strong>
                      No products found
                    </strong>

                    <span>
                      Try changing your search
                      or filters.
                    </span>

                  </td>

                </tr>

              ) : (

                filteredProducts.map(
                  (product) => (

                    <tr key={product.id}>

                      {/* PRODUCT */}

                      <td>

                        <div className="product-name-cell">

                          <div className="product-avatar">

                            {product.name
                              .charAt(0)
                              .toUpperCase()}

                          </div>

                          <div className="product-name-info">

                            <strong>
                              {product.name}
                            </strong>

                          </div>

                        </div>

                      </td>

                      {/* CODE */}

                      <td>

                        <span className="product-code-cell">

                          {product.code
                            ? product.code
                            : "—"}

                        </span>

                      </td>

                      {/* CATEGORY */}

                      <td>

                        <span className="product-category">

                          {product.category}

                        </span>

                      </td>

                      {/* SIZE / WEIGHT */}

                      <td>

                        <span className="product-table-text">

                          {getSizeOrWeight(
                            product
                          )}

                        </span>

                      </td>

                      {/* UNIT */}

                      <td>

                        <span className="product-table-text">

                          {product.unit}

                        </span>

                      </td>

                      {/* PURCHASE */}

                      <td className="price-cell">

                        {formatCurrency(
                          product.purchasePrice
                        )}

                      </td>

                      {/* SALE */}

                      <td className="price-cell sale">

                        {formatCurrency(
                          product.salePrice
                        )}

                      </td>

                      {/* STOCK */}

                      <td>

                        <strong className="stock-number">

                          {Number(
                            product.stock || 0
                          ).toLocaleString(
                            "en-IN"
                          )}

                        </strong>

                      </td>

                      {/* STATUS */}

                      <td>

                        <span
                          className={`product-status ${product.status
                            .toLowerCase()
                            .replaceAll(
                              " ",
                              "-"
                            )}`}
                        >

                          <i></i>

                          {product.status}

                        </span>

                      </td>

                      {/* ACTION */}

                      <td>

                        <div className="product-actions">

                          <button
                            type="button"
                            className="product-action edit"
                            title="Edit Product"
                            onClick={() =>
                              openEditModal(
                                product
                              )
                            }
                          >
                            ✎
                          </button>

                          <button
                            type="button"
                            className="product-action delete"
                            title="Delete Product"
                            onClick={() =>
                              handleDelete(
                                product.id
                              )
                            }
                          >
                            ×
                          </button>

                        </div>

                      </td>

                    </tr>

                  )
                )

              )}

            </tbody>

          </table>

        </div>

        {/* =================================================
            FOOTER
        ================================================= */}

        <div className="products-table-footer">

          <span>

            Showing{" "}

            <strong>
              {filteredProducts.length}
            </strong>

            {" "}of{" "}

            <strong>
              {products.length}
            </strong>

            {" "}products

          </span>

          <span className="products-footer-status">

            {loading
              ? "Loading..."
              : "Inventory Updated"}

          </span>

        </div>

      </div>

      {/* =================================================
          ADD / EDIT MODAL
      ================================================= */}

      {showModal && (

        <div className="product-modal-overlay">

          <div className="product-modal">

            <div className="product-modal-header">

              <div>

                <span className="modal-overline">
                  PRODUCT MANAGEMENT
                </span>

                <h2>

                  {editingProduct
                    ? "Edit Product"
                    : "Add Product"}

                </h2>

                <p>

                  {editingProduct
                    ? "Update product information."
                    : "Add a new product to your inventory."}

                </p>

              </div>

              <button
                type="button"
                className="product-modal-close"
                onClick={closeModal}
                aria-label="Close"
              >
                ×
              </button>

            </div>

            <form onSubmit={handleSubmit}>

              <div className="product-form-grid">

                {/* PRODUCT NAME */}

                <div className="product-form-group full">

                  <label>
                    Product Name *
                  </label>

                  <input
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleInput}
                    placeholder="Enter product name"
                    required
                  />

                </div>

                {/* PRODUCT CODE */}

                <div className="product-form-group">

                  <label>
                    Product Code
                  </label>

                  <input
                    type="text"
                    name="code"
                    value={form.code}
                    onChange={handleInput}
                    placeholder="Optional product code"
                  />

                  <small className="product-field-hint">

                    Leave blank if the product has no code.

                  </small>

                </div>

                {/* CATEGORY */}

                <div className="product-form-group">

                  <label>
                    Category *
                  </label>

                  <select
                    name="category"
                    value={form.category}
                    onChange={
                      handleCategoryChange
                    }
                    required
                  >

                    {[...new Set([...categoryOptions, form.category].filter(Boolean))].map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}

                  </select>

                </div>

                {/* WEIGHT */}

                {weightCategory && (

                  <div className="product-form-group full">

                    <label>
                      Weight *
                    </label>

                    <input
                      type="text"
                      name="weight"
                      value={form.weight}
                      onChange={handleInput}
                      placeholder="e.g. 25 Kg"
                      required
                    />

                    <small className="product-field-hint">

                      Keep the weight unit with the value if shown on the bill.

                    </small>

                  </div>

                )}

                {/* SIZE */}

                {sizeCategory && (

                  <div className="product-form-group full">

                    <label>
                      Size *
                    </label>

                    <input
                      type="text"
                      name="size"
                      value={form.size}
                      onChange={handleInput}
                      placeholder="e.g. 4 x 2 ft"
                      required
                    />

                    <small className="product-field-hint">

                      Unit is automatically set to Box.

                    </small>

                  </div>

                )}

                {/* SANITARY */}

                {sanitaryCategory && (

                  <div className="product-form-group full">

                    <div className="product-category-note">

                      <span>
                        Sanitary product
                      </span>

                      <small>
                        Unit is automatically set to Piece.
                      </small>

                    </div>

                  </div>

                )}

                {/* PURCHASE PRICE */}

                <div className="product-form-group">

                  <label>
                    Purchase Price (₹)
                  </label>

                  <div className="input-with-symbol">

                    <span>
                      ₹
                    </span>

                    <input
                      type="number"
                      name="purchasePrice"
                      value={form.purchasePrice}
                      onChange={handleInput}
                      placeholder="0"
                      min="0"
                      step="0.01"
                    />

                  </div>

                  <small className="product-field-hint">

                    Bill purchase rate can update this value.

                  </small>

                </div>

                {/* SALE PRICE */}

                <div className="product-form-group">

                  <label>
                    Sale Price (₹)
                  </label>

                  <div className="input-with-symbol">

                    <span>
                      ₹
                    </span>

                    <input
                      type="number"
                      name="salePrice"
                      value={form.salePrice}
                      onChange={handleInput}
                      placeholder="0"
                      min="0"
                      step="0.01"
                    />

                  </div>

                </div>

                {/* STOCK */}

                <div className="product-form-group">

                  <label>
                    Opening Stock
                  </label>

                  <input
                    type="number"
                    name="stock"
                    value={form.stock}
                    onChange={handleInput}
                    placeholder="0"
                    min="0"
                    step="0.01"
                  />

                </div>

                {/* UNIT */}

                <div className="product-form-group">

                  <label>
                    Unit
                  </label>

                  <div className="product-auto-unit">

                    <span>
                      {getProductUnit(
                        form.category
                      )}
                    </span>

                    <small>
                      Automatically assigned
                    </small>

                  </div>

                </div>

              </div>

              {/* MODAL ERROR */}

              {error && (

                <div
                  style={{
                    marginTop: "14px",
                    padding: "10px 12px",
                    borderRadius: "7px",
                    color: "#ff8585",
                    background:
                      "rgba(255,80,80,.06)",
                    border:
                      "1px solid rgba(255,80,80,.25)",
                  }}
                >
                  {error}
                </div>

              )}

              {/* FOOTER */}

              <div className="product-modal-footer">

                <button
                  type="button"
                  className="product-cancel-button"
                  onClick={closeModal}
                  disabled={saving}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="product-save-button"
                  disabled={saving}
                >

                  {saving
                    ? "Saving..."
                    : editingProduct
                    ? "Update Product"
                    : "Save Product"}

                </button>

              </div>

            </form>

          </div>

        </div>

      )}

    </div>
  );
}

export default Products;
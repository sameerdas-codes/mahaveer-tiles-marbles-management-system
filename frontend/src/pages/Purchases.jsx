import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api/api";

const API_BASE = "/api";

const NEW_SUPPLIER_VALUE = "__new_supplier__";

function Purchases({ onNavigate }) {
  // =========================================================
  // STATE
  // =========================================================

  const [purchases, setPurchases] = useState([]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const [showModal, setShowModal] = useState(false);
  const [showDetails, setShowDetails] = useState(null);
  const [editingPurchase, setEditingPurchase] = useState(null);

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showVerificationModal, setShowVerificationModal] = useState(false);

  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorModalTitle, setErrorModalTitle] = useState("Something went wrong");
  const [errorModalMessage, setErrorModalMessage] = useState("");

  const [selectedFile, setSelectedFile] = useState(null);

  const [draft, setDraft] = useState(null);

  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);

  const [verificationSupplierId, setVerificationSupplierId] = useState("");
  const [verificationItems, setVerificationItems] = useState([]);

  const [ocrTax, setOcrTax] = useState(0);
  const [ocrGrandTotal, setOcrGrandTotal] = useState(0);

  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [converting, setConverting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const fileInputRef = useRef(null);

  // =========================================================
  // MANUAL FORM
  // =========================================================

  const emptyForm = {
    billNo: "",
    supplier: "",
    date: new Date().toISOString().split("T")[0],
    items: "",
    quantity: "",
    total: "",
    status: "Received",
    paymentStatus: "Pending",
  };

  const [form, setForm] = useState(emptyForm);

  // =========================================================
  // HELPERS
  // =========================================================

  const normalizeText = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  const formatCurrency = (value) =>
    `₹${Number(value || 0).toLocaleString("en-IN", {
      maximumFractionDigits: 2,
    })}`;

  const formatDate = (date) => {
    if (!date) {
      return "—";
    }

    const parsedDate = new Date(date);

    if (Number.isNaN(parsedDate.getTime())) {
      return "—";
    }

    return parsedDate.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const clearMessages = () => {
    setError("");
    setSuccessMessage("");
  };

  // =========================================================
  // ERROR POPUP
  // =========================================================

  const openErrorModal = (
    message,
    title = "Something went wrong",
  ) => {
    setErrorModalTitle(title);
    setErrorModalMessage(
      message || "Something went wrong. Please try again.",
    );
    setShowErrorModal(true);
  };

  const closeErrorModal = () => {
    setShowErrorModal(false);
    setErrorModalTitle("Something went wrong");
    setErrorModalMessage("");
  };

  // =========================================================
  // API RESPONSE HELPER
  // =========================================================

  const getJson = async (response) => {
    const contentType = response.headers.get("content-type") || "";

    const text = await response.text();

    if (!text) {
      return {};
    }

    if (contentType.includes("application/json")) {
      try {
        return JSON.parse(text);
      } catch {
        return {
          raw_response: text,
        };
      }
    }

    return {
      raw_response: text,
    };
  };

  // =========================================================
  // API REQUEST
  // =========================================================

  const apiRequest = async (url, options = {}) => {
    const response = await apiFetch(`${API_BASE}${url}`, {
      ...options,

      headers: {
        ...(options.body instanceof FormData
          ? {}
          : {
              "Content-Type": "application/json",
            }),

        ...(options.headers || {}),
      },
    });

    const data = await getJson(response);

    if (!response.ok) {
      console.error("API ERROR:", {
        fullUrl: `${API_BASE}${url}`,
        status: response.status,
        statusText: response.statusText,
        data,
      });

      let message =
        data?.error ||
        data?.detail ||
        data?.message;

      if (!message && data?.raw_response) {
        message = data.raw_response;
      }

      if (!message) {
        const values = Object.values(data || {})
          .flat()
          .filter(Boolean);

        if (values.length) {
          message = values.join(", ");
        }
      }

      throw new Error(
        message ||
          `Request failed (${response.status} ${response.statusText})`,
      );
    }

    return data;
  };

  // =========================================================
  // NORMALIZE PURCHASE ITEM
  // =========================================================

  const normalizePurchaseItem = (item) => {
    const product = item.product;

    let productName = "Unknown Product";

    if (product && typeof product === "object") {
      productName = product.name || "Unknown Product";
    } else if (item.product_name) {
      productName = item.product_name;
    }

    return {
      id: item.id,

      productId:
        product && typeof product === "object"
          ? product.id
          : item.product || null,

      productName,

      productCode:
        product && typeof product === "object"
          ? product.product_code || ""
          : item.product_code || "",

      size: item.size || product?.size || "",

      weight: item.weight || product?.weight || "",

      quantity: Number(item.quantity || 0),

      purchasePrice: Number(item.purchase_price || 0),

      total: Number(
        item.total ||
          Number(item.quantity || 0) *
            Number(item.purchase_price || 0),
      ),

      raw: item,
    };
  };

  // =========================================================
  // NORMALIZE PURCHASE
  // =========================================================

  const normalizePurchase = (purchase) => {
    const rawItems = Array.isArray(purchase?.items)
      ? purchase.items
      : [];

    const items = rawItems.map(normalizePurchaseItem);

    const quantity = items.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0,
    );

    let supplierName = "Unknown Supplier";
    let supplierId = null;

    if (
      purchase?.supplier &&
      typeof purchase.supplier === "object"
    ) {
      supplierName =
        purchase.supplier.name || "Unknown Supplier";

      supplierId = purchase.supplier.id || null;
    } else if (typeof purchase?.supplier === "string") {
      supplierName = purchase.supplier;
    } else if (
      typeof purchase?.supplier_name === "string"
    ) {
      supplierName = purchase.supplier_name;
    } else if (purchase?.supplier) {
      supplierId = purchase.supplier;
    }

    return {
      id: purchase?.id,

      billNo:
        purchase?.bill_number ||
        purchase?.billNo ||
        `PUR-${String(purchase?.id || 0).padStart(4, "0")}`,

      supplier: supplierName,

      supplierId,

      date:
        purchase?.bill_date ||
        purchase?.date ||
        purchase?.created_at ||
        "",

      items: items.length,

      quantity,

      total: Number(
        purchase?.grand_total ||
          purchase?.total ||
          0,
      ),

      tax: Number(purchase?.tax || 0),

      subtotal: items.reduce(
        (sum, item) => sum + Number(item.total || 0),
        0,
      ),

      status: purchase?.is_confirmed
        ? "Received"
        : "Pending",

      paymentStatus:
        purchase?.payment_status || "Pending",

      purchaseItems: items,

      raw: purchase,
    };
  };

  // =========================================================
  // LOAD PURCHASES
  // =========================================================

  const loadPurchases = async () => {
    try {
      setLoading(true);

      const data = await apiRequest("/purchases/");

      const purchaseList = Array.isArray(data)
        ? data
        : data?.results || [];

      setPurchases(
        purchaseList.map(normalizePurchase),
      );
    } catch (err) {
      console.error("Purchase loading error:", err);

      setError(err.message);

      openErrorModal(
        err.message ||
          "Purchases could not be loaded.",
        "Unable to Load Purchases",
      );
    } finally {
      setLoading(false);
    }
  };

  // =========================================================
  // LOAD SUPPLIERS
  // =========================================================

  const loadSuppliers = async () => {
    try {
      const data = await apiRequest("/suppliers/");

      const supplierList = Array.isArray(data)
        ? data
        : data?.results || [];

      setSuppliers(supplierList);

      return supplierList;
    } catch (err) {
      console.error("Supplier loading error:", err);

      return [];
    }
  };

  // =========================================================
  // LOAD PRODUCTS
  // =========================================================

  const loadProducts = async () => {
    try {
      const data = await apiRequest("/products/");

      const productList = Array.isArray(data)
        ? data
        : data?.results || [];

      setProducts(productList);

      return productList;
    } catch (err) {
      console.error("Product loading error:", err);

      return [];
    }
  };

  // =========================================================
  // INITIAL LOAD
  // =========================================================

  useEffect(() => {
    loadPurchases();
    loadSuppliers();
    loadProducts();
  }, []);

  // =========================================================
  // SUMMARY
  // =========================================================

  const totalPurchaseOrders = purchases.length;

  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();

  const thisMonthPurchases = purchases.filter(
    (purchase) => {
      if (!purchase.date) {
        return false;
      }

      const purchaseDate = new Date(purchase.date);

      return (
        purchaseDate.getMonth() === currentMonth &&
        purchaseDate.getFullYear() === currentYear
      );
    },
  ).length;

  const totalItemsPurchased = purchases.reduce(
    (sum, purchase) =>
      sum + Number(purchase.quantity || 0),
    0,
  );

  const totalPurchaseValue = purchases.reduce(
    (sum, purchase) =>
      sum + Number(purchase.total || 0),
    0,
  );

  // =========================================================
  // FILTER
  // =========================================================

  const filteredPurchases = useMemo(() => {
    const searchText = search.toLowerCase().trim();

    return purchases.filter((purchase) => {
      const billNumber = String(
        purchase.billNo || "",
      ).toLowerCase();

      const supplierName = String(
        purchase.supplier || "",
      ).toLowerCase();

      const matchesSearch =
        !searchText ||
        billNumber.includes(searchText) ||
        supplierName.includes(searchText);

      const matchesStatus =
        statusFilter === "All" ||
        purchase.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [purchases, search, statusFilter]);

  // =========================================================
  // UPLOAD MODAL
  // =========================================================

  const openUploadModal = () => {
    clearMessages();

    setSelectedFile(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    setShowUploadModal(true);
  };

  const closeUploadModal = () => {
    if (uploading) {
      return;
    }

    setShowUploadModal(false);
    setSelectedFile(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // =========================================================
  // FILE CHANGE
  // =========================================================

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];

    if (!file) {
      setSelectedFile(null);
      return;
    }

    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "application/pdf",
    ];

    const allowedExtensions = [
      ".jpg",
      ".jpeg",
      ".png",
      ".pdf",
    ];

    const fileName = file.name.toLowerCase();

    const hasValidType =
      allowedTypes.includes(file.type) ||
      allowedExtensions.some((extension) =>
        fileName.endsWith(extension),
      );

    if (!hasValidType) {
      setSelectedFile(null);

      event.target.value = "";

      openErrorModal(
        "Please select a JPG, JPEG, PNG or PDF purchase bill.",
        "Invalid Bill File",
      );

      return;
    }

    setSelectedFile(file);
  };

  // =========================================================
  // REMOVE FILE
  // =========================================================

  const handleRemoveFile = () => {
    if (uploading) {
      return;
    }

    setSelectedFile(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // =========================================================
  // GET FULL DRAFT
  // =========================================================

  const loadDraft = async (draftId) => {
    if (!draftId) {
      throw new Error(
        "Backend did not return draft_id after upload.",
      );
    }

    return await apiRequest(
      `/purchase-drafts/${draftId}/`,
    );
  };

  // =========================================================
  // FIND OCR SUPPLIER
  // =========================================================

  const findSupplierByName = (
    supplierList,
    supplierName,
  ) => {
    if (!supplierName) {
      return null;
    }

    const normalizedName = normalizeText(
      supplierName,
    );

    return (
      supplierList.find(
        (supplier) =>
          normalizeText(supplier.name) ===
          normalizedName,
      ) || null
    );
  };

  // =========================================================
  // BILL UPLOAD
  // =========================================================

  const handleBillUpload = async () => {
    if (!selectedFile) {
      openErrorModal(
        "Please select a purchase bill before uploading.",
        "Bill Required",
      );

      return;
    }

    try {
      setUploading(true);
      clearMessages();

      const formData = new FormData();

      formData.append(
        "bill_image",
        selectedFile,
      );

      const uploadResponse = await apiRequest(
        "/purchase-drafts/upload/",
        {
          method: "POST",
          body: formData,
        },
      );

      console.log(
        "UPLOAD RESPONSE:",
        uploadResponse,
      );

      const draftId = uploadResponse?.draft_id;

      if (!draftId) {
        throw new Error(
          "Bill uploaded but backend did not return draft_id.",
        );
      }

      const fullDraft =
        await loadDraft(draftId);

      console.log(
        "FULL DRAFT:",
        fullDraft,
      );

      setDraft(fullDraft);

      setOcrTax(
        Number(
          uploadResponse?.tax ??
            fullDraft?.tax ??
            0,
        ),
      );

      setOcrGrandTotal(
        Number(
          uploadResponse?.grand_total ??
            fullDraft?.grand_total ??
            0,
        ),
      );

      const draftItems = Array.isArray(
        fullDraft?.items,
      )
        ? fullDraft.items
        : [];

      setVerificationItems(
        draftItems.map((item) => ({
          itemId: item.id,

          productCode:
            item.original_product_code || "",

          productName:
            item.original_product_name || "",

          size: item.size || "",

          weight: item.weight || "",

          quantity: Number(
            item.quantity || 0,
          ),

          purchasePrice: Number(
            item.purchase_price || 0,
          ),

          sellingPrice: Number(
            item.selling_price || 0,
          ),

          matchedProduct:
            item.matched_product_details ||
            null,

          matchedProductId:
            item.matched_product || null,

          isIdentified: Boolean(
            item.is_identified,
          ),

          selectedProductId:
            item.matched_product || "",
        })),
      );

      // -------------------------------------------------------
      // SUPPLIER AUTO-SELECTION
      // -------------------------------------------------------

      const supplierList =
        await loadSuppliers();

      const draftSupplier =
        fullDraft?.supplier ||
        uploadResponse?.supplier ||
        null;

      let supplierId = "";

      if (
        draftSupplier &&
        typeof draftSupplier === "object"
      ) {
        supplierId =
          draftSupplier.id || "";
      } else if (draftSupplier) {
        supplierId = draftSupplier;
      }

      const ocrSupplierName =
        fullDraft?.original_supplier_name ||
        uploadResponse?.original_supplier_name ||
        "";

      /*
        CASE 1:
        Backend already matched supplier.
      */

      if (supplierId) {
        setVerificationSupplierId(
          String(supplierId),
        );
      } else {
        /*
          CASE 2:
          Search supplier by OCR name.
        */

        const existingSupplier =
          findSupplierByName(
            supplierList,
            ocrSupplierName,
          );

        if (existingSupplier) {
          /*
            Existing supplier:
            automatically selected.
          */

          setVerificationSupplierId(
            String(existingSupplier.id),
          );
        } else if (ocrSupplierName) {
          /*
            New supplier:
            automatically selected as NEW.
            Actual supplier creation happens
            only when Mama clicks Verify & Save.
          */

          setVerificationSupplierId(
            NEW_SUPPLIER_VALUE,
          );
        } else {
          /*
            OCR could not identify supplier.
          */

          setVerificationSupplierId("");
        }
      }

      setShowUploadModal(false);
      setSelectedFile(null);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      setShowVerificationModal(true);

      await loadProducts();
    } catch (err) {
      console.error(
        "Bill upload error:",
        err,
      );

      setShowUploadModal(false);

      openErrorModal(
        err.message ||
          "Bill upload failed. Please try again.",
        "Bill Upload Failed",
      );
    } finally {
      setUploading(false);
    }
  };

  // =========================================================
  // CLOSE VERIFICATION
  // =========================================================

  const closeVerificationModal = () => {
    if (
      verifying ||
      converting ||
      confirming
    ) {
      return;
    }

    setShowVerificationModal(false);
    setDraft(null);
    setVerificationItems([]);
    setVerificationSupplierId("");
  };

  // =========================================================
  // UPDATE VERIFICATION ITEM
  // =========================================================

  const updateVerificationItem = (
    itemId,
    field,
    value,
  ) => {
    setVerificationItems(
      (previous) =>
        previous.map((item) =>
          item.itemId === itemId
            ? {
                ...item,
                [field]: value,
              }
            : item,
        ),
    );
  };

  // =========================================================
  // PRODUCT SELECTION
  // =========================================================

  const handleProductSelection = (
    itemId,
    productId,
  ) => {
    const selectedProduct =
      products.find(
        (product) =>
          String(product.id) ===
          String(productId),
      );

    setVerificationItems(
      (previous) =>
        previous.map((item) => {
          if (
            item.itemId !== itemId
          ) {
            return item;
          }

          return {
            ...item,

            selectedProductId:
              productId,

            matchedProductId:
              productId || null,

            matchedProduct:
              selectedProduct || null,

            sellingPrice:
              Number(
                item.sellingPrice || 0,
              ) > 0
                ? item.sellingPrice
                : Number(
                    selectedProduct?.selling_price ||
                      0,
                  ),
          };
        }),
    );
  };

  // =========================================================
  // CREATE / RESOLVE NEW SUPPLIER
  // =========================================================

  const resolveVerificationSupplier =
    async () => {
      /*
        Existing supplier selected.
      */

      if (
        verificationSupplierId &&
        verificationSupplierId !==
          NEW_SUPPLIER_VALUE
      ) {
        return Number(
          verificationSupplierId,
        );
      }

      /*
        New supplier.
        Need OCR supplier name.
      */

      const supplierName =
        String(
          draft?.original_supplier_name ||
            "",
        ).trim();

      if (!supplierName) {
        throw new Error(
          "Supplier could not be detected from the bill. Please select a supplier manually.",
        );
      }

      /*
        Fetch latest supplier list again.
        This prevents duplicate creation if
        another user/process created it meanwhile.
      */

      const latestSuppliers =
        await loadSuppliers();

      const existingSupplier =
        findSupplierByName(
          latestSuppliers,
          supplierName,
        );

      if (existingSupplier) {
        setVerificationSupplierId(
          String(existingSupplier.id),
        );

        return Number(
          existingSupplier.id,
        );
      }

      /*
        Create new supplier ONLY NOW,
        when Mama confirms the bill.
      */

      const newSupplier =
        await apiRequest(
          "/suppliers/",
          {
            method: "POST",
            body: JSON.stringify({
              name: supplierName,
            }),
          },
        );

      if (!newSupplier?.id) {
        throw new Error(
          "Supplier could not be created.",
        );
      }

      setSuppliers((previous) => [
        ...previous,
        newSupplier,
      ]);

      setVerificationSupplierId(
        String(newSupplier.id),
      );

      return Number(
        newSupplier.id,
      );
    };

  // =========================================================
  // VERIFY DRAFT
  // =========================================================

  const handleVerifyDraft = async () => {
    if (!draft?.id) {
      openErrorModal(
        "Purchase draft is not available.",
        "Draft Not Found",
      );

      return;
    }

    /*
      Supplier validation.
    */

    if (!verificationSupplierId) {
      openErrorModal(
        "Please select or confirm the supplier before saving this purchase.",
        "Supplier Required",
      );

      return;
    }

    /*
      Product selling price validation.
    */

    for (const item of verificationItems) {
      if (
        !item.sellingPrice ||
        Number(item.sellingPrice) <= 0
      ) {
        openErrorModal(
          `Please enter a valid selling price for "${item.productName}".`,
          "Selling Price Required",
        );

        return;
      }
    }

    try {
      setVerifying(true);
      clearMessages();

      /*
        Resolve existing/new supplier.
      */

      const supplierId =
        await resolveVerificationSupplier();

      if (!supplierId) {
        throw new Error(
          "Supplier selection could not be completed.",
        );
      }

      const payload = {
        supplier_id: Number(
          supplierId,
        ),

        items: verificationItems.map(
          (item) => ({
            id: item.itemId,

            selling_price: Number(
              item.sellingPrice,
            ),
          }),
        ),
      };

      console.log(
        "VERIFY PAYLOAD:",
        payload,
      );

      await apiRequest(
        `/purchase-drafts/${draft.id}/verify/`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );

      await convertDraftToPurchase();
    } catch (err) {
      console.error(
        "Draft verification error:",
        err,
      );

      openErrorModal(
        err.message ||
          "Draft verification failed.",
        "Verification Failed",
      );
    } finally {
      setVerifying(false);
    }
  };

  // =========================================================
  // CONVERT DRAFT -> PURCHASE
  // =========================================================

  const convertDraftToPurchase =
    async () => {
      if (!draft?.id) {
        throw new Error(
          "Purchase draft is not available.",
        );
      }

      try {
        setConverting(true);

        const payload = {};

        if (
          ocrTax !== null &&
          ocrTax !== undefined
        ) {
          payload.tax = Number(ocrTax);
        }

        if (
          ocrGrandTotal !== null &&
          ocrGrandTotal !== undefined &&
          Number(ocrGrandTotal) > 0
        ) {
          payload.grand_total =
            Number(ocrGrandTotal);
        }

        console.log(
          "CONVERT PAYLOAD:",
          payload,
        );

        const data =
          await apiRequest(
            `/purchase-drafts/${draft.id}/convert/`,
            {
              method: "POST",
              body: JSON.stringify(
                payload,
              ),
            },
          );

        console.log(
          "CONVERT RESPONSE:",
          data,
        );

        const purchaseId =
          data?.purchase_id;

        if (!purchaseId) {
          throw new Error(
            "Purchase was created but backend did not return purchase_id.",
          );
        }

        const purchaseData =
          await apiRequest(
            `/purchases/${purchaseId}/`,
          );

        const purchase =
          normalizePurchase(
            purchaseData,
          );

        await loadPurchases();
        await loadSuppliers();
        await loadProducts();

        setShowVerificationModal(false);

        setShowDetails(purchase);

        setDraft(null);
        setVerificationItems([]);
        setVerificationSupplierId("");

        setSuccessMessage(
          "Purchase saved successfully. Confirm it to update stock.",
        );
      } catch (err) {
        console.error(
          "Convert purchase error:",
          err,
        );

        openErrorModal(
          err.message ||
            "Purchase could not be saved.",
          "Purchase Save Failed",
        );

        throw err;
      } finally {
        setConverting(false);
      }
    };

  // =========================================================
  // CONFIRM PURCHASE
  // =========================================================

  const handleConfirmPurchase =
    async (purchaseId) => {
      if (!purchaseId || confirming) {
        return;
      }

      try {
        setConfirming(true);
        clearMessages();

        const data =
          await apiRequest(
            `/purchases/${purchaseId}/confirm/`,
            {
              method: "POST",
              body: JSON.stringify({}),
            },
          );

        setPurchases((previous) =>
          previous.map((purchase) =>
            purchase.id === purchaseId
              ? { ...purchase, status: "Received" }
              : purchase,
          ),
        );
        setShowDetails(null);
        setSuccessMessage(
          data?.stock_updated
            ? "Purchase confirmed. Stock has been updated."
            : "This purchase was already confirmed. Stock was not changed again.",
        );

        await loadPurchases();
        await loadProducts();
      } catch (err) {
        console.error(
          "Purchase confirmation error:",
          err,
        );

        openErrorModal(
          err.message ||
            "Purchase confirmation failed.",
          "Confirmation Failed",
        );
      } finally {
        setConfirming(false);
      }
    };

  // =========================================================
  // MANUAL ADD
  // =========================================================

  const openAddModal = () => {
    clearMessages();

    setEditingPurchase(null);

    setForm({
      ...emptyForm,
      billNo: "",
    });

    setShowModal(true);
  };

  // =========================================================
  // MANUAL EDIT
  // =========================================================

  const openEditModal = (
    purchase,
  ) => {
    clearMessages();

    setEditingPurchase(purchase);

    setForm({
      billNo:
        purchase.billNo || "",

      supplier:
        purchase.supplier || "",

      date: purchase.date
        ? String(
            purchase.date,
          ).slice(0, 10)
        : new Date()
            .toISOString()
            .split("T")[0],

      items:
        purchase.items || "",

      quantity:
        purchase.quantity || "",

      total:
        purchase.total || "",

      status:
        purchase.status ||
        "Pending",

      paymentStatus:
        purchase.paymentStatus ||
        "Pending",
    });

    setShowModal(true);
  };

  // =========================================================
  // CLOSE MANUAL MODAL
  // =========================================================

  const closeModal = () => {
    setShowModal(false);
    setEditingPurchase(null);
    setForm(emptyForm);
  };

  // =========================================================
  // MANUAL FORM CHANGE
  // =========================================================

  const handleChange = (
    event,
  ) => {
    const {
      name,
      value,
    } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  // =========================================================
  // MANUAL SAVE
  // =========================================================

  const handleSubmit = async (
    event,
  ) => {
    event.preventDefault();

    clearMessages();

    if (!form.billNo.trim()) {
      openErrorModal(
        "Bill number is required.",
        "Bill Number Required",
      );

      return;
    }

    if (!form.supplier.trim()) {
      openErrorModal(
        "Supplier is required.",
        "Supplier Required",
      );

      return;
    }

    if (!form.date) {
      openErrorModal(
        "Purchase date is required.",
        "Purchase Date Required",
      );

      return;
    }

    try {
      setLoading(true);

      let supplier =
        suppliers.find(
          (item) =>
            normalizeText(
              item.name,
            ) ===
            normalizeText(
              form.supplier,
            ),
        );

      if (!supplier) {
        supplier =
          await apiRequest(
            "/suppliers/",
            {
              method: "POST",
              body: JSON.stringify({
                name: form.supplier.trim(),
              }),
            },
          );
      }

      const payload = {
        supplier:
          supplier.id,

        bill_number:
          form.billNo.trim(),

        bill_date:
          form.date,

        tax: 0,

        grand_total:
          Number(
            form.total || 0,
          ),
      };

      if (editingPurchase) {
        await apiRequest(
          `/purchases/${editingPurchase.id}/`,
          {
            method: "PATCH",
            body: JSON.stringify(
              payload,
            ),
          },
        );
      } else {
        await apiRequest(
          "/purchases/",
          {
            method: "POST",
            body: JSON.stringify(
              payload,
            ),
          },
        );
      }

      await loadPurchases();
      await loadSuppliers();

      closeModal();

      setSuccessMessage(
        editingPurchase
          ? "Purchase updated successfully."
          : "Purchase saved successfully.",
      );
    } catch (err) {
      console.error(
        "Manual purchase error:",
        err,
      );

      openErrorModal(
        err.message ||
          "Could not save purchase.",
        "Purchase Save Failed",
      );
    } finally {
      setLoading(false);
    }
  };

  // =========================================================
  // DELETE PURCHASE
  // =========================================================

  const handleDelete = async (
    id,
  ) => {
    const purchase =
      purchases.find(
        (item) => item.id === id,
      );

    if (!purchase) {
      return;
    }

    const confirmed =
      window.confirm(
        `Delete purchase "${purchase.billNo}"?`,
      );

    if (!confirmed) {
      return;
    }

    try {
      setLoading(true);
      clearMessages();

      await apiRequest(
        `/purchases/${id}/`,
        {
          method: "DELETE",
        },
      );

      await loadPurchases();

      if (
        showDetails?.id === id
      ) {
        setShowDetails(null);
      }

      setSuccessMessage(
        "Purchase deleted successfully.",
      );
    } catch (err) {
      console.error(
        "Delete purchase error:",
        err,
      );

      openErrorModal(
        err.message ||
          "Could not delete purchase.",
        "Delete Failed",
      );
    } finally {
      setLoading(false);
    }
  };

  // =========================================================
  // RESET FILTERS
  // =========================================================

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("All");
  };

  // =========================================================
  // CURRENT OCR SUPPLIER NAME
  // =========================================================

  const ocrSupplierName =
    draft?.original_supplier_name ||
    "";

  const selectedSupplier =
    verificationSupplierId &&
    verificationSupplierId !==
      NEW_SUPPLIER_VALUE
      ? suppliers.find(
          (supplier) =>
            String(
              supplier.id,
            ) ===
            String(
              verificationSupplierId,
            ),
        )
      : null;

  const isNewSupplier =
    verificationSupplierId ===
    NEW_SUPPLIER_VALUE;

  // =========================================================
  // RETURN
  // =========================================================

  return (
    <div className="purchases-page">
      {/* =====================================================
          GLOBAL SUCCESS / ERROR
      ====================================================== */}

      {(error || successMessage) && (
        <div
          className={
            error
              ? "purchase-error-message"
              : "purchase-success-message"
          }
        >
          <span>
            {error ||
              successMessage}
          </span>

          <button
            type="button"
            onClick={
              clearMessages
            }
          >
            ×
          </button>
        </div>
      )}

      {/* =====================================================
          HEADER
      ====================================================== */}

      <div className="purchases-page-header">
        <div className="purchases-heading">
          <span className="purchases-overline">
            PURCHASE MANAGEMENT
          </span>

          <h1>Purchases</h1>

          <p>
            Manage purchase bills,
            suppliers and incoming
            stock.
          </p>
        </div>

        <div className="purchases-header-actions">
          <button
            type="button"
            className="purchases-history-button"
            onClick={() => onNavigate?.("purchase-history")}
          >
            ↻ Purchase History
          </button>

          <button
            type="button"
            className="purchases-upload-button"
            onClick={
              openUploadModal
            }
            disabled={uploading}
          >
            ↑ Upload Bill
          </button>

          <button
            type="button"
            className="purchases-add-button"
            onClick={
              openAddModal
            }
          >
            <span>+</span>
            Add Purchase
          </button>
        </div>
      </div>

      {/* =====================================================
          SUMMARY
      ====================================================== */}

      <div className="purchases-summary">
        <div className="purchases-summary-card">
          <div className="purchases-summary-icon orders">
            ▣
          </div>

          <div>
            <span>
              Total Purchase Orders
            </span>

            <strong>
              {totalPurchaseOrders}
            </strong>

            <small>
              All purchase
              transactions
            </small>
          </div>
        </div>

        <div className="purchases-summary-card">
          <div className="purchases-summary-icon month">
            ◷
          </div>

          <div>
            <span>
              This Month
            </span>

            <strong>
              {thisMonthPurchases}
            </strong>

            <small>
              Purchase orders
              this month
            </small>
          </div>
        </div>

        <div className="purchases-summary-card">
          <div className="purchases-summary-icon items">
            ◫
          </div>

          <div>
            <span>
              Total Items
              Purchased
            </span>

            <strong>
              {totalItemsPurchased.toLocaleString(
                "en-IN",
              )}
            </strong>

            <small>
              Total quantity
              received
            </small>
          </div>
        </div>

        <div className="purchases-summary-card">
          <div className="purchases-summary-icon value">
            ₹
          </div>

          <div>
            <span>
              Total Purchase
              Value
            </span>

            <strong>
              {formatCurrency(
                totalPurchaseValue,
              )}
            </strong>

            <small>
              Overall purchase
              amount
            </small>
          </div>
        </div>
      </div>

      {/* =====================================================
          MAIN PANEL
      ====================================================== */}

      <section className="purchases-main-panel">
        <div className="purchases-toolbar">
          <div className="purchases-section-title">
            <span>
              PURCHASE REGISTER
            </span>

            <h2>
              All Purchases
            </h2>
          </div>

          <div className="purchases-toolbar-actions">
            <div className="purchases-search-box">
              <span>⌕</span>

              <input
                type="text"
                value={search}
                onChange={(event) =>
                  setSearch(
                    event.target.value,
                  )
                }
                placeholder="Search bill or supplier..."
              />
            </div>

            <select
              className="purchases-status-filter"
              value={
                statusFilter
              }
              onChange={(event) =>
                setStatusFilter(
                  event.target.value,
                )
              }
            >
              <option value="All">
                All Status
              </option>

              <option value="Received">
                Received
              </option>

              <option value="Pending">
                Pending
              </option>
            </select>

            <button
              type="button"
              className="purchases-reset-button"
              onClick={
                resetFilters
              }
            >
              Reset
            </button>
          </div>
        </div>

        {/* ===================================================
            PURCHASE CARDS
        ==================================================== */}

        <div className="purchases-card-grid">
          {loading &&
          purchases.length === 0 ? (
            <div className="purchases-empty">
              <div className="purchases-empty-icon">
                ◷
              </div>

              <strong>
                Loading purchases...
              </strong>

              <span>
                Fetching purchase
                records from
                backend.
              </span>
            </div>
          ) : filteredPurchases.length >
            0 ? (
            filteredPurchases.map(
              (purchase) => (
                <div
                  className="purchase-card"
                  key={
                    purchase.id
                  }
                >
                  <div className="purchase-card-header">
                    <div>
                      <span className="purchase-card-label">
                        BILL NUMBER
                      </span>

                      <h3>
                        {
                          purchase.billNo
                        }
                      </h3>
                    </div>

                    <span
                      className={`purchase-status ${
                        purchase.status ===
                        "Received"
                          ? "received"
                          : "pending"
                      }`}
                    >
                      <i></i>

                      {
                        purchase.status
                      }
                    </span>
                  </div>

                  <div className="purchase-supplier">
                    <div className="purchase-supplier-icon">
                      {purchase.supplier
                        ? purchase.supplier
                            .charAt(
                              0,
                            )
                            .toUpperCase()
                        : "S"}
                    </div>

                    <div>
                      <span>
                        SUPPLIER
                      </span>

                      <strong>
                        {
                          purchase.supplier
                        }
                      </strong>
                    </div>
                  </div>

                  <div className="purchase-card-info">
                    <div className="purchase-info-item">
                      <span>
                        PURCHASE DATE
                      </span>

                      <strong>
                        {formatDate(
                          purchase.date,
                        )}
                      </strong>
                    </div>

                    <div className="purchase-info-item">
                      <span>
                        ITEMS
                      </span>

                      <strong>
                        {
                          purchase.items
                        }
                      </strong>
                    </div>

                    <div className="purchase-info-item">
                      <span>
                        QUANTITY
                      </span>

                      <strong>
                        {Number(
                          purchase.quantity ||
                            0,
                        ).toLocaleString(
                          "en-IN",
                        )}
                      </strong>
                    </div>

                    <div className="purchase-info-item">
                      <span>
                        PAYMENT
                      </span>

                      <strong>
                        {
                          purchase.paymentStatus
                        }
                      </strong>
                    </div>
                  </div>

                  <div className="purchase-card-total">
                    <span>
                      Total Purchase
                      Value
                    </span>

                    <strong>
                      {formatCurrency(
                        purchase.total,
                      )}
                    </strong>
                  </div>

                  <div className="purchase-card-footer">
                    <button
                      type="button"
                      className="purchase-view-button"
                      onClick={() =>
                        setShowDetails(
                          purchase,
                        )
                      }
                    >
                      View Details
                    </button>

                    <div className="purchase-actions">
                      <button
                        type="button"
                        className="purchase-action edit"
                        title="Edit"
                        onClick={() =>
                          openEditModal(
                            purchase,
                          )
                        }
                      >
                        ✎
                      </button>

                      <button
                        type="button"
                        className="purchase-action delete"
                        title="Delete"
                        onClick={() =>
                          handleDelete(
                            purchase.id,
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </div>
              ),
            )
          ) : (
            <div className="purchases-empty">
              <div className="purchases-empty-icon">
                ▣
              </div>

              <strong>
                No purchases found
              </strong>

              <span>
                Upload a bill or
                add a purchase
                manually.
              </span>
            </div>
          )}
        </div>

        <div className="purchases-table-footer">
          <span>
            Showing{" "}
            <strong>
              {
                filteredPurchases.length
              }
            </strong>{" "}
            of{" "}
            <strong>
              {purchases.length}
            </strong>{" "}
            purchases
          </span>

          <span className="purchases-footer-status">
            PURCHASE REGISTER
          </span>
        </div>
      </section>

      {/* =====================================================
          MANUAL ADD / EDIT
      ====================================================== */}

      {showModal && (
        <div className="purchase-modal-overlay">
          <div className="purchase-modal">
            <div className="purchase-modal-header">
              <div>
                <span className="purchase-modal-overline">
                  {editingPurchase
                    ? "UPDATE PURCHASE"
                    : "NEW PURCHASE"}
                </span>

                <h2>
                  {editingPurchase
                    ? "Edit Purchase"
                    : "Add Purchase"}
                </h2>

                <p>
                  Enter purchase
                  bill and supplier
                  details.
                </p>
              </div>

              <button
                type="button"
                className="purchase-modal-close"
                onClick={
                  closeModal
                }
              >
                ×
              </button>
            </div>

            <form
              onSubmit={
                handleSubmit
              }
            >
              <div className="purchase-form-grid">
                <div className="purchase-form-group">
                  <label>
                    Bill Number *
                  </label>

                  <input
                    type="text"
                    name="billNo"
                    value={
                      form.billNo
                    }
                    onChange={
                      handleChange
                    }
                    placeholder="PUR-0001"
                    required
                  />
                </div>

                <div className="purchase-form-group">
                  <label>
                    Supplier *
                  </label>

                  <input
                    type="text"
                    name="supplier"
                    value={
                      form.supplier
                    }
                    onChange={
                      handleChange
                    }
                    placeholder="Supplier name"
                    required
                  />
                </div>

                <div className="purchase-form-group">
                  <label>
                    Purchase Date *
                  </label>

                  <input
                    type="date"
                    name="date"
                    value={
                      form.date
                    }
                    onChange={
                      handleChange
                    }
                    required
                  />
                </div>

                <div className="purchase-form-group">
                  <label>
                    Number of Items
                  </label>

                  <input
                    type="number"
                    name="items"
                    value={
                      form.items
                    }
                    onChange={
                      handleChange
                    }
                    placeholder="0"
                    min="0"
                  />
                </div>

                <div className="purchase-form-group">
                  <label>
                    Total Quantity
                  </label>

                  <input
                    type="number"
                    name="quantity"
                    value={
                      form.quantity
                    }
                    onChange={
                      handleChange
                    }
                    placeholder="0"
                    min="0"
                  />
                </div>

                <div className="purchase-form-group">
                  <label>
                    Total Amount
                  </label>

                  <input
                    type="number"
                    name="total"
                    value={
                      form.total
                    }
                    onChange={
                      handleChange
                    }
                    placeholder="0"
                    min="0"
                    step="0.01"
                  />
                </div>

                <div className="purchase-form-group">
                  <label>
                    Purchase Status
                  </label>

                  <select
                    name="status"
                    value={
                      form.status
                    }
                    onChange={
                      handleChange
                    }
                  >
                    <option value="Received">
                      Received
                    </option>

                    <option value="Pending">
                      Pending
                    </option>
                  </select>
                </div>

                <div className="purchase-form-group">
                  <label>
                    Payment Status
                  </label>

                  <select
                    name="paymentStatus"
                    value={
                      form.paymentStatus
                    }
                    onChange={
                      handleChange
                    }
                  >
                    <option value="Paid">
                      Paid
                    </option>

                    <option value="Partial">
                      Partial
                    </option>

                    <option value="Pending">
                      Pending
                    </option>
                  </select>
                </div>
              </div>

              <div className="purchase-modal-footer">
                <button
                  type="button"
                  className="purchase-cancel-button"
                  onClick={
                    closeModal
                  }
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="purchase-save-button"
                  disabled={
                    loading
                  }
                >
                  {loading
                    ? "Saving..."
                    : editingPurchase
                      ? "Update Purchase"
                      : "Save Purchase"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================
          UPLOAD BILL MODAL
      ====================================================== */}

      {showUploadModal && (
        <div className="purchase-modal-overlay">
          <div className="purchase-modal upload-bill-modal">
            {uploading && (
              <div
                className="bill-reading-overlay"
                role="status"
                aria-live="polite"
                aria-label="Reading and extracting bill details"
              >
                <div className="bill-reading-card">
                  <span className="bill-reading-spinner" aria-hidden="true" />
                  <strong>Reading your bill</strong>
                  <span>
                    Extracting supplier, items and totals. This may take a
                    little while.
                  </span>
                  {selectedFile?.name && (
                    <small title={selectedFile.name}>
                      {selectedFile.name}
                    </small>
                  )}
                  <span className="bill-reading-progress" aria-hidden="true">
                    <span />
                  </span>
                </div>
              </div>
            )}
            <div className="purchase-modal-header">
              <div>
                <span className="purchase-modal-overline">
                  PURCHASE BILL
                </span>

                <h2>
                  Upload Bill
                </h2>

                <p>
                  Upload your purchase
                  bill for automatic
                  OCR extraction.
                </p>
              </div>

              <button
                type="button"
                className="purchase-modal-close"
                onClick={
                  closeUploadModal
                }
                disabled={
                  uploading
                }
              >
                ×
              </button>
            </div>

            <div className="upload-bill-body">
              <label
                className={`upload-drop-zone ${
                  selectedFile
                    ? "has-file"
                    : ""
                }`}
              >
                <input
                  ref={
                    fileInputRef
                  }
                  type="file"
                  accept=".jpg,.jpeg,.png,.pdf"
                  onChange={
                    handleFileChange
                  }
                  disabled={
                    uploading
                  }
                />

                <div className="upload-cloud-icon">
                  ↑
                </div>

                <strong>
                  Choose your bill
                </strong>

                <span>
                  JPG, JPEG, PNG or
                  PDF
                </span>

                <small>
                  Click here to
                  select a purchase
                  bill
                </small>
              </label>

              {selectedFile && (
                <div className="selected-bill-file">
                  <div className="selected-bill-file-info">
                    <div className="selected-bill-file-icon">
                      📄
                    </div>

                    <div className="selected-bill-file-details">
                      <strong
                        title={
                          selectedFile.name
                        }
                      >
                        {
                          selectedFile.name
                        }
                      </strong>

                      <span>
                        {(
                          selectedFile.size /
                          1024
                        ).toFixed(
                          1,
                        )}{" "}
                        KB
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="remove-file-btn"
                    onClick={
                      handleRemoveFile
                    }
                    disabled={
                      uploading
                    }
                  >
                    ×
                  </button>
                </div>
              )}
            </div>

            <div className="purchase-modal-footer">
              <button
                type="button"
                className="purchase-cancel-button"
                onClick={
                  closeUploadModal
                }
                disabled={
                  uploading
                }
              >
                Cancel
              </button>

              <button
                type="button"
                className="purchase-save-button"
                onClick={
                  handleBillUpload
                }
                disabled={
                  uploading ||
                  !selectedFile
                }
              >
                {uploading ? (
                  <>
                    <span className="button-spinner"></span>
                    Reading Bill...
                  </>
                ) : (
                  "Upload & Extract"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================
          ERROR POPUP
      ====================================================== */}

      {showErrorModal && (
        <div
          className="purchase-modal-overlay"
          style={{
            zIndex: 9999,
            background:
              "rgba(2, 12, 18, 0.82)",
            backdropFilter:
              "blur(5px)",
          }}
        >
          <div
            className="purchase-modal"
            style={{
              maxWidth: "500px",
              width: "calc(100% - 32px)",
            }}
          >
            <div
              style={{
                padding: "28px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  width: "58px",
                  height: "58px",
                  borderRadius: "50%",
                  margin: "0 auto 18px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent:
                    "center",
                  background:
                    "rgba(255, 70, 70, 0.14)",
                  border:
                    "1px solid rgba(255, 90, 90, 0.35)",
                  color: "#ff6b6b",
                  fontSize: "28px",
                  fontWeight: 800,
                }}
              >
                !
              </div>

              <span
                style={{
                  display: "block",
                  fontSize: "11px",
                  letterSpacing:
                    "1.6px",
                  fontWeight: 800,
                  color: "#ff6b6b",
                  marginBottom: "8px",
                }}
              >
                ACTION REQUIRED
              </span>

              <h2
                style={{
                  margin:
                    "0 0 10px",
                }}
              >
                {errorModalTitle}
              </h2>

              <p
                style={{
                  margin: 0,
                  lineHeight: 1.6,
                  opacity: 0.78,
                  whiteSpace:
                    "pre-wrap",
                }}
              >
                {errorModalMessage}
              </p>

              <button
                type="button"
                className="purchase-save-button"
                style={{
                  marginTop: "24px",
                  minWidth: "120px",
                }}
                onClick={
                  closeErrorModal
                }
              >
                OK, Got It
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================
          VERIFICATION MODAL
      ====================================================== */}

      {showVerificationModal &&
        draft && (
          <div className="purchase-modal-overlay">
            <div
              className="purchase-details-modal"
              style={{
                maxWidth:
                  "1080px",
                width:
                  "calc(100% - 32px)",
                maxHeight:
                  "92vh",
                overflow:
                  "hidden",
                display:
                  "flex",
                flexDirection:
                  "column",
              }}
            >
              {/* HEADER */}

              <div
                className="purchase-modal-header"
                style={{
                  flexShrink: 0,
                }}
              >
                <div>
                  <span className="purchase-modal-overline">
                    BILL VERIFICATION
                  </span>

                  <h2>
                    Review Purchase
                  </h2>

                  <p>
                    Check the extracted
                    bill details before
                    saving the purchase.
                  </p>
                </div>

                <button
                  type="button"
                  className="purchase-modal-close"
                  onClick={
                    closeVerificationModal
                  }
                  disabled={
                    verifying ||
                    converting
                  }
                >
                  ×
                </button>
              </div>

              {/* BODY */}

              <div
                className="purchase-details-body"
                style={{
                  overflowY:
                    "auto",
                  padding:
                    "22px 26px 26px",
                }}
              >
                {/* =========================================
                    REVIEW STATUS
                ========================================== */}

                <div
                  style={{
                    display:
                      "grid",
                    gridTemplateColumns:
                      "repeat(3, minmax(0, 1fr))",
                    gap: "12px",
                    marginBottom:
                      "20px",
                  }}
                >
                  <div
                    style={{
                      border:
                        "1px solid rgba(0,208,132,0.18)",
                      background:
                        "rgba(0,208,132,0.06)",
                      borderRadius:
                        "12px",
                      padding:
                        "15px",
                    }}
                  >
                    <span
                      style={{
                        display:
                          "block",
                        fontSize:
                          "10px",
                        letterSpacing:
                          "1.2px",
                        opacity:
                          0.55,
                        marginBottom:
                          "6px",
                      }}
                    >
                      OCR STATUS
                    </span>

                    <strong
                      style={{
                        color:
                          "#00d084",
                      }}
                    >
                      ✓ Data Extracted
                    </strong>
                  </div>

                  <div
                    style={{
                      border:
                        "1px solid rgba(255,255,255,0.08)",
                      background:
                        "rgba(255,255,255,0.025)",
                      borderRadius:
                        "12px",
                      padding:
                        "15px",
                    }}
                  >
                    <span
                      style={{
                        display:
                          "block",
                        fontSize:
                          "10px",
                        letterSpacing:
                          "1.2px",
                        opacity:
                          0.55,
                        marginBottom:
                          "6px",
                      }}
                    >
                      PRODUCTS
                    </span>

                    <strong>
                      {
                        verificationItems.length
                      }{" "}
                      item
                      {verificationItems.length !==
                      1
                        ? "s"
                        : ""}
                    </strong>
                  </div>

                  <div
                    style={{
                      border:
                        "1px solid rgba(255,255,255,0.08)",
                      background:
                        "rgba(255,255,255,0.025)",
                      borderRadius:
                        "12px",
                      padding:
                        "15px",
                    }}
                  >
                    <span
                      style={{
                        display:
                          "block",
                        fontSize:
                          "10px",
                        letterSpacing:
                          "1.2px",
                        opacity:
                          0.55,
                        marginBottom:
                          "6px",
                      }}
                    >
                      GRAND TOTAL
                    </span>

                    <strong
                      style={{
                        fontSize:
                          "17px",
                      }}
                    >
                      {formatCurrency(
                        ocrGrandTotal,
                      )}
                    </strong>
                  </div>
                </div>

                {/* =========================================
                    BILL INFORMATION
                ========================================== */}

                <div
                  style={{
                    border:
                      "1px solid rgba(255,255,255,0.08)",
                    borderRadius:
                      "14px",
                    padding:
                      "18px",
                    marginBottom:
                      "20px",
                    background:
                      "rgba(255,255,255,0.018)",
                  }}
                >
                  <div
                    style={{
                      display:
                        "flex",
                      alignItems:
                        "center",
                      justifyContent:
                        "space-between",
                      gap: "12px",
                      marginBottom:
                        "16px",
                    }}
                  >
                    <div>
                      <span
                        style={{
                          display:
                            "block",
                          fontSize:
                            "10px",
                          letterSpacing:
                            "1.3px",
                          color:
                            "#00d084",
                          fontWeight:
                            800,
                          marginBottom:
                            "4px",
                        }}
                      >
                        BILL INFORMATION
                      </span>

                      <strong
                        style={{
                          fontSize:
                            "16px",
                        }}
                      >
                        Invoice Details
                      </strong>
                    </div>

                    <span
                      style={{
                        padding:
                          "6px 10px",
                        borderRadius:
                          "20px",
                        background:
                          "rgba(0,208,132,0.10)",
                        border:
                          "1px solid rgba(0,208,132,0.20)",
                        color:
                          "#00d084",
                        fontSize:
                          "10px",
                        fontWeight:
                          800,
                      }}
                    >
                      OCR EXTRACTED
                    </span>
                  </div>

                  <div
                    style={{
                      display:
                        "grid",
                      gridTemplateColumns:
                        "repeat(3, minmax(0, 1fr))",
                      gap: "12px",
                    }}
                  >
                    <div
                      style={{
                        padding:
                          "12px",
                        borderRadius:
                          "10px",
                        background:
                          "rgba(255,255,255,0.025)",
                      }}
                    >
                      <span
                        style={{
                          display:
                            "block",
                          fontSize:
                            "10px",
                          opacity:
                            0.5,
                          marginBottom:
                            "5px",
                        }}
                      >
                        BILL NUMBER
                      </span>

                      <strong>
                        {
                          draft.bill_number ||
                          "—"
                        }
                      </strong>
                    </div>

                    <div
                      style={{
                        padding:
                          "12px",
                        borderRadius:
                          "10px",
                        background:
                          "rgba(255,255,255,0.025)",
                      }}
                    >
                      <span
                        style={{
                          display:
                            "block",
                          fontSize:
                            "10px",
                          opacity:
                            0.5,
                          marginBottom:
                            "5px",
                        }}
                      >
                        BILL DATE
                      </span>

                      <strong>
                        {formatDate(
                          draft.bill_date,
                        )}
                      </strong>
                    </div>

                    <div
                      style={{
                        padding:
                          "12px",
                        borderRadius:
                          "10px",
                        background:
                          "rgba(255,255,255,0.025)",
                      }}
                    >
                      <span
                        style={{
                          display:
                            "block",
                          fontSize:
                            "10px",
                          opacity:
                            0.5,
                          marginBottom:
                            "5px",
                        }}
                      >
                        TAX
                      </span>

                      <strong>
                        {formatCurrency(
                          ocrTax,
                        )}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* =========================================
                    SUPPLIER
                ========================================== */}

                <div
                  style={{
                    border:
                      "1px solid rgba(255,255,255,0.08)",
                    borderRadius:
                      "14px",
                    padding:
                      "18px",
                    marginBottom:
                      "20px",
                    background:
                      "rgba(255,255,255,0.018)",
                  }}
                >
                  <div
                    style={{
                      display:
                        "flex",
                      justifyContent:
                        "space-between",
                      alignItems:
                        "center",
                      marginBottom:
                        "14px",
                    }}
                  >
                    <div>
                      <span
                        style={{
                          display:
                            "block",
                          fontSize:
                            "10px",
                          letterSpacing:
                            "1.3px",
                          color:
                            "#00d084",
                          fontWeight:
                            800,
                          marginBottom:
                            "4px",
                        }}
                      >
                        SUPPLIER
                      </span>

                      <strong
                        style={{
                          fontSize:
                            "16px",
                        }}
                      >
                        Confirm Supplier
                      </strong>
                    </div>

                    {isNewSupplier ? (
                      <span
                        style={{
                          padding:
                            "6px 10px",
                          borderRadius:
                            "20px",
                          background:
                            "rgba(255,190,60,0.10)",
                          border:
                            "1px solid rgba(255,190,60,0.25)",
                          color:
                            "#ffc857",
                          fontSize:
                            "10px",
                          fontWeight:
                            800,
                        }}
                      >
                        NEW SUPPLIER
                      </span>
                    ) : selectedSupplier ? (
                      <span
                        style={{
                          padding:
                            "6px 10px",
                          borderRadius:
                            "20px",
                          background:
                            "rgba(0,208,132,0.10)",
                          border:
                            "1px solid rgba(0,208,132,0.20)",
                          color:
                            "#00d084",
                          fontSize:
                            "10px",
                          fontWeight:
                            800,
                        }}
                      >
                        EXISTING SUPPLIER
                      </span>
                    ) : null}
                  </div>

                  <div
                    className="purchase-form-group"
                  >
                    <label>
                      Supplier *
                    </label>

                    <select
                      value={
                        verificationSupplierId
                      }
                      onChange={(
                        event,
                      ) =>
                        setVerificationSupplierId(
                          event.target
                            .value,
                        )
                      }
                    >
                      <option value="">
                        Select Supplier
                      </option>

                      {isNewSupplier &&
                        ocrSupplierName && (
                          <option
                            value={
                              NEW_SUPPLIER_VALUE
                            }
                          >
                            + New Supplier —{" "}
                            {
                              ocrSupplierName
                            }{" "}
                            (will be created on
                            verify)
                          </option>
                        )}

                      {suppliers.map(
                        (
                          supplier,
                        ) => (
                          <option
                            key={
                              supplier.id
                            }
                            value={
                              supplier.id
                            }
                          >
                            {
                              supplier.name
                            }
                          </option>
                        ),
                      )}
                    </select>

                    {ocrSupplierName && (
                      <div
                        style={{
                          marginTop:
                            "10px",
                          padding:
                            "10px 12px",
                          borderRadius:
                            "9px",
                          background:
                            "rgba(0,208,132,0.05)",
                          border:
                            "1px solid rgba(0,208,132,0.12)",
                          fontSize:
                            "12px",
                        }}
                      >
                        <span
                          style={{
                            opacity:
                              0.55,
                          }}
                        >
                          OCR detected:
                        </span>{" "}
                        <strong>
                          {
                            ocrSupplierName
                          }
                        </strong>

                        {draft?.supplier_phone && (
                          <span
                            style={{
                              display: "block",
                              marginTop: "4px",
                            }}
                          >
                            Phone detected:{" "}
                            <strong>
                              {draft.supplier_phone}
                            </strong>
                          </span>
                        )}

                        {draft?.supplier_gstin && (
                          <span
                            style={{
                              display: "block",
                              marginTop: "4px",
                            }}
                          >
                            GSTIN detected:{" "}
                            <strong>
                              {draft.supplier_gstin}
                            </strong>
                          </span>
                        )}

                        {(draft?.supplier_phone ||
                          draft?.supplier_gstin) && (
                          <span
                            style={{
                              display: "block",
                              marginTop: "6px",
                              opacity: 0.75,
                            }}
                          >
                            Detected details will fill only
                            empty fields on an existing supplier.
                          </span>
                        )}

                        {isNewSupplier && (
                          <span
                            style={{
                              display:
                                "block",
                              marginTop:
                                "4px",
                              color:
                                "#ffc857",
                              fontSize:
                                "11px",
                            }}
                          >
                              New supplier will be created when
                              you click
                            Verify & Save
                            Purchase.
                          </span>
                        )}
                      </div>
                    )}

                    {!ocrSupplierName && (
                      <div
                        style={{
                          marginTop:
                            "10px",
                          padding:
                            "10px 12px",
                          borderRadius:
                            "9px",
                          background:
                            "rgba(255,80,80,0.06)",
                          border:
                            "1px solid rgba(255,80,80,0.16)",
                          color:
                            "#ff8b8b",
                          fontSize:
                            "12px",
                        }}
                      >
                        Supplier could not
                        be detected from
                        this bill. Please
                        select a supplier
                        manually.
                      </div>
                    )}
                  </div>
                </div>

                {/* =========================================
                    PRODUCTS
                ========================================== */}

                <div
                  style={{
                    marginBottom:
                      "20px",
                  }}
                >
                  <div
                    style={{
                      marginBottom:
                        "12px",
                    }}
                  >
                    <span
                      style={{
                        display:
                          "block",
                        fontSize:
                          "10px",
                        letterSpacing:
                          "1.3px",
                        color:
                          "#00d084",
                        fontWeight:
                          800,
                        marginBottom:
                          "4px",
                      }}
                    >
                      PRODUCTS
                    </span>

                    <strong
                      style={{
                        fontSize:
                          "16px",
                      }}
                    >
                      Review Extracted
                      Products
                    </strong>

                    <p
                      style={{
                        margin:
                          "5px 0 0",
                        fontSize:
                          "12px",
                        opacity:
                          0.55,
                      }}
                    >
                      Purchase rate is
                      read from the bill.
                      Selling price must
                      be confirmed by Mama.
                    </p>
                  </div>

                  {verificationItems.length ===
                  0 ? (
                    <div
                      style={{
                        padding:
                          "25px",
                        textAlign:
                          "center",
                        border:
                          "1px dashed rgba(255,255,255,0.12)",
                        borderRadius:
                          "12px",
                        opacity:
                          0.7,
                      }}
                    >
                      No products were
                      extracted from the
                      bill.
                    </div>
                  ) : (
                    verificationItems.map(
                      (
                        item,
                        index,
                      ) => (
                        <div
                          key={
                            item.itemId
                          }
                          style={{
                            border:
                              "1px solid rgba(255,255,255,0.08)",
                            borderRadius:
                              "14px",
                            padding:
                              "18px",
                            marginBottom:
                              "12px",
                            background:
                              "rgba(255,255,255,0.018)",
                          }}
                        >
                          <div
                            style={{
                              display:
                                "flex",
                              justifyContent:
                                "space-between",
                              alignItems:
                                "flex-start",
                              gap: "12px",
                              marginBottom:
                                "16px",
                            }}
                          >
                            <div>
                              <span
                                style={{
                                  display:
                                    "inline-block",
                                  fontSize:
                                    "10px",
                                  letterSpacing:
                                    "1px",
                                  opacity:
                                    0.45,
                                  marginBottom:
                                    "6px",
                                }}
                              >
                                ITEM #
                                {index +
                                  1}
                              </span>

                              <h3
                                style={{
                                  margin:
                                    0,
                                  fontSize:
                                    "16px",
                                  lineHeight:
                                    1.4,
                                }}
                              >
                                {
                                  item.productName
                                }
                              </h3>

                              {item.productCode && (
                                <small
                                  style={{
                                    display:
                                      "block",
                                    marginTop:
                                      "5px",
                                    opacity:
                                      0.55,
                                  }}
                                >
                                  Product Code:{" "}
                                  {
                                    item.productCode
                                  }
                                </small>
                              )}
                              {(item.size || item.weight) && (
                                <small
                                  style={{
                                    display: "block",
                                    marginTop: "5px",
                                    opacity: 0.7,
                                  }}
                                >
                                  {item.size ? `Size: ${item.size}` : ""}
                                  {item.size && item.weight ? " · " : ""}
                                  {item.weight ? `Weight: ${item.weight}` : ""}
                                </small>
                              )}
                            </div>

                            <span
                              style={{
                                flexShrink:
                                  0,
                                padding:
                                  "6px 10px",
                                borderRadius:
                                  "20px",
                                background:
                                  item.isIdentified
                                    ? "rgba(0,208,132,0.10)"
                                    : "rgba(255,190,60,0.10)",
                                border:
                                  item.isIdentified
                                    ? "1px solid rgba(0,208,132,0.20)"
                                    : "1px solid rgba(255,190,60,0.20)",
                                color:
                                  item.isIdentified
                                    ? "#00d084"
                                    : "#ffc857",
                                fontSize:
                                  "10px",
                                fontWeight:
                                  800,
                              }}
                            >
                              {item.isIdentified
                                ? "MATCHED"
                                : "NEW / REVIEW"}
                            </span>
                          </div>

                          <div
                            style={{
                              display:
                                "grid",
                              gridTemplateColumns:
                                "repeat(auto-fit, minmax(140px, 1fr))",
                              gap: "12px",
                            }}
                          >
                            <div
                              className="purchase-form-group"
                            >
                              <label>
                                Quantity
                              </label>

                              <input
                                type="number"
                                value={
                                  item.quantity
                                }
                                readOnly
                              />
                            </div>

                            <div
                              className="purchase-form-group"
                            >
                              <label>
                                Purchase Rate
                              </label>

                              <input
                                type="number"
                                value={
                                  item.purchasePrice
                                }
                                readOnly
                              />

                              <small
                                style={{
                                  display:
                                    "block",
                                  marginTop:
                                    "5px",
                                  opacity:
                                    0.45,
                                }}
                              >
                                From bill
                              </small>
                            </div>

                            <div
                              className="purchase-form-group"
                            >
                              <label>Size / Weight</label>
                              <input
                                type="text"
                                value={
                                  [
                                    item.size && `Size: ${item.size}`,
                                    item.weight && `Weight: ${item.weight}`,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ") || "Not detected"
                                }
                                readOnly
                              />
                            </div>

                            <div
                              className="purchase-form-group"
                            >
                              <label>
                                Selling Price *
                              </label>

                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={
                                  item.sellingPrice
                                }
                                onChange={(
                                  event,
                                ) =>
                                  updateVerificationItem(
                                    item.itemId,
                                    "sellingPrice",
                                    event
                                      .target
                                      .value,
                                  )
                                }
                                style={{
                                  borderColor:
                                    Number(
                                      item.sellingPrice ||
                                        0,
                                    ) >
                                    0
                                      ? "rgba(0,208,132,0.25)"
                                      : "rgba(255,80,80,0.35)",
                                }}
                              />

                              <small
                                style={{
                                  display:
                                    "block",
                                  marginTop:
                                    "5px",
                                  opacity:
                                    0.45,
                                }}
                              >
                                Mama confirms
                              </small>
                            </div>
                          </div>

                          <div
                            className="purchase-form-group"
                            style={{
                              marginTop:
                                "14px",
                            }}
                          >
                            <label>
                              Product Match
                            </label>

                            <select
                              value={
                                item.selectedProductId ||
                                ""
                              }
                              onChange={(
                                event,
                              ) =>
                                handleProductSelection(
                                  item.itemId,
                                  event
                                    .target
                                    .value,
                                )
                              }
                            >
                              <option value="">
                                Auto / New
                                Product
                              </option>

                              {products.map(
                                (
                                  product,
                                ) => (
                                  <option
                                    key={
                                      product.id
                                    }
                                    value={
                                      product.id
                                    }
                                  >
                                    {product.product_code
                                      ? `${product.product_code} — `
                                      : ""}
                                    {
                                      product.name
                                    }
                                  </option>
                                ),
                              )}
                            </select>

                            {item.isIdentified &&
                              item.matchedProduct && (
                                <small
                                  style={{
                                    display:
                                      "block",
                                    marginTop:
                                      "7px",
                                    color:
                                      "#00d084",
                                  }}
                                >
                                  ✓ Existing
                                  product matched:{" "}
                                  {
                                    item
                                      .matchedProduct
                                      .name
                                  }
                                </small>
                              )}
                          </div>
                        </div>
                      ),
                    )
                  )}
                </div>

                {/* =========================================
                    TOTAL
                ========================================== */}

                <div
                  style={{
                    display:
                      "grid",
                    gridTemplateColumns:
                      "repeat(2, minmax(0, 1fr))",
                    gap: "12px",
                  }}
                >
                  <div
                    style={{
                      border:
                        "1px solid rgba(255,255,255,0.08)",
                      borderRadius:
                        "12px",
                      padding:
                        "16px",
                    }}
                  >
                    <span
                      style={{
                        display:
                          "block",
                        fontSize:
                          "10px",
                        opacity:
                          0.5,
                        marginBottom:
                          "6px",
                      }}
                    >
                      TOTAL TAX
                    </span>

                    <strong>
                      {formatCurrency(
                        ocrTax,
                      )}
                    </strong>
                  </div>

                  <div
                    style={{
                      border:
                        "1px solid rgba(0,208,132,0.22)",
                      borderRadius:
                        "12px",
                      padding:
                        "16px",
                      background:
                        "rgba(0,208,132,0.05)",
                    }}
                  >
                    <span
                      style={{
                        display:
                          "block",
                        fontSize:
                          "10px",
                        opacity:
                          0.5,
                        marginBottom:
                          "6px",
                      }}
                    >
                      GRAND TOTAL
                    </span>

                    <strong
                      style={{
                        color:
                          "#00d084",
                        fontSize:
                          "20px",
                      }}
                    >
                      {formatCurrency(
                        ocrGrandTotal,
                      )}
                    </strong>
                  </div>
                </div>
              </div>

              {/* FOOTER */}

              <div
                className="purchase-modal-footer"
                style={{
                  flexShrink: 0,
                  borderTop:
                    "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <button
                  type="button"
                  className="purchase-cancel-button"
                  onClick={
                    closeVerificationModal
                  }
                  disabled={
                    verifying ||
                    converting
                  }
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="purchase-save-button"
                  onClick={
                    handleVerifyDraft
                  }
                  disabled={
                    verifying ||
                    converting ||
                    verificationItems.length ===
                      0
                  }
                >
                  {verifying ? (
                    <>
                      <span className="button-spinner"></span>
                      Verifying Bill...
                    </>
                  ) : converting ? (
                    <>
                      <span className="button-spinner"></span>
                      Saving Purchase...
                    </>
                  ) : (
                    "✓ Verify & Save Purchase"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

      {/* =====================================================
          PURCHASE DETAILS
      ====================================================== */}

      {showDetails && (
        <div className="purchase-modal-overlay">
          <div className="purchase-details-modal">
            <div className="purchase-modal-header">
              <div>
                <span className="purchase-modal-overline">
                  PURCHASE DETAILS
                </span>

                <h2>
                  {
                    showDetails.billNo
                  }
                </h2>

                <p>
                  Review bill totals and item details before adding stock.
                </p>
              </div>

              <div className="purchase-details-header-actions">
                <span
                  className={`purchase-confirmation-status ${
                    showDetails.status === "Received"
                      ? "is-confirmed"
                      : "is-pending"
                  }`}
                >
                  {showDetails.status === "Received"
                    ? "✓ Confirmed"
                    : "Pending confirmation"}
                </span>
                <button
                  type="button"
                  className="purchase-modal-close"
                  onClick={() => setShowDetails(null)}
                  aria-label="Close purchase details"
                  disabled={confirming}
                >
                  ×
                </button>
              </div>
            </div>

            <div className="purchase-details-body">
              <div className="purchase-detail-row">
                <span>
                  Supplier
                </span>

                <strong>
                  {
                    showDetails.supplier
                  }
                </strong>
              </div>

              <div className="purchase-detail-row">
                <span>
                  Purchase Date
                </span>

                <strong>
                  {formatDate(
                    showDetails.date,
                  )}
                </strong>
              </div>

              <div className="purchase-detail-row">
                <span>
                  Number of Items
                </span>

                <strong>
                  {
                    showDetails.items
                  }
                </strong>
              </div>

              <div className="purchase-detail-row">
                <span>
                  Total Quantity
                </span>

                <strong>
                  {Number(
                    showDetails.quantity ||
                      0,
                  ).toLocaleString(
                    "en-IN",
                  )}
                </strong>
              </div>

              {showDetails.status !== "Received" && (
                <div className="purchase-stock-notice">
                  <span aria-hidden="true">📦</span>
                  <div>
                    <strong>Ready to add to inventory?</strong>
                    <p>
                      Confirming adds{" "}
                      {Number(showDetails.quantity || 0).toLocaleString("en-IN")}{" "}
                      item units to stock. This action updates inventory once.
                    </p>
                  </div>
                </div>
              )}

              {showDetails
                .purchaseItems
                ?.length >
                0 && (
                <div
                  style={{
                    marginTop:
                      "20px",
                  }}
                >
                  <h3
                    style={{
                      marginBottom:
                        "12px",
                    }}
                  >
                    Purchase Items
                  </h3>

                  <div
                    style={{
                      overflowX:
                        "auto",
                    }}
                  >
                    <table
                      style={{
                        width:
                          "100%",
                        borderCollapse:
                          "collapse",
                      }}
                    >
                      <thead>
                        <tr>
                          <th
                            style={{
                              textAlign:
                                "left",
                              padding:
                                "10px",
                            }}
                          >
                            Product
                          </th>

                          <th
                            style={{
                              textAlign:
                                "right",
                              padding:
                                "10px",
                            }}
                          >
                            Size / Weight
                          </th>

                          <th
                            style={{
                              textAlign:
                                "right",
                              padding:
                                "10px",
                            }}
                          >
                            Qty
                          </th>

                          <th
                            style={{
                              textAlign:
                                "right",
                              padding:
                                "10px",
                            }}
                          >
                            Purchase Rate
                          </th>

                          <th
                            style={{
                              textAlign:
                                "right",
                              padding:
                                "10px",
                            }}
                          >
                            Total
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {showDetails.purchaseItems.map(
                          (item) => (
                            <tr
                              key={
                                item.id
                              }
                            >
                              <td
                                style={{
                                  padding:
                                    "10px",
                                }}
                              >
                                <strong>
                                  {
                                    item.productName
                                  }
                                </strong>

                                {item.productCode && (
                                  <small
                                    style={{
                                      display:
                                        "block",
                                      opacity:
                                        0.6,
                                    }}
                                  >
                                    {
                                      item.productCode
                                    }
                                  </small>
                                )}
                              </td>

                              <td
                                style={{
                                  textAlign:
                                    "right",
                                  padding:
                                    "10px",
                                }}
                              >
                                {[item.size, item.weight]
                                  .filter(Boolean)
                                  .join(" · ") || "—"}
                              </td>

                              <td
                                style={{
                                  textAlign:
                                    "right",
                                  padding:
                                    "10px",
                                }}
                              >
                                {
                                  item.quantity
                                }
                              </td>

                              <td
                                style={{
                                  textAlign:
                                    "right",
                                  padding:
                                    "10px",
                                }}
                              >
                                {formatCurrency(
                                  item.purchasePrice,
                                )}
                              </td>

                              <td
                                style={{
                                  textAlign:
                                    "right",
                                  padding:
                                    "10px",
                                }}
                              >
                                {formatCurrency(
                                  item.total,
                                )}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="purchase-detail-row">
                <span>
                  Items Subtotal
                </span>

                <strong>
                  {formatCurrency(
                    showDetails.subtotal,
                  )}
                </strong>
              </div>

              <div className="purchase-detail-row">
                <span>Tax</span>

                <strong>
                  {formatCurrency(showDetails.tax)}
                </strong>
              </div>

              <div className="purchase-detail-total">
                <div>
                  <span>Grand Total</span>
                  <small>Tax included</small>
                </div>
                <strong>{formatCurrency(showDetails.total)}</strong>
              </div>
            </div>

            <div className="purchase-modal-footer">
              {showDetails.status !==
                "Received" && (
                <button
                  type="button"
                  className="purchase-confirm-button"
                  onClick={() =>
                    handleConfirmPurchase(
                      showDetails.id,
                    )
                  }
                  disabled={
                    confirming
                  }
                >
                  {confirming
                    ? "Updating stock..."
                    : "✓ Confirm & Add to Stock"}
                </button>
              )}

              <button
                type="button"
                className="purchase-cancel-button"
                onClick={() =>
                  setShowDetails(
                    null,
                  )
                }
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Purchases;
function Navbar({
  activePage,
  darkMode,
  setDarkMode,
  username,
  onLogout,
  onManageAccount,
}) {
  const pageNames = {
    dashboard: "Dashboard",
    products: "Products",
    categories: "Categories",
    stock: "Stock",
    inventory: "Stock",

    suppliers: "Suppliers",
    purchases: "Purchases",
    "purchase-history": "Purchase History",

    customers: "Customers",
    sales: "Sales",
    returns: "Sales Returns",

    reports: "Reports",
    "profit-loss": "Profit & Loss",

    settings: "Settings",
  };

  const currentPage =
    pageNames[activePage] || "Dashboard";

  return (
    <header className="topbar">

      {/* =========================
          LEFT : PAGE INFORMATION
      ========================== */}
      <div className="topbar-page">

        <span className="topbar-eyebrow">
          MAHAVEER TILES AND MARBELS
        </span>

        <h1 className="topbar-title">
          {currentPage}
        </h1>

      </div>


      {/* =========================
          RIGHT : ACTIONS
      ========================== */}
      <div className="topbar-right">

        {/* DARK MODE */}
        <button
          type="button"
          className={`theme-toggle ${
            darkMode ? "dark-active" : ""
          }`}
          onClick={() => setDarkMode(!darkMode)}
          aria-label="Toggle dark mode"
        >

          <span className="theme-icon">
            {darkMode ? "☀" : "☾"}
          </span>

          <span className="theme-text">
            {darkMode ? "Dark" : "Light"}
          </span>

          <span className="theme-switch">
            <span className="theme-switch-dot"></span>
          </span>

        </button>


        {/* ADMIN */}
        <div className="topbar-admin">

          <div className="topbar-admin-avatar">
            A
          </div>

          <div className="topbar-admin-info">

            <strong>
              {username || "Admin"}
            </strong>

            <span>
              Administrator
            </span>

          </div>

        </div>

        <button
          type="button"
          className="admin-account-button"
          onClick={onManageAccount}
        >
          Account
        </button>

        <button
          type="button"
          className="admin-logout-button"
          onClick={onLogout}
        >
          Sign out
        </button>

      </div>

    </header>
  );
}

export default Navbar;
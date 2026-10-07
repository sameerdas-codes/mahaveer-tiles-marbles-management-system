import { useEffect, useState } from "react";

import { apiFetch } from "./api/api";
import Sidebar from "./components/Sidebar";
import Navbar from "./components/Navbar";

import Dashboard from "./pages/Dashboard";
import Products from "./pages/Products";
import Categories from "./pages/Categories";
import Stock from "./pages/Stock";
import Suppliers from "./pages/Suppliers";
import Purchases from "./pages/Purchases";
import PurchaseHistory from "./pages/PurchaseHistory";
import Customers from "./pages/Customers";
import Sales from "./pages/Sales";
import SalesReturns from "./pages/SalesReturns";
import BusinessReport from "./pages/BusinessReport";
import Login from "./pages/Login";
import AccountSettings from "./pages/AccountSettings";

import "./App.css";

function App() {
  const [activePage, setActivePage] = useState("dashboard");
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [salesDataRevision, setSalesDataRevision] = useState(0);
  const [visitedPages, setVisitedPages] = useState(
    () => new Set(["dashboard"]),
  );
  const [admin, setAdmin] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [showAccountSettings, setShowAccountSettings] = useState(false);

  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem("darkMode") === "true";
  });

  useEffect(() => {
    document.body.classList.toggle("dark-mode", darkMode);
    localStorage.setItem("darkMode", String(darkMode));
  }, [darkMode]);

  useEffect(() => {
    let active = true;

    const restoreSession = async () => {
      try {
        await apiFetch("/api/auth/csrf/");
        const response = await apiFetch("/api/auth/me/");
        if (!active) return;

        if (response.ok) {
          const data = await response.json();
          setAdmin(data.username);
        } else if (response.status === 401) {
          setAdmin(null);
        } else {
          throw new Error("Authentication status could not be checked.");
        }
      } catch (error) {
        if (active) {
          setAuthError(error.message || "Could not connect to the server.");
        }
      } finally {
        if (active) setAuthLoading(false);
      }
    };

    restoreSession();
    return () => {
      active = false;
    };
  }, []);

  const handleLogout = async () => {
    try {
      const response = await apiFetch("/api/auth/logout/", {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Could not sign out.");
      }
      setAdmin(null);
    } catch (error) {
      console.error("Admin logout error:", error);
      setAuthError(error.message || "Could not sign out.");
    }
  };

  const navigateToPage = (page, customerId = null) => {
    setSelectedCustomerId(page === "customers" ? customerId : null);
    setVisitedPages((current) => {
      if (current.has(page)) return current;
      return new Set([...current, page]);
    });
    setActivePage(page);
  };

  const openCustomer = (customerId) => {
    navigateToPage("customers", customerId);
  };

  const handleSalesChanged = () => {
    setSalesDataRevision((revision) => revision + 1);
  };

  if (authLoading) {
    return <div className="admin-auth-loading">Checking secure session...</div>;
  }

  if (authError && !admin) {
    return (
      <div className="admin-auth-loading admin-auth-error" role="alert">
        {authError}
      </div>
    );
  }

  if (!admin) {
    return (
      <Login
        onLogin={(username) => {
          setAuthError("");
          setAdmin(username);
        }}
      />
    );
  }

  const pageComponents = {
    dashboard: (
      <Dashboard
        onNavigate={navigateToPage}
        onCustomerSelect={openCustomer}
        dataRevision={salesDataRevision}
      />
    ),
    products: <Products />,
    categories: <Categories />,
    stock: <Stock dataRevision={salesDataRevision} />,
    suppliers: <Suppliers />,
    purchases: <Purchases onNavigate={navigateToPage} />,
    "purchase-history": <PurchaseHistory onNavigate={navigateToPage} />,
    customers: (
      <Customers
        selectedCustomerId={selectedCustomerId}
        onClearCustomerSelection={() => setSelectedCustomerId(null)}
        dataRevision={salesDataRevision}
      />
    ),
    sales: <Sales onSalesChanged={handleSalesChanged} />,
    returns: <SalesReturns dataRevision={salesDataRevision} />,
    reports: <BusinessReport dataRevision={salesDataRevision} />,
    "profit-loss": (
      <BusinessReport profitLoss dataRevision={salesDataRevision} />
    ),
  };

  return (
    <div className={`app ${darkMode ? "dark-mode" : ""}`}>
      {/* SIDEBAR */}
      <Sidebar activePage={activePage} setActivePage={navigateToPage} />

      {/* MAIN CONTENT */}
      <div className="main-content">
        {/* NAVBAR */}
        <Navbar
          activePage={activePage}
          darkMode={darkMode}
          setDarkMode={() => setDarkMode((enabled) => !enabled)}
          username={admin}
          onLogout={handleLogout}
          onManageAccount={() => setShowAccountSettings(true)}
        />

        {/* PAGE CONTENT */}
        <main className="page-content">
          {Object.entries(pageComponents).map(([page, component]) =>
            visitedPages.has(page) ? (
              <div
                className="page-content-view"
                hidden={activePage !== page}
                key={page}
              >
                {component}
              </div>
            ) : null,
          )}
        </main>
        {authError && (
          <p className="admin-session-error" role="alert">
            {authError}
          </p>
        )}
        {showAccountSettings && (
          <AccountSettings
            onClose={() => setShowAccountSettings(false)}
            onUsernameUpdated={setAdmin}
          />
        )}
      </div>
    </div>
  );
}

export default App;

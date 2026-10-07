function Sidebar({ activePage, setActivePage }) {
  const menuGroups = [
    {
      title: "OVERVIEW",
      items: [
        {
          id: "dashboard",
          label: "Dashboard",
          icon: "▦",
        },
      ],
    },

    {
      title: "INVENTORY",
      items: [
        {
          id: "products",
          label: "Products",
          icon: "▣",
        },
        {
          id: "categories",
          label: "Categories",
          icon: "◫",
        },
        {
          id: "stock",
          label: "Stock",
          icon: "▤",
        },
      ],
    },

    {
      title: "PURCHASE",
      items: [
        {
          id: "suppliers",
          label: "Suppliers",
          icon: "♜",
        },
        {
          id: "purchases",
          label: "Purchases",
          icon: "↓",
        },
      ],
    },

    {
      title: "SALES",
      items: [
        {
          id: "customers",
          label: "Customers",
          icon: "♙",
        },
        {
          id: "sales",
          label: "Sales",
          icon: "↗",
        },
        {
          id: "returns",
          label: "Sales Returns",
          icon: "↩",
        },
      ],
    },

    {
      title: "ANALYTICS",
      items: [
        {
          id: "reports",
          label: "Reports",
          icon: "▥",
        },
        {
          id: "profit-loss",
          label: "Profit & Loss",
          icon: "⌁",
        },
      ],
    },
  ];

  const today = new Date();

  const day = today.toLocaleDateString("en-IN", {
    day: "2-digit",
  });

  const monthYear = today.toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  const weekday = today.toLocaleDateString("en-IN", {
    weekday: "long",
  });

  return (
    <aside className="sidebar">

      {/* BRAND */}
      <div className="sidebar-brand">
        <div className="brand-mark">
          M
        </div>

        <div className="brand-text">
          <div className="brand-name">
            MAHAVEER
          </div>

          <div className="brand-subtitle">
            TILES & MARBELS
          </div>
        </div>
      </div>

      {/* NAVIGATION */}
      <nav className="sidebar-navigation">
        {menuGroups.map((group) => (
          <div
            className="sidebar-group"
            key={group.title}
          >
            <div className="sidebar-group-title">
              {group.title}
            </div>

            <div className="sidebar-group-items">
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`sidebar-item ${
                    activePage === item.id ||
                    (item.id === "purchases" &&
                      activePage === "purchase-history")
                      ? "active"
                      : ""
                  }`}
                  onClick={() =>
                    setActivePage(item.id)
                  }
                >
                  <span className="sidebar-item-icon">
                    {item.icon}
                  </span>

                  <span className="sidebar-item-label">
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* FOOTER */}
      <div className="sidebar-footer">
        <div className="sidebar-date">

          <div className="date-icon">
            📅
          </div>

          <div className="date-info">
            <span className="date-day">
              {day}
            </span>

            <div>
              <strong>
                {monthYear}
              </strong>

              <small>
                {weekday}
              </small>
            </div>
          </div>

        </div>
      </div>

    </aside>
  );
}

export default Sidebar;
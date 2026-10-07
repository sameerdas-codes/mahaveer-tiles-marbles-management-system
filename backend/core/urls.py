from django.urls import path, include

from rest_framework.routers import DefaultRouter

from .auth_views import (
    account_profile,
    complete_recovery,
    csrf_token,
    current_user,
    login_view,
    logout_view,
    recovery_status,
    send_phone_otp,
    send_recovery_otp,
    update_password,
    update_username,
    verify_phone_otp,
)
from .views import (
    dashboard_summary,
    business_report,
    CategoryViewSet,
    ProductViewSet,
    SupplierViewSet,
    CustomerViewSet,

    PurchaseViewSet,
    PurchaseItemViewSet,
    PurchaseDraftViewSet,
    PurchaseDraftItemViewSet,

    SaleViewSet,
    SaleItemViewSet,

    SaleReturnViewSet,
    SaleReturnItemViewSet,
)


router = DefaultRouter()

# ============================================================
# CATEGORY
# ============================================================

router.register(
    "categories",
    CategoryViewSet,
    basename="category"
)


# ============================================================
# PRODUCT
# ============================================================

router.register(
    "products",
    ProductViewSet,
    basename="product"
)


# ============================================================
# SUPPLIER
# ============================================================

router.register(
    "suppliers",
    SupplierViewSet,
    basename="supplier"
)


# ============================================================
# CUSTOMER
# ============================================================

router.register(
    "customers",
    CustomerViewSet,
    basename="customer"
)


# ============================================================
# PURCHASE
# ============================================================

router.register(
    "purchases",
    PurchaseViewSet,
    basename="purchase"
)


router.register(
    "purchase-items",
    PurchaseItemViewSet,
    basename="purchase-item"
)


# ============================================================
# PURCHASE DRAFT
# ============================================================

router.register(
    "purchase-drafts",
    PurchaseDraftViewSet,
    basename="purchase-draft"
)


router.register(
    "purchase-draft-items",
    PurchaseDraftItemViewSet,
    basename="purchase-draft-item"
)


# ============================================================
# SALE
# ============================================================

router.register(
    "sales",
    SaleViewSet,
    basename="sale"
)


router.register(
    "sale-items",
    SaleItemViewSet,
    basename="sale-item"
)


# ============================================================
# SALES RETURN
# ============================================================

router.register(
    "sale-returns",
    SaleReturnViewSet,
    basename="sale-return"
)


router.register(
    "sale-return-items",
    SaleReturnItemViewSet,
    basename="sale-return-item"
)


# ============================================================
# URL PATTERNS
# ============================================================

urlpatterns = [
    path("auth/csrf/", csrf_token, name="auth-csrf"),
    path("auth/login/", login_view, name="auth-login"),
    path("auth/me/", current_user, name="auth-current-user"),
    path("auth/logout/", logout_view, name="auth-logout"),
    path("auth/recovery/status/", recovery_status, name="auth-recovery-status"),
    path("auth/account/", account_profile, name="auth-account"),
    path("auth/account/username/", update_username, name="auth-update-username"),
    path("auth/account/password/", update_password, name="auth-update-password"),
    path("auth/account/phone/send-otp/", send_phone_otp, name="auth-phone-send-otp"),
    path("auth/account/phone/verify-otp/", verify_phone_otp, name="auth-phone-verify-otp"),
    path("auth/recovery/send-otp/", send_recovery_otp, name="auth-recovery-send-otp"),
    path("auth/recovery/complete/", complete_recovery, name="auth-recovery-complete"),
    path(
        "dashboard/",
        dashboard_summary,
        name="dashboard-summary",
    ),
    path(
        "reports/",
        business_report,
        name="business-report",
    ),
    path(
        "",
        include(router.urls)
    ),
]
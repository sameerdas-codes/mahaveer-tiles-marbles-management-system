from decimal import Decimal, InvalidOperation
from datetime import datetime, timedelta
from collections import defaultdict
from xml.sax.saxutils import escape

from rest_framework import viewsets, serializers
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.decorators import api_view
from rest_framework.parsers import (
    MultiPartParser,
    FormParser,
    JSONParser,
)

from django.db import transaction
from django.db.models import F, Sum
from django.db.models.functions import TruncDate
from django.http import HttpResponse
from django.utils import timezone

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import (
    getSampleStyleSheet,
    ParagraphStyle,
)
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.lib.units import mm

from .models import (
    Category,
    Product,
    Supplier,
    Purchase,
    PurchaseItem,
    PurchaseDraft,
    PurchaseDraftItem,
    Customer,
    Sale,
    SaleItem,
    SaleReturn,
    SaleReturnItem,
)

from .serializers import (
    CategorySerializer,
    ProductSerializer,
    SupplierSerializer,
    CustomerSerializer,
    PurchaseSerializer,
    PurchaseItemSerializer,
    PurchaseDraftSerializer,
    PurchaseDraftItemSerializer,
    SaleSerializer,
    SaleItemSerializer,
    SaleReturnSerializer,
    SaleReturnItemSerializer,
)


# ============================================================
# HELPERS
# ============================================================

def normalize_text(value):
    """
    Normalize text for business matching.

    Example:
        "  Asian   Adhesive "
        -> "asian adhesive"
    """
    return " ".join(
        str(value or "").strip().lower().split()
    )


def amount_in_words(amount):
    amount = Decimal(amount).quantize(Decimal("0.01"))
    whole_rupees = int(amount)
    paise = int((amount - whole_rupees) * 100)
    ones = (
        "zero", "one", "two", "three", "four", "five", "six",
        "seven", "eight", "nine", "ten", "eleven", "twelve",
        "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
        "eighteen", "nineteen",
    )
    tens = (
        "", "", "twenty", "thirty", "forty", "fifty",
        "sixty", "seventy", "eighty", "ninety",
    )

    def under_thousand(number):
        parts = []
        if number >= 1_000:
            parts.extend([
                under_thousand(number // 1_000),
                "thousand",
            ])
            number %= 1_000
        if number >= 100:
            parts.extend([ones[number // 100], "hundred"])
            number %= 100
        if number >= 20:
            parts.append(tens[number // 10])
            number %= 10
        if number:
            parts.append(ones[number])
        return " ".join(parts)

    groups = (
        (10_000_000, "crore"),
        (100_000, "lakh"),
        (1_000, "thousand"),
        (1, ""),
    )
    words = []
    remainder = whole_rupees
    for divisor, label in groups:
        group = remainder // divisor
        if group:
            words.append(under_thousand(group))
            if label:
                words.append(label)
            remainder %= divisor

    rupees_text = " ".join(words) or "zero"
    result = f"{rupees_text} rupees"
    if paise:
        result += f" and {under_thousand(paise)} paise"
    return f"{result} only"


def find_supplier_by_name(supplier_name):
    """
    Find supplier using normalized exact name.
    """
    normalized_name = normalize_text(supplier_name)

    if not normalized_name:
        return None

    suppliers = Supplier.objects.all()

    for supplier in suppliers:
        if normalize_text(supplier.name) == normalized_name:
            return supplier

    return None


def find_product_by_code(product_code):
    """
    Exact Product Code match.

    If code exists on bill:
    ONLY code matching is performed.
    """
    product_code = str(product_code or "").strip()

    if not product_code:
        return None

    return (
        Product.objects
        .filter(product_code__iexact=product_code)
        .first()
    )


def find_product_by_name(product_name):
    """
    Exact normalized Product Name match.

    Used ONLY when product code is missing.
    """
    normalized_name = normalize_text(product_name)

    if not normalized_name:
        return None

    products = Product.objects.all()

    for product in products:
        if normalize_text(product.name) == normalized_name:
            return product

    return None


def parse_decimal(value, default=None):
    """
    Safely convert value to Decimal.
    """
    if value is None:
        return default

    if value == "":
        return default

    try:
        return Decimal(str(value))
    except (
        InvalidOperation,
        TypeError,
        ValueError,
    ):
        return default


def get_request_items(request):
    """
    Read items array from JSON or stringified JSON.
    """
    request_items = request.data.get("items")

    if isinstance(request_items, str):
        import json

        try:
            request_items = json.loads(request_items)
        except json.JSONDecodeError:
            return None

    if request_items is None:
        return []

    if not isinstance(request_items, list):
        return None

    return request_items


@api_view(["GET"])
def dashboard_summary(request):
    try:
        days = int(request.query_params.get("days", "7"))
    except (TypeError, ValueError):
        return Response(
            {"detail": "days must be one of 7, 30, or 90."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if days not in {7, 30, 90}:
        return Response(
            {"detail": "days must be one of 7, 30, or 90."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    today = timezone.localdate()
    chart_start = today - timedelta(days=days - 1)
    month_start = today.replace(day=1)
    previous_month_end = month_start - timedelta(days=1)
    previous_month_start = previous_month_end.replace(day=1)

    sales = Sale.objects.all()
    period_sales = sales.filter(
        sale_date__date__gte=chart_start,
        sale_date__date__lte=today,
    )
    month_sales = sales.filter(
        sale_date__date__gte=month_start,
        sale_date__date__lte=today,
    )
    previous_month_sales = sales.filter(
        sale_date__date__gte=previous_month_start,
        sale_date__date__lte=previous_month_end,
    )

    purchases = Purchase.objects.all()
    month_purchases = purchases.filter(
        created_at__date__gte=month_start,
        created_at__date__lte=today,
    )
    previous_month_purchases = purchases.filter(
        created_at__date__gte=previous_month_start,
        created_at__date__lte=previous_month_end,
    )

    def total_for(queryset):
        return queryset.aggregate(total=Sum("grand_total"))["total"] or Decimal("0.00")

    sales_by_day = {
        row["day"].isoformat(): row["total"]
        for row in (
            period_sales
            .annotate(day=TruncDate("sale_date"))
            .values("day")
            .annotate(total=Sum("grand_total"))
            .order_by("day")
        )
    }

    sales_chart = []
    for day_offset in range(days):
        chart_day = chart_start + timedelta(days=day_offset)
        sales_chart.append({
            "date": chart_day.isoformat(),
            "total": str(sales_by_day.get(chart_day.isoformat(), Decimal("0.00"))),
        })

    category_sales = (
        SaleItem.objects
        .filter(
            sale__sale_date__date__gte=chart_start,
            sale__sale_date__date__lte=today,
        )
        .values("product__category")
        .annotate(total=Sum("total"))
        .order_by("-total")
    )

    recent_sales = (
        sales
        .select_related("customer")
        .order_by("-sale_date", "-id")[:5]
    )

    recent_products = Product.objects.order_by("-created_at", "-id")[:5]
    low_stock_products = (
        Product.objects
        .filter(stock__gt=0, stock__lte=F("low_stock_limit"))
        .order_by("stock", "name")[:5]
    )

    def product_data(product):
        return {
            "id": product.id,
            "name": product.name,
            "product_code": product.product_code or "",
            "category": product.category or "Uncategorized",
            "stock": str(product.stock),
            "low_stock_limit": str(product.low_stock_limit),
        }

    return Response({
        "today": today.isoformat(),
        "days": days,
        "summary": {
            "sales_this_month": str(total_for(month_sales)),
            "sales_count_this_month": month_sales.count(),
            "sales_previous_month": str(total_for(previous_month_sales)),
            "purchases_this_month": str(total_for(month_purchases)),
            "purchases_count_this_month": month_purchases.count(),
            "purchases_previous_month": str(total_for(previous_month_purchases)),
            "product_count": Product.objects.count(),
            "customer_count": Customer.objects.count(),
        },
        "sales_chart": sales_chart,
        "sales_by_category": [
            {
                "category": row["product__category"] or "Uncategorized",
                "total": str(row["total"] or Decimal("0.00")),
            }
            for row in category_sales
        ],
        "recent_products": [
            product_data(product)
            for product in recent_products
        ],
        "low_stock_products": [
            product_data(product)
            for product in low_stock_products
        ],
        "recent_sales": [
            {
                "id": sale.id,
                "invoice_number": sale.invoice_number,
                "customer_id": sale.customer_id,
                "customer_name": (
                    sale.customer.name
                    if sale.customer
                    else "Walk-in Customer"
                ),
                "sale_date": sale.sale_date.isoformat(),
                "grand_total": str(sale.grand_total),
                "is_confirmed": sale.is_confirmed,
            }
            for sale in recent_sales
        ],
    })


@api_view(["GET"])
def business_report(request):
    today = timezone.localdate()
    default_start = today.replace(day=1)
    start_text = request.query_params.get("from", default_start.isoformat())
    end_text = request.query_params.get("to", today.isoformat())

    try:
        start_date = datetime.strptime(start_text, "%Y-%m-%d").date()
        end_date = datetime.strptime(end_text, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return Response(
            {"detail": "from and to must be valid YYYY-MM-DD dates."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if start_date > end_date:
        return Response(
            {"detail": "The start date cannot be after the end date."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if (end_date - start_date).days > 366:
        return Response(
            {"detail": "Report date range cannot exceed 367 days."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    sales = list(
        Sale.objects
        .filter(
            is_confirmed=True,
            sale_date__date__gte=start_date,
            sale_date__date__lte=end_date,
        )
        .select_related("customer")
        .prefetch_related("items__product")
        .order_by("-sale_date", "-id")
    )
    sale_lines = {}
    for sale in sales:
        sale_lines[sale.id] = list(sale.items.all())

    period_returns = list(
        SaleReturn.objects
        .filter(
            return_date__date__gte=start_date,
            return_date__date__lte=end_date,
        )
        .select_related("sale")
        .prefetch_related("items__product", "sale__items")
    )

    def money(value):
        return value.quantize(Decimal("0.01"))

    gross_revenue = sum(
        (sale.grand_total for sale in sales),
        Decimal("0.00"),
    )
    sold_cost = sum(
        (
            item.quantity * item.purchase_cost
            for items in sale_lines.values()
            for item in items
        ),
        Decimal("0.00"),
    )

    return_value = Decimal("0.00")
    return_cost = Decimal("0.00")
    return_value_by_day = defaultdict(lambda: Decimal("0.00"))
    for sale_return in period_returns:
        sale = sale_return.sale
        lines = sale_lines.get(sale.id)
        if lines is None:
            lines = list(sale.items.all())
            sale_lines[sale.id] = lines

        by_product = defaultdict(list)
        for sale_item in lines:
            by_product[sale_item.product_id].append(sale_item)

        for returned_item in sale_return.items.all():
            source_lines = by_product.get(returned_item.product_id, [])
            sold_units = sum(
                (line.quantity for line in source_lines),
                Decimal("0.00"),
            )
            if sold_units <= 0:
                continue

            gross_unit_price = (
                sum(
                    (line.total for line in source_lines),
                    Decimal("0.00"),
                )
                / sold_units
            )
            unit_cost = (
                sum(
                    (
                        line.quantity * line.purchase_cost
                        for line in source_lines
                    ),
                    Decimal("0.00"),
                )
                / sold_units
            )
            discount_factor = (
                (sale.subtotal - sale.discount) / sale.subtotal
                if sale.subtotal > 0
                else Decimal("1.00")
            )
            line_return_value = (
                returned_item.quantity * gross_unit_price * discount_factor
            )
            line_return_cost = returned_item.quantity * unit_cost
            return_value += line_return_value
            return_cost += line_return_cost
            return_value_by_day[
                sale_return.return_date.date().isoformat()
            ] += line_return_value

    net_revenue = gross_revenue - return_value
    cost_of_goods_sold = sold_cost - return_cost
    gross_profit = net_revenue - cost_of_goods_sold

    sales_by_day = defaultdict(lambda: Decimal("0.00"))
    for sale in sales:
        sales_by_day[sale.sale_date.date().isoformat()] += sale.grand_total
    daily = []
    day = start_date
    while day <= end_date:
        date_key = day.isoformat()
        daily.append({
            "date": date_key,
            "sales": str(money(sales_by_day[date_key])),
            "returns": str(money(return_value_by_day[date_key])),
            "net": str(
                money(sales_by_day[date_key] - return_value_by_day[date_key])
            ),
        })
        day += timedelta(days=1)

    product_totals = defaultdict(
        lambda: {
            "product_id": None,
            "product_name": "",
            "quantity": Decimal("0.00"),
            "revenue": Decimal("0.00"),
        }
    )
    payment_totals = defaultdict(lambda: Decimal("0.00"))
    for sale in sales:
        payment_totals[sale.payment_method] += sale.grand_total
        for item in sale_lines[sale.id]:
            data = product_totals[item.product_id]
            data["product_id"] = item.product_id
            data["product_name"] = item.product.name
            data["quantity"] += item.quantity
            data["revenue"] += item.total

    purchases = Purchase.objects.filter(
        is_confirmed=True,
        created_at__date__gte=start_date,
        created_at__date__lte=end_date,
    )
    purchase_total = (
        purchases.aggregate(total=Sum("grand_total"))["total"]
        or Decimal("0.00")
    )
    net_margin = (
        (gross_profit / net_revenue * Decimal("100"))
        if net_revenue > 0
        else Decimal("0.00")
    )

    return Response({
        "from": start_date.isoformat(),
        "to": end_date.isoformat(),
        "summary": {
            "sales_count": len(sales),
            "sales_revenue": str(money(gross_revenue)),
            "returns_count": len(period_returns),
            "return_value": str(money(return_value)),
            "net_revenue": str(money(net_revenue)),
            "cost_of_goods_sold": str(money(cost_of_goods_sold)),
            "gross_profit": str(money(gross_profit)),
            "gross_margin_percent": str(money(net_margin)),
            "purchase_count": purchases.count(),
            "purchase_total": str(money(purchase_total)),
        },
        "daily": daily,
        "top_products": [
            {
                **data,
                "quantity": str(money(data["quantity"])),
                "revenue": str(money(data["revenue"])),
            }
            for data in sorted(
                product_totals.values(),
                key=lambda item: item["revenue"],
                reverse=True,
            )[:10]
        ],
        "payment_methods": [
            {"name": name, "total": str(money(total))}
            for name, total in sorted(
                payment_totals.items(),
                key=lambda item: item[1],
                reverse=True,
            )
        ],
        "profit_note": (
            "Gross profit uses the product purchase cost saved when each "
            "sale is created, less returns. Operating expenses are not "
            "recorded in this system, so this is not net profit."
        ),
        "cost_basis_complete": not SaleItem.objects.filter(
            sale__is_confirmed=True,
            sale__sale_date__date__gte=start_date,
            sale__sale_date__date__lte=end_date,
            purchase_cost=0,
        ).exists(),
    })


# ============================================================
# PRODUCT
# ============================================================

class CategoryViewSet(viewsets.ModelViewSet):

    queryset = Category.objects.all().order_by("-id")
    serializer_class = CategorySerializer

    def list(self, request, *args, **kwargs):
        categories = list(self.get_queryset())
        names = [category.name for category in categories]

        purchase_totals = {
            row["product__category"]: row
            for row in (
                PurchaseItem.objects
                .filter(product__category__in=names)
                .values("product__category")
                .annotate(
                    quantity=Sum("quantity"),
                    total=Sum("total"),
                )
            )
        }
        sales_totals = {
            row["product__category"]: row
            for row in (
                SaleItem.objects
                .filter(product__category__in=names)
                .values("product__category")
                .annotate(
                    quantity=Sum("quantity"),
                    total=Sum("total"),
                )
            )
        }

        data = []
        for category in categories:
            purchase = purchase_totals.get(category.name, {})
            sales = sales_totals.get(category.name, {})
            data.append({
                **CategorySerializer(category).data,
                "purchase_qty": str(purchase.get("quantity") or Decimal("0")),
                "sales_qty": str(sales.get("quantity") or Decimal("0")),
                "purchase_price": str(purchase.get("total") or Decimal("0.00")),
                "sales_price": str(sales.get("total") or Decimal("0.00")),
            })
        return Response(data)

    @transaction.atomic
    def perform_update(self, serializer):
        previous_name = serializer.instance.name
        category = serializer.save()
        if previous_name != category.name:
            Product.objects.filter(category=previous_name).update(
                category=category.name
            )

    def destroy(self, request, *args, **kwargs):
        category = self.get_object()
        if Product.objects.filter(category=category.name).exists():
            return Response(
                {
                    "detail": (
                        "This category is assigned to products. "
                        "Reassign those products before deleting it."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)


class ProductViewSet(viewsets.ModelViewSet):

    queryset = (
        Product.objects
        .all()
        .order_by("-id")
    )

    serializer_class = ProductSerializer

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        product = self.get_object()

        if (
            product.purchase_items.exists()
            or product.sale_items.exists()
            or product.sale_return_items.exists()
        ):
            return Response({
                "detail": (
                    "This product is linked to purchase or sales "
                    "history and cannot be deleted. The history "
                    "has been kept unchanged."
                ),
            }, status=status.HTTP_409_CONFLICT)

        PurchaseDraftItem.objects.filter(
            matched_product=product
        ).delete()

        self.perform_destroy(product)

        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(
        detail=False,
        methods=["get"],
        url_path="match-code",
    )
    def match_code(self, request):

        code = request.query_params.get("code")

        if not code:
            return Response({
                "matched": False,
                "message": "Product code is required.",
            })

        code = code.strip()

        product = (
            Product.objects
            .filter(product_code__iexact=code)
            .first()
        )

        if product:
            return Response({
                "matched": True,
                "product": ProductSerializer(product).data,
            })

        return Response({
            "matched": False,
            "product": None,
            "message": "No product found with this product code.",
        })


# ============================================================
# SUPPLIER
# ============================================================

class SupplierViewSet(viewsets.ModelViewSet):

    queryset = (
        Supplier.objects
        .annotate(total_purchases=Sum("purchases__grand_total"))
        .all()
        .order_by("-id")
    )

    serializer_class = SupplierSerializer

    def destroy(self, request, *args, **kwargs):
        supplier = self.get_object()
        if supplier.purchases.exists() or supplier.purchase_drafts.exists():
            return Response(
                {
                    "detail": (
                        "This supplier is linked to purchase history "
                        "and cannot be deleted."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)


# ============================================================
# CUSTOMER
# ============================================================

class CustomerViewSet(viewsets.ModelViewSet):

    queryset = (
        Customer.objects
        .all()
        .order_by("-id")
    )

    serializer_class = CustomerSerializer


# ============================================================
# PURCHASE DRAFT
# ============================================================

class PurchaseDraftViewSet(viewsets.ModelViewSet):

    # IMPORTANT:
    # JSONParser added so verify/convert JSON requests work.
    parser_classes = [
        MultiPartParser,
        FormParser,
        JSONParser,
    ]

    queryset = (
        PurchaseDraft.objects
        .select_related("supplier")
        .prefetch_related("items__matched_product")
        .all()
        .order_by("-id")
    )

    serializer_class = PurchaseDraftSerializer

    # ========================================================
    # UPLOAD BILL + OCR
    #
    # POST:
    # /api/purchase-drafts/upload/
    # ========================================================

    @action(
        detail=False,
        methods=["post"],
        url_path="upload",
    )
    @transaction.atomic
    def upload_bill(self, request):

        from .services.ocr_service import extract_purchase_bill

        bill_image = request.FILES.get("bill_image")

        if not bill_image:
            return Response({
                "message": "Bill image/file is required.",
            }, status=400)

        file_name = bill_image.name.lower()

        allowed_extensions = (
            ".jpg",
            ".jpeg",
            ".png",
            ".pdf",
        )

        if not file_name.endswith(allowed_extensions):
            return Response({
                "message": (
                    "Unsupported bill format. "
                    "Only JPG, JPEG, PNG and PDF are supported."
                ),
            }, status=400)

        supplier = None

        supplier_id = request.data.get("supplier_id")

        if supplier_id:
            try:
                supplier = Supplier.objects.get(id=supplier_id)
            except Supplier.DoesNotExist:
                return Response({
                    "message": "Supplier not found.",
                }, status=404)

        draft = PurchaseDraft.objects.create(
            supplier=supplier,
            bill_image=bill_image,
            is_verified=False,
        )

        try:
            extracted_data = extract_purchase_bill(
                draft.bill_image.path
            )
        except Exception as error:
            draft.delete()

            return Response({
                "message": "Bill OCR failed.",
                "error": str(error),
            }, status=500)

        original_supplier_name = (
            extracted_data.get("supplier_name") or ""
        ).strip()

        draft.original_supplier_name = original_supplier_name
        draft.supplier_phone = (
            extracted_data.get("supplier_phone") or ""
        ).strip()
        draft.supplier_gstin = (
            extracted_data.get("supplier_gstin") or ""
        ).strip()

        draft.bill_number = (
            extracted_data.get("bill_number") or ""
        ).strip()

        bill_date = extracted_data.get("bill_date")

        if bill_date:
            try:
                draft.bill_date = datetime.strptime(
                    bill_date,
                    "%Y-%m-%d",
                ).date()
            except (
                ValueError,
                TypeError,
            ):
                draft.bill_date = None

        draft.save()

        created_item_ids = []

        extracted_items = extracted_data.get(
            "items",
            [],
        )

        if not isinstance(extracted_items, list):
            extracted_items = []

        for item in extracted_items:

            product_code = (
                item.get("product_code") or ""
            ).strip()

            product_name = (
                item.get("product_name") or ""
            ).strip()

            quantity = item.get("quantity")
            purchase_price = item.get("purchase_price")

            if (
                not product_code
                and not product_name
                and quantity is None
                and purchase_price is None
            ):
                continue

            if quantity is None:
                quantity = 0

            if purchase_price is None:
                purchase_price = 0

            quantity = parse_decimal(
                quantity,
                default=0,
            )

            purchase_price = parse_decimal(
                purchase_price,
                default=0,
            )

            draft_item = PurchaseDraftItem.objects.create(
                draft=draft,
                original_product_code=product_code,
                original_product_name=product_name,
                size=(item.get("size") or "").strip(),
                weight=(item.get("weight") or "").strip(),
                quantity=quantity,
                purchase_price=purchase_price,
                selling_price=0,
                matched_product=None,
                is_identified=False,
            )

            created_item_ids.append(draft_item.id)

        return Response({
            "message": (
                "Bill uploaded and OCR extraction "
                "completed successfully."
            ),
            "draft_id": draft.id,
            "original_supplier_name": draft.original_supplier_name,
            "supplier_phone": draft.supplier_phone,
            "supplier_gstin": draft.supplier_gstin,
            "supplier": (
                {
                    "id": draft.supplier.id,
                    "name": draft.supplier.name,
                }
                if draft.supplier
                else None
            ),
            "supplier_matched": draft.supplier is not None,
            "bill_number": draft.bill_number,
            "bill_date": draft.bill_date,
            "tax": (
                extracted_data.get("tax")
                if extracted_data.get("tax") is not None
                else 0
            ),
            "grand_total": (
                extracted_data.get("grand_total")
                if extracted_data.get("grand_total") is not None
                else 0
            ),
            "items_created": len(created_item_ids),
            "item_ids": created_item_ids,
            "is_verified": draft.is_verified,
        }, status=201)

    # ========================================================
    # VERIFY DRAFT
    #
    # POST:
    # /api/purchase-drafts/<id>/verify/
    #
    # Body:
    # {
    #   "supplier_id": 1,
    #   "items": [
    #       {
    #           "id": 10,
    #           "selling_price": 450
    #       }
    #   ]
    # }
    # ========================================================

    @action(
        detail=True,
        methods=["post"],
        url_path="verify",
    )
    @transaction.atomic
    def verify_draft(self, request, pk=None):

        try:
            draft = (
                PurchaseDraft.objects
                .select_for_update(of=("self",))
                .select_related("supplier")
                .get(pk=pk)
            )
        except PurchaseDraft.DoesNotExist:
            return Response({
                "message": "Purchase draft not found.",
            }, status=404)

        if draft.is_verified:
            return Response({
                "message": "Purchase draft is already verified.",
                "draft_id": draft.id,
                "is_verified": True,
                "supplier": (
                    {
                        "id": draft.supplier.id,
                        "name": draft.supplier.name,
                    }
                    if draft.supplier
                    else None
                ),
            })

        items = list(draft.items.all())

        if not items:
            return Response({
                "message": "Purchase draft has no items.",
            }, status=400)

        # ====================================================
        # STEP 1
        # SUPPLIER MATCH / CREATE
        # ====================================================

        supplier = draft.supplier

        supplier_id = request.data.get("supplier_id")

        if supplier_id:
            try:
                supplier = (
                    Supplier.objects
                    .select_for_update()
                    .get(id=supplier_id)
                )
            except Supplier.DoesNotExist:
                return Response({
                    "message": "Selected supplier not found.",
                }, status=404)

        if not supplier:

            original_supplier_name = (
                draft.original_supplier_name or ""
            ).strip()

            if not original_supplier_name:
                return Response({
                    "message": (
                        "Supplier name could not be read from "
                        "the bill. Please select a supplier."
                    ),
                }, status=400)

            supplier = find_supplier_by_name(
                original_supplier_name
            )

            if not supplier:
                supplier = Supplier.objects.create(
                    name=original_supplier_name
                )

        supplier_fields_to_update = []
        if draft.supplier_phone and not supplier.phone:
            supplier.phone = draft.supplier_phone
            supplier_fields_to_update.append("phone")
        if draft.supplier_gstin and not supplier.gstin:
            supplier.gstin = draft.supplier_gstin
            supplier_fields_to_update.append("gstin")
        if supplier_fields_to_update:
            supplier.save(update_fields=supplier_fields_to_update)

        # ====================================================
        # STEP 2
        # SELLING PRICES
        # ====================================================

        request_items = get_request_items(request)

        if request_items is None:
            return Response({
                "message": "Items must be an array.",
            }, status=400)

        submitted_prices = {}

        for item_data in request_items:

            if not isinstance(item_data, dict):
                continue

            item_id = item_data.get("id")

            if item_id is None:
                continue

            submitted_prices[str(item_id)] = (
                item_data.get("selling_price")
            )

        # ====================================================
        # STEP 3
        # PRE-VALIDATE ALL ITEMS
        # ====================================================

        prepared_items = []

        for draft_item in items:

            product_code = (
                draft_item.original_product_code or ""
            ).strip()

            product_name = (
                draft_item.original_product_name or ""
            ).strip()
            product_size = (draft_item.size or "").strip()
            product_weight = (draft_item.weight or "").strip()

            if not product_name:
                return Response({
                    "message": "Product name is missing.",
                    "item_id": draft_item.id,
                }, status=400)

            submitted_price = submitted_prices.get(
                str(draft_item.id)
            )

            if submitted_price is not None:

                selling_price = parse_decimal(
                    submitted_price,
                    default=None,
                )

                if selling_price is None:
                    return Response({
                        "message": "Invalid selling price.",
                        "item_id": draft_item.id,
                        "product_name": product_name,
                    }, status=400)

            else:
                selling_price = draft_item.selling_price

            if selling_price is None:
                return Response({
                    "message": "Selling price is required.",
                    "item_id": draft_item.id,
                    "product_name": product_name,
                }, status=400)

            if selling_price <= 0:
                return Response({
                    "message": (
                        "Selling price must be greater than 0."
                    ),
                    "item_id": draft_item.id,
                    "product_name": product_name,
                }, status=400)

            # ------------------------------------------------
            # PRODUCT MATCH
            # ------------------------------------------------

            product = None

            if product_code:

                product = find_product_by_code(
                    product_code
                )

                if product:
                    match_type = "product_code"
                    action_type = "existing"
                else:
                    match_type = "product_code_not_found"
                    action_type = "created"

            else:

                product = find_product_by_name(
                    product_name
                )

                if product:
                    match_type = "product_name"
                    action_type = "existing"
                else:
                    match_type = "product_name_not_found"
                    action_type = "created"

            prepared_items.append({
                "draft_item": draft_item,
                "product": product,
                "product_code": product_code,
                "product_name": product_name,
                "selling_price": selling_price,
                "match_type": match_type,
                "action": action_type,
            })

        # ====================================================
        # STEP 4
        # SUPPLIER SAVE
        # ====================================================

        if draft.supplier_id != supplier.id:

            draft.supplier = supplier

            draft.save(
                update_fields=["supplier"]
            )

        # ====================================================
        # STEP 5
        # CREATE / UPDATE PRODUCTS
        # ====================================================

        processed_products = []

        for prepared in prepared_items:

            draft_item = prepared["draft_item"]
            product = prepared["product"]
            product_code = prepared["product_code"]
            product_name = prepared["product_name"]
            selling_price = prepared["selling_price"]
            match_type = prepared["match_type"]
            action_type = prepared["action"]

            # ------------------------------------------------
            # EXISTING PRODUCT
            # ------------------------------------------------

            if product:

                product.selling_price = selling_price

                update_fields = ["selling_price"]
                if product_size:
                    product.size = product_size
                    update_fields.append("size")
                if product_weight:
                    product.weight = product_weight
                    update_fields.append("weight")

                product.save(
                    update_fields=update_fields
                )

            # ------------------------------------------------
            # NEW PRODUCT
            # ------------------------------------------------

            else:

                new_product_code = (
                    product_code
                    if product_code
                    else None
                )

                if new_product_code:

                    duplicate = (
                        Product.objects
                        .filter(
                            product_code__iexact=new_product_code
                        )
                        .first()
                    )

                    if duplicate:
                        return Response({
                            "message": (
                                "Product code already exists."
                            ),
                            "product_code": new_product_code,
                            "product_id": duplicate.id,
                        }, status=400)

                product = Product.objects.create(
                    product_code=new_product_code,
                    name=product_name,
                    category="",
                    size=product_size,
                    weight=product_weight,
                    purchase_price=draft_item.purchase_price,
                    selling_price=selling_price,
                    stock=0,
                    low_stock_limit=0,
                )

            # ------------------------------------------------
            # DRAFT ITEM UPDATE
            # ------------------------------------------------

            draft_item.selling_price = selling_price
            draft_item.matched_product = product
            draft_item.is_identified = True

            draft_item.save(
                update_fields=[
                    "selling_price",
                    "matched_product",
                    "is_identified",
                ]
            )

            processed_products.append({
                "item_id": draft_item.id,
                "action": action_type,
                "match_type": match_type,
                "product_id": product.id,
                "product_code": product.product_code,
                "product_name": product.name,
                "size": product.size,
                "weight": product.weight,
                "purchase_price": draft_item.purchase_price,
                "selling_price": product.selling_price,
                "stock": product.stock,
            })

        # ====================================================
        # STEP 6
        # VERIFY
        # ====================================================

        draft.is_verified = True

        draft.save(
            update_fields=["is_verified"]
        )

        return Response({
            "message": (
                "Purchase draft verified successfully."
            ),
            "draft_id": draft.id,
            "is_verified": True,
            "supplier": {
                "id": supplier.id,
                "name": supplier.name,
            },
            "products": processed_products,
            "stock_updated": False,
            "next_step": (
                "Convert the verified draft to purchase."
            ),
        })

    # ========================================================
    # CONVERT VERIFIED DRAFT TO PURCHASE
    #
    # POST:
    # /api/purchase-drafts/<id>/convert/
    # ========================================================

    @action(
        detail=True,
        methods=["post"],
        url_path="convert",
    )
    @transaction.atomic
    def convert_to_purchase(self, request, pk=None):

        try:
            draft = (
                PurchaseDraft.objects
                .select_for_update(of=("self",))
                .select_related("supplier")
                .get(pk=pk)
            )
        except PurchaseDraft.DoesNotExist:
            return Response({
                "message": "Purchase draft not found.",
            }, status=404)

        if not draft.is_verified:
            return Response({
                "message": (
                    "Purchase draft ko pehle verify "
                    "karna zaroori hai."
                ),
            }, status=400)

        if not draft.supplier:
            return Response({
                "message": (
                    "Supplier is required before "
                    "converting the draft."
                ),
            }, status=400)

        draft_items = list(
            draft.items
            .select_related("matched_product")
            .all()
        )

        if not draft_items:
            return Response({
                "message": "Purchase draft has no items.",
            }, status=400)

        for draft_item in draft_items:

            if not draft_item.matched_product:
                return Response({
                    "message": (
                        "Every purchase item must "
                        "have a product."
                    ),
                    "item_id": draft_item.id,
                }, status=400)

            if (
                draft_item.selling_price is None
                or draft_item.selling_price <= 0
            ):
                return Response({
                    "message": (
                        "Every purchase item must "
                        "have a confirmed selling price."
                    ),
                    "item_id": draft_item.id,
                }, status=400)

        # ----------------------------------------------------
        # DUPLICATE BILL CHECK
        # ----------------------------------------------------

        if draft.bill_number:

            existing_purchase = (
                Purchase.objects
                .filter(
                    bill_number=draft.bill_number,
                    supplier=draft.supplier,
                )
                .first()
            )

            if existing_purchase:
                return Response({
                    "message": (
                        "This bill already exists "
                        "as a purchase."
                    ),
                    "purchase_id": existing_purchase.id,
                }, status=400)

        # ----------------------------------------------------
        # TAX
        # ----------------------------------------------------

        tax = parse_decimal(
            request.data.get("tax"),
            default=0,
        )

        if tax is None:
            tax = Decimal("0")

        # ----------------------------------------------------
        # GRAND TOTAL
        # ----------------------------------------------------

        grand_total = parse_decimal(
            request.data.get("grand_total"),
            default=None,
        )

        # ----------------------------------------------------
        # SUBTOTAL
        # ----------------------------------------------------

        calculated_subtotal = Decimal("0")

        for draft_item in draft_items:

            calculated_subtotal += (
                draft_item.quantity
                * draft_item.purchase_price
            )

        if grand_total is None:
            grand_total = calculated_subtotal + tax

        # ----------------------------------------------------
        # CREATE PURCHASE
        # ----------------------------------------------------

        purchase = Purchase.objects.create(
            supplier=draft.supplier,
            bill_number=draft.bill_number,
            bill_date=draft.bill_date,
            tax=tax,
            grand_total=grand_total,
            bill_image=draft.bill_image,
            is_confirmed=False,
        )

        # ----------------------------------------------------
        # CREATE PURCHASE ITEMS
        # ----------------------------------------------------

        for draft_item in draft_items:

            quantity = draft_item.quantity
            purchase_price = draft_item.purchase_price

            total = quantity * purchase_price

            PurchaseItem.objects.create(
                purchase=purchase,
                product=draft_item.matched_product,
                quantity=quantity,
                purchase_price=purchase_price,
                total=total,
            )

        return Response({
            "message": (
                "Verified bill converted "
                "to purchase successfully."
            ),
            "draft_id": draft.id,
            "purchase_id": purchase.id,
            "is_confirmed": purchase.is_confirmed,
            "stock_updated": False,
            "subtotal": calculated_subtotal,
            "tax": purchase.tax,
            "grand_total": purchase.grand_total,
            "next_step": (
                "Confirm the purchase to update stock."
            ),
        }, status=201)


# ============================================================
# PURCHASE DRAFT ITEM
# ============================================================

class PurchaseDraftItemViewSet(viewsets.ModelViewSet):

    queryset = (
        PurchaseDraftItem.objects
        .select_related(
            "draft",
            "matched_product",
        )
        .all()
        .order_by("-id")
    )

    serializer_class = PurchaseDraftItemSerializer


# ============================================================
# PURCHASE
# ============================================================

class PurchaseViewSet(viewsets.ModelViewSet):

    queryset = (
        Purchase.objects
        .select_related("supplier")
        .prefetch_related("items__product")
        .all()
        .order_by("-id")
    )

    serializer_class = PurchaseSerializer

    # ========================================================
    # CONFIRM PURCHASE
    #
    # POST:
    # /api/purchases/<id>/confirm/
    #
    # ONLY HERE STOCK CHANGES
    # ========================================================

    @action(
        detail=True,
        methods=["post"],
        url_path="confirm",
    )
    @transaction.atomic
    def confirm_purchase(self, request, pk=None):

        try:
            purchase = (
                Purchase.objects
                .select_for_update()
                .get(pk=pk)
            )
        except Purchase.DoesNotExist:
            return Response({
                "message": "Purchase not found.",
            }, status=404)

        if purchase.is_confirmed:
            return Response({
                "message": "Purchase is already confirmed.",
                "purchase_id": purchase.id,
                "stock_updated": False,
            })

        items = list(
            purchase.items
            .select_related("product")
            .all()
        )

        if not items:
            return Response({
                "message": "Purchase has no items.",
            }, status=400)

        for item in items:

            product = (
                Product.objects
                .select_for_update()
                .get(pk=item.product_id)
            )

            product.stock += item.quantity
            product.purchase_price = item.purchase_price

            product.save(
                update_fields=[
                    "stock",
                    "purchase_price",
                ]
            )

        purchase.is_confirmed = True

        purchase.save(
            update_fields=["is_confirmed"]
        )

        return Response({
            "message": "Purchase confirmed successfully.",
            "purchase_id": purchase.id,
            "is_confirmed": True,
            "stock_updated": True,
        })

    # ========================================================
    # UPDATE PURCHASE
    # ========================================================

    @transaction.atomic
    def update(self, request, *args, **kwargs):

        purchase = (
            Purchase.objects
            .select_for_update()
            .get(pk=kwargs.get("pk"))
        )

        if not purchase.is_confirmed:
            return super().update(
                request,
                *args,
                **kwargs,
            )

        old_items = list(
            purchase.items
            .select_related("product")
            .all()
        )

        for item in old_items:

            product = (
                Product.objects
                .select_for_update()
                .get(pk=item.product_id)
            )

            product.stock -= item.quantity

            product.save(
                update_fields=["stock"]
            )

        response = super().update(
            request,
            *args,
            **kwargs,
        )

        purchase.refresh_from_db()

        new_items = list(
            purchase.items
            .select_related("product")
            .all()
        )

        for item in new_items:

            product = (
                Product.objects
                .select_for_update()
                .get(pk=item.product_id)
            )

            product.stock += item.quantity
            product.purchase_price = item.purchase_price

            product.save(
                update_fields=[
                    "stock",
                    "purchase_price",
                ]
            )

        return response

    # ========================================================
    # DELETE PURCHASE
    # ========================================================

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):

        purchase = (
            Purchase.objects
            .select_for_update()
            .get(pk=kwargs.get("pk"))
        )

        if purchase.is_confirmed:

            items = list(
                purchase.items
                .select_related("product")
                .all()
            )

            for item in items:

                product = (
                    Product.objects
                    .select_for_update()
                    .get(pk=item.product_id)
                )

                product.stock -= item.quantity

                product.save(
                    update_fields=["stock"]
                )

        purchase.delete()

        return Response(status=204)


# ============================================================
# PURCHASE ITEM
# ============================================================

class PurchaseItemViewSet(viewsets.ReadOnlyModelViewSet):

    queryset = (
        PurchaseItem.objects
        .select_related(
            "purchase",
            "product",
        )
        .all()
        .order_by("-id")
    )

    serializer_class = PurchaseItemSerializer


# ============================================================
# SALE
# ============================================================

class SaleViewSet(viewsets.ModelViewSet):

    queryset = (
        Sale.objects
        .select_related("customer")
        .prefetch_related("items__product")
        .all()
        .order_by("-id")
    )

    serializer_class = SaleSerializer

    @action(
        detail=True,
        methods=["post"],
        url_path="confirm",
    )
    @transaction.atomic
    def confirm_sale(self, request, pk=None):

        sale = (
            Sale.objects
            .select_for_update()
            .get(pk=pk)
        )

        if sale.is_confirmed:
            return Response({
                "message": "Sale is already confirmed.",
                "sale_id": sale.id,
                "stock_updated": False,
            })

        items = list(
            sale.items
            .select_related("product")
            .all()
        )

        if not items:
            return Response({
                "message": "Sale has no items.",
            }, status=400)

        locked_products = {}

        for item in items:

            product = (
                Product.objects
                .select_for_update()
                .get(pk=item.product_id)
            )

            locked_products[item.product_id] = product

            if product.stock < item.quantity:
                return Response({
                    "message": "Insufficient stock.",
                    "product": product.name,
                    "available_stock": product.stock,
                    "requested_quantity": item.quantity,
                }, status=400)

        for item in items:

            product = locked_products[item.product_id]

            product.stock -= item.quantity

            product.save(
                update_fields=["stock"]
            )

        sale.is_confirmed = True

        sale.save(
            update_fields=["is_confirmed"]
        )

        return Response({
            "message": "Sale confirmed successfully.",
            "sale_id": sale.id,
            "is_confirmed": True,
            "stock_updated": True,
        })

    @transaction.atomic
    def update(self, request, *args, **kwargs):

        sale = (
            Sale.objects
            .select_for_update()
            .get(pk=kwargs.get("pk"))
        )

        if not sale.is_confirmed:
            return super().update(
                request,
                *args,
                **kwargs,
            )

        old_items = list(
            sale.items
            .select_related("product")
            .all()
        )

        for item in old_items:

            product = (
                Product.objects
                .select_for_update()
                .get(pk=item.product_id)
            )

            product.stock += item.quantity

            product.save(
                update_fields=["stock"]
            )

        response = super().update(
            request,
            *args,
            **kwargs,
        )

        sale.refresh_from_db()

        new_items = list(
            sale.items
            .select_related("product")
            .all()
        )

        for item in new_items:

            product = (
                Product.objects
                .select_for_update()
                .get(pk=item.product_id)
            )

            if product.stock < item.quantity:
                raise serializers.ValidationError({
                    "stock": (
                        f"{product.name} ke liye "
                        f"sufficient stock available nahi hai."
                    ),
                })

        for item in new_items:

            product = (
                Product.objects
                .select_for_update()
                .get(pk=item.product_id)
            )

            product.stock -= item.quantity

            product.save(
                update_fields=["stock"]
            )

        return response

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):

        sale = (
            Sale.objects
            .select_for_update()
            .get(pk=kwargs.get("pk"))
        )

        if sale.is_confirmed:

            items = list(
                sale.items
                .select_related("product")
                .all()
            )

            for item in items:

                product = (
                    Product.objects
                    .select_for_update()
                    .get(pk=item.product_id)
                )

                product.stock += item.quantity

                product.save(
                    update_fields=["stock"]
                )

        sale.delete()

        return Response(status=204)

    # ========================================================
    # SALE INVOICE PDF
    # ========================================================

    @action(
        detail=True,
        methods=["get"],
        url_path="invoice",
    )
    def invoice_pdf(self, request, pk=None):

        sale = (
            Sale.objects
            .select_related("customer")
            .prefetch_related("items__product")
            .get(pk=pk)
        )

        if not sale.is_confirmed:
            return Response({
                "message": (
                    "Invoice sirf confirmed sale "
                    "ke liye generate ho sakta hai."
                ),
            }, status=400)

        response = HttpResponse(
            content_type="application/pdf"
        )

        safe_invoice_number = "".join(
            character
            for character in sale.invoice_number
            if character.isascii()
            and (character.isalnum() or character in "-_")
        ) or f"sale-{sale.pk}"
        customer_name = (
            sale.customer.name
            if sale.customer and sale.customer.name.strip()
            else "Walk-in-Customer"
        )
        safe_customer_name = "-".join(
            part
            for part in "".join(
                character if character.isalnum() else " "
                for character in customer_name
                if character.isascii()
            ).split()
            if part
        ) or "Customer"
        response["Content-Disposition"] = (
            f'attachment; '
            f'filename="{safe_customer_name}-{safe_invoice_number}-{sale.pk}.pdf"'
        )

        document = SimpleDocTemplate(
            response,
            pagesize=A4,
            rightMargin=12 * mm,
            leftMargin=12 * mm,
            topMargin=10 * mm,
            bottomMargin=12 * mm,
        )

        styles = getSampleStyleSheet()
        business_style = ParagraphStyle(
            "BusinessName",
            parent=styles["Title"],
            alignment=TA_CENTER,
            fontSize=16,
            leading=19,
            spaceAfter=2,
            textColor=colors.black,
        )
        invoice_title_style = ParagraphStyle(
            "InvoiceTitle",
            parent=styles["Normal"],
            alignment=TA_CENTER,
            fontSize=11,
            leading=14,
            spaceAfter=6,
            textColor=colors.black,
        )
        normal_style = ParagraphStyle(
            "NormalText",
            parent=styles["Normal"],
            fontSize=8,
            leading=10,
            textColor=colors.black,
        )
        right_style = ParagraphStyle(
            "RightText",
            parent=normal_style,
            alignment=TA_RIGHT,
        )
        center_style = ParagraphStyle(
            "CenterText",
            parent=normal_style,
            alignment=TA_CENTER,
        )
        bold_style = ParagraphStyle(
            "BoldText",
            parent=normal_style,
            fontName="Helvetica-Bold",
        )
        available_width = A4[0] - 24 * mm
        story = []

        top_line = Table(
            [[
                Paragraph("SALES INVOICE", bold_style),
                Paragraph("<b>ORIGINAL COPY</b>", right_style),
            ]],
            colWidths=[available_width / 2, available_width / 2],
        )
        top_line.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
            ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.black),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        story.append(top_line)
        story.append(
            Paragraph(
                "MAHAVEER TILES &amp; MARBLES",
                business_style,
            )
        )
        story.append(
            Paragraph(
                "Tiles, Marbles &amp; Building Materials",
                ParagraphStyle(
                    "BusinessSubtitle",
                    parent=normal_style,
                    alignment=TA_CENTER,
                    spaceAfter=3,
                ),
            )
        )
        story.append(
            Paragraph(
                "NON-GST INVOICE",
                invoice_title_style,
            )
        )

        sale_date = sale.sale_date.strftime("%d-%m-%Y")
        customer = sale.customer
        customer_name = (
            customer.name
            if customer
            else "Walk-in Customer"
        )

        customer_phone = (
            customer.phone
            if customer and customer.phone
            else "-"
        )

        customer_address = (
            customer.address
            if customer and customer.address
            else "-"
        )
        billing_details = Paragraph(
            "<b>Billing Details</b><br/>"
            f"Name: {escape(customer_name)}<br/>"
            f"Phone: {escape(customer_phone)}<br/>"
            f"Address: {escape(customer_address)}",
            normal_style,
        )
        invoice_details = Paragraph(
            "<b>Invoice Details</b><br/>"
            f"Invoice Number: {escape(sale.invoice_number)}<br/>"
            f"Invoice Date: {sale_date}<br/>"
            f"Payment Method: {escape(sale.payment_method)}",
            normal_style,
        )
        details_table = Table(
            [[billing_details, invoice_details]],
            colWidths=[available_width / 2, available_width / 2],
        )
        details_table.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
            ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.black),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(details_table)
        story.append(Spacer(1, 6))

        table_data = [
            [
                Paragraph("<b>Sr.</b>", center_style),
                Paragraph("<b>Product Code</b>", center_style),
                Paragraph("<b>Item Description</b>", normal_style),
                Paragraph("<b>Size</b>", center_style),
                Paragraph("<b>Weight</b>", center_style),
                Paragraph("<b>Qty</b>", right_style),
                Paragraph("<b>Unit Price (Rs.)</b>", right_style),
                Paragraph("<b>Amount (Rs.)</b>", right_style),
            ]
        ]

        for index, item in enumerate(
            sale.items.select_related("product").all(),
            start=1,
        ):

            product = item.product

            product_code = (
                product.product_code
                if product.product_code
                else "-"
            )

            amount = (
                item.quantity
                * item.selling_price
            )

            table_data.append([
                Paragraph(str(index), center_style),
                Paragraph(
                    escape(str(product_code)),
                    normal_style,
                ),
                Paragraph(
                    escape(str(product.name)),
                    normal_style,
                ),
                Paragraph(
                    escape(str(product.size or "-")),
                    normal_style,
                ),
                Paragraph(
                    escape(str(product.weight or "-")),
                    normal_style,
                ),
                Paragraph(
                    f"{item.quantity:g}",
                    right_style,
                ),
                Paragraph(
                    f"Rs. {item.selling_price:,.2f}",
                    right_style,
                ),
                Paragraph(
                    f"Rs. {amount:,.2f}",
                    right_style,
                ),
            ])

        product_table = Table(
            table_data,
            colWidths=[
                8 * mm,
                22 * mm,
                49 * mm,
                20 * mm,
                19 * mm,
                13 * mm,
                27 * mm,
                28 * mm,
            ],
            repeatRows=1,
        )
        product_table.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
            ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.black),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ALIGN", (0, 0), (0, -1), "CENTER"),
            ("LEFTPADDING", (0, 0), (-1, -1), 3),
            ("RIGHTPADDING", (0, 0), (-1, -1), 3),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(product_table)
        story.append(Spacer(1, 5))

        totals_data = [[
            Paragraph("<b>Subtotal</b>", normal_style),
            Paragraph("<b>Discount</b>", normal_style),
            Paragraph("<b>Grand Total</b>", normal_style),
        ], [
            Paragraph(f"Rs. {sale.subtotal:,.2f}", right_style),
            Paragraph(f"Rs. {sale.discount:,.2f}", right_style),
            Paragraph(f"<b>Rs. {sale.grand_total:,.2f}</b>", right_style),
        ]]
        totals_table = Table(
            totals_data,
            colWidths=[available_width / 3] * 3,
        )
        totals_table.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
            ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.black),
            ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(totals_table)
        story.append(Spacer(1, 5))

        footer_left = Paragraph(
            "<b>Amount in Words</b><br/>"
            f"{escape(amount_in_words(sale.grand_total).title())}<br/><br/>"
            "<b>Terms &amp; Conditions</b><br/>"
            "Please check the goods at delivery. "
            "GST is not charged on this invoice.",
            normal_style,
        )
        footer_right = Paragraph(
            "<b>For MAHAVEER TILES &amp; MARBLES</b><br/><br/><br/><br/>"
            "Authorized Signature",
            right_style,
        )
        footer_table = Table(
            [[footer_left, footer_right]],
            colWidths=[available_width * 0.68, available_width * 0.32],
        )
        footer_table.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
            ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.black),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(footer_table)

        document.build(story)

        return response


# ============================================================
# SALE ITEM
# ============================================================

class SaleItemViewSet(viewsets.ReadOnlyModelViewSet):

    queryset = (
        SaleItem.objects
        .select_related(
            "sale",
            "product",
        )
        .all()
        .order_by("-id")
    )

    serializer_class = SaleItemSerializer


# ============================================================
# SALES RETURN
# ============================================================

class SaleReturnViewSet(viewsets.ModelViewSet):

    queryset = (
        SaleReturn.objects
        .select_related("sale")
        .prefetch_related("items__product")
        .all()
        .order_by("-id")
    )

    serializer_class = SaleReturnSerializer

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        return super().update(
            request,
            *args,
            **kwargs,
        )

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):

        sale_return = (
            SaleReturn.objects
            .select_for_update()
            .get(pk=kwargs.get("pk"))
        )

        items = list(
            sale_return.items
            .select_related("product")
            .all()
        )

        for item in items:

            product = (
                Product.objects
                .select_for_update()
                .get(pk=item.product_id)
            )

            product.stock -= item.quantity

            product.save(
                update_fields=["stock"]
            )

        sale_return.delete()

        return Response(status=204)


# ============================================================
# SALES RETURN ITEM
# ============================================================

class SaleReturnItemViewSet(
    viewsets.ReadOnlyModelViewSet
):

    queryset = (
        SaleReturnItem.objects
        .select_related(
            "sale_return",
            "product",
        )
        .all()
        .order_by("-id")
    )

    serializer_class = SaleReturnItemSerializer
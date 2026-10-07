from django.contrib import admin
from .models import (
    Supplier,
    Product,
    Purchase,
    PurchaseItem,
    Customer,
    Sale,
    SaleItem,
)


@admin.register(Supplier)
class SupplierAdmin(admin.ModelAdmin):
    list_display = ("name", "phone", "created_at")
    search_fields = ("name", "phone")


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "category",
        "purchase_price",
        "selling_price",
        "stock",
        "low_stock_limit",
    )
    search_fields = ("name", "category")


@admin.register(Purchase)
class PurchaseAdmin(admin.ModelAdmin):
    list_display = (
        "bill_number",
        "supplier",
        "bill_date",
        "tax",
        "grand_total",
        "created_at",
    )
    search_fields = ("bill_number", "supplier__name")
    list_filter = ("bill_date", "supplier")


@admin.register(PurchaseItem)
class PurchaseItemAdmin(admin.ModelAdmin):
    list_display = (
        "purchase",
        "product",
        "quantity",
        "purchase_price",
        "total",
    )
    search_fields = ("product__name", "purchase__bill_number")


@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ("name", "phone", "created_at")
    search_fields = ("name", "phone")


@admin.register(Sale)
class SaleAdmin(admin.ModelAdmin):
    list_display = (
        "invoice_number",
        "customer",
        "sale_date",
        "subtotal",
        "tax",
        "discount",
        "grand_total",
        "payment_method",
    )
    search_fields = (
        "invoice_number",
        "customer__name",
        "customer__phone",
    )
    list_filter = ("payment_method", "sale_date")


@admin.register(SaleItem)
class SaleItemAdmin(admin.ModelAdmin):
    list_display = (
        "sale",
        "product",
        "quantity",
        "selling_price",
        "total",
    )
    search_fields = (
        "product__name",
        "sale__invoice_number",
    )
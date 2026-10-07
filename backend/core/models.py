from django.conf import settings
from django.db import models


class AdminProfile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="admin_profile",
    )
    phone = models.CharField(
        max_length=20,
        blank=True,
    )
    phone_verified = models.BooleanField(
        default=False,
    )

    def __str__(self):
        return f"Admin profile: {self.user.get_username()}"


class AdminPhoneChallenge(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="pending_phone_challenge",
    )
    phone = models.CharField(max_length=20)
    created_at = models.DateTimeField(auto_now=True)


# =========================================================
# SUPPLIER
# =========================================================

class Supplier(models.Model):
    name = models.CharField(
        max_length=200
    )

    contact_person = models.CharField(
        max_length=200,
        blank=True
    )

    phone = models.CharField(
        max_length=20,
        blank=True
    )

    email = models.EmailField(
        blank=True
    )

    gstin = models.CharField(
        max_length=20,
        blank=True
    )

    address = models.TextField(
        blank=True
    )

    city = models.CharField(
        max_length=100,
        blank=True
    )

    state = models.CharField(
        max_length=100,
        blank=True
    )

    pincode = models.CharField(
        max_length=10,
        blank=True
    )

    outstanding = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0
    )

    status = models.CharField(
        max_length=20,
        choices=[("Active", "Active"), ("Inactive", "Inactive")],
        default="Active"
    )

    created_at = models.DateTimeField(
        auto_now_add=True
    )

    def __str__(self):
        return self.name


# =========================================================
# CATEGORY
# =========================================================

class Category(models.Model):
    name = models.CharField(
        max_length=100,
        unique=True
    )

    description = models.TextField(
        blank=True
    )

    status = models.CharField(
        max_length=20,
        choices=[("Active", "Active"), ("Inactive", "Inactive")],
        default="Active"
    )

    created_at = models.DateTimeField(
        auto_now_add=True
    )

    def __str__(self):
        return self.name


# =========================================================
# PRODUCT
# =========================================================

class Product(models.Model):
    product_code = models.CharField(
        max_length=100,
        unique=True,
        null=True,
        blank=True
    )

    name = models.CharField(
        max_length=200
    )

    category = models.CharField(
        max_length=100,
        blank=True
    )

    size = models.CharField(
        max_length=100,
        blank=True
    )

    weight = models.CharField(
        max_length=50,
        blank=True
    )

    # Bill se aane wala purchase price
    purchase_price = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0
    )

    # Mama/Product Master se maintain hone wala selling price
    selling_price = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0
    )

    # Current stock
    stock = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0
    )

    # Low stock alert limit
    low_stock_limit = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0
    )

    created_at = models.DateTimeField(
        auto_now_add=True
    )

    def __str__(self):
        return f"{self.product_code} - {self.name}"


# =========================================================
# PURCHASE
# =========================================================

class Purchase(models.Model):
    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.PROTECT,
        related_name="purchases"
    )

    bill_number = models.CharField(
        max_length=100,
        blank=True
    )

    bill_date = models.DateField(
        null=True,
        blank=True
    )

    tax = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0
    )

    grand_total = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0
    )

    # Original purchase bill
    # JPG / JPEG / PNG / PDF
    bill_image = models.FileField(
        upload_to="bills/",
        blank=True,
        null=True
    )

    # True hone ke baad hi stock update hoga
    is_confirmed = models.BooleanField(
        default=False
    )

    created_at = models.DateTimeField(
        auto_now_add=True
    )

    def __str__(self):
        return self.bill_number or f"Purchase #{self.id}"


# =========================================================
# PURCHASE ITEM
# =========================================================

class PurchaseItem(models.Model):
    purchase = models.ForeignKey(
        Purchase,
        on_delete=models.CASCADE,
        related_name="items"
    )

    product = models.ForeignKey(
        Product,
        on_delete=models.PROTECT,
        related_name="purchase_items"
    )

    quantity = models.DecimalField(
        max_digits=12,
        decimal_places=2
    )

    # Actual purchase rate from supplier bill
    purchase_price = models.DecimalField(
        max_digits=12,
        decimal_places=2
    )

    total = models.DecimalField(
        max_digits=12,
        decimal_places=2
    )

    def __str__(self):
        return f"{self.product.name} - {self.quantity}"


# =========================================================
# PURCHASE DRAFT / OCR VERIFICATION
# =========================================================

class PurchaseDraft(models.Model):

    # Verify ke time supplier select/match hoga
    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="purchase_drafts"
    )

    # OCR se mila original supplier name
    original_supplier_name = models.CharField(
        max_length=200,
        blank=True
    )

    supplier_phone = models.CharField(
        max_length=20,
        blank=True
    )

    supplier_gstin = models.CharField(
        max_length=20,
        blank=True
    )

    bill_number = models.CharField(
        max_length=100,
        blank=True
    )

    bill_date = models.DateField(
        null=True,
        blank=True
    )

    # Original uploaded bill
    # JPG / JPEG / PNG / PDF
    bill_image = models.FileField(
        upload_to="purchase_drafts/",
        blank=True,
        null=True
    )

    # Final verification se pehle False
    is_verified = models.BooleanField(
        default=False
    )

    created_at = models.DateTimeField(
        auto_now_add=True
    )

    def __str__(self):
        return (
            self.bill_number
            or f"Purchase Draft #{self.id}"
        )


# =========================================================
# PURCHASE DRAFT ITEM
# =========================================================

class PurchaseDraftItem(models.Model):

    draft = models.ForeignKey(
        PurchaseDraft,
        on_delete=models.CASCADE,
        related_name="items"
    )

    # OCR se mila real product code
    # Agar bill me code nahi hai to blank rahega
    original_product_code = models.CharField(
        max_length=100,
        blank=True
    )

    # OCR se mila product name
    original_product_name = models.CharField(
        max_length=200,
        blank=True
    )

    size = models.CharField(
        max_length=100,
        blank=True
    )

    weight = models.CharField(
        max_length=50,
        blank=True
    )

    # OCR se extracted quantity
    quantity = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0
    )

    # OCR se extracted supplier purchase rate
    purchase_price = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0
    )

    # =====================================================
    # NEW
    # Mama review page par manually selling price enter karega
    # OCR selling price extract nahi karega
    # =====================================================

    selling_price = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0
    )

    # Verify ke time matched existing Product
    matched_product = models.ForeignKey(
        Product,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="purchase_draft_items"
    )

    # Product identify/match hua ya manually map hua
    is_identified = models.BooleanField(
        default=False
    )

    created_at = models.DateTimeField(
        auto_now_add=True
    )

    def __str__(self):
        return (
            self.original_product_name
            or f"Draft Item #{self.id}"
        )


# =========================================================
# CUSTOMER
# =========================================================

class Customer(models.Model):

    name = models.CharField(
        max_length=200
    )

    phone = models.CharField(
        max_length=20,
        blank=True
    )

    address = models.TextField(
        blank=True
    )

    created_at = models.DateTimeField(
        auto_now_add=True
    )

    def __str__(self):
        return self.name


# =========================================================
# SALE
# =========================================================

class Sale(models.Model):

    customer = models.ForeignKey(
        Customer,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sales"
    )

    invoice_number = models.CharField(
        max_length=100,
        unique=True
    )

    sale_date = models.DateTimeField(
        auto_now_add=True
    )

    subtotal = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0
    )

    tax = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0
    )

    discount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0
    )

    grand_total = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0
    )

    payment_method = models.CharField(
        max_length=50,
        default="Cash"
    )

    # Confirm hone ke baad hi stock decrease hoga
    is_confirmed = models.BooleanField(
        default=False
    )

    def __str__(self):
        return self.invoice_number


# =========================================================
# SALE ITEM
# =========================================================

class SaleItem(models.Model):

    sale = models.ForeignKey(
        Sale,
        on_delete=models.CASCADE,
        related_name="items"
    )

    product = models.ForeignKey(
        Product,
        on_delete=models.PROTECT,
        related_name="sale_items"
    )

    quantity = models.DecimalField(
        max_digits=12,
        decimal_places=2
    )

    # Product Master ka selling price
    selling_price = models.DecimalField(
        max_digits=12,
        decimal_places=2
    )

    purchase_cost = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
    )

    total = models.DecimalField(
        max_digits=12,
        decimal_places=2
    )

    def __str__(self):
        return f"{self.product.name} - {self.quantity}"


# =========================================================
# SALES RETURN
# =========================================================

class SaleReturn(models.Model):

    sale = models.ForeignKey(
        Sale,
        on_delete=models.PROTECT,
        related_name="returns"
    )

    return_date = models.DateTimeField(
        auto_now_add=True
    )

    reason = models.TextField(
        blank=True
    )

    def __str__(self):
        return f"Return - {self.sale.invoice_number}"


# =========================================================
# SALES RETURN ITEM
# =========================================================

class SaleReturnItem(models.Model):

    sale_return = models.ForeignKey(
        SaleReturn,
        on_delete=models.CASCADE,
        related_name="items"
    )

    product = models.ForeignKey(
        Product,
        on_delete=models.PROTECT,
        related_name="sale_return_items"
    )

    quantity = models.DecimalField(
        max_digits=12,
        decimal_places=2
    )

    def __str__(self):
        return f"{self.product.name} - {self.quantity}"
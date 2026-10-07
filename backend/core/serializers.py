from decimal import Decimal

from django.db import transaction
from django.db.models import Sum

from rest_framework import serializers

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


# =========================================================
# PRODUCT MATCHING HELPER
# =========================================================

def normalize_product_name(value):
    """
    Product name ko normalized form me convert karta hai.

    Example:
        "  White   Marble  "
        ->
        "white marble"
    """

    return " ".join(
        (value or "").strip().lower().split()
    )


def find_product_match(
    product_code="",
    product_name=""
):
    """
    Product identification rules:

    1. Product Code available:
       exact case-insensitive Product Code match.

    2. Product Code unavailable:
       exact normalized Product Name match.

    3. No match:
       None.

    Important:
    - Product code ko name ke against use nahi kiya jata.
    - Product code generate nahi hota.
    - P001/P002 jaise fake codes nahi bante.
    """

    product_code = (
        (product_code or "")
        .strip()
    )

    product_name = (
        (product_name or "")
        .strip()
    )

    # -----------------------------------------------------
    # 1. PRODUCT CODE MATCH
    # -----------------------------------------------------

    if product_code:

        return (
            Product.objects
            .filter(
                product_code__iexact=product_code
            )
            .first()
        )

    # -----------------------------------------------------
    # 2. PRODUCT NAME MATCH
    # -----------------------------------------------------

    normalized_name = normalize_product_name(
        product_name
    )

    if not normalized_name:
        return None

    for product in (
        Product.objects
        .filter(name__isnull=False)
    ):

        candidate_name = normalize_product_name(
            product.name
        )

        if candidate_name == normalized_name:
            return product

    return None


# =========================================================
# PRODUCT
# =========================================================

class ProductSerializer(
    serializers.ModelSerializer
):

    class Meta:
        model = Product
        fields = "__all__"


# =========================================================
# CATEGORY
# =========================================================

class CategorySerializer(
    serializers.ModelSerializer
):

    class Meta:
        model = Category
        fields = [
            "id",
            "name",
            "description",
            "status",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]


# =========================================================
# SUPPLIER
# =========================================================

class SupplierSerializer(
    serializers.ModelSerializer
):

    total_purchases = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        read_only=True,
        default=Decimal("0.00"),
    )

    class Meta:
        model = Supplier
        fields = [
            "id",
            "name",
            "contact_person",
            "phone",
            "email",
            "gstin",
            "address",
            "city",
            "state",
            "pincode",
            "outstanding",
            "status",
            "total_purchases",
            "created_at",
        ]
        read_only_fields = ["id", "total_purchases", "created_at"]


# =========================================================
# CUSTOMER
# =========================================================

class CustomerSerializer(
    serializers.ModelSerializer
):

    class Meta:
        model = Customer
        fields = "__all__"


# =========================================================
# PURCHASE ITEM
# =========================================================

class PurchaseItemSerializer(
    serializers.ModelSerializer
):

    product_name = serializers.CharField(
        source="product.name",
        read_only=True
    )

    product_code = serializers.CharField(
        source="product.product_code",
        read_only=True
    )

    size = serializers.CharField(
        source="product.size",
        read_only=True
    )

    weight = serializers.CharField(
        source="product.weight",
        read_only=True
    )

    class Meta:
        model = PurchaseItem

        fields = [
            "id",
            "purchase",
            "product",
            "product_name",
            "product_code",
            "size",
            "weight",
            "quantity",
            "purchase_price",
            "total",
        ]

        read_only_fields = [
            "id",
            "purchase",
            "total",
            "product_name",
            "product_code",
            "size",
            "weight",
        ]

    # -----------------------------------------------------
    # QUANTITY
    # -----------------------------------------------------

    def validate_quantity(self, value):

        if value <= 0:
            raise serializers.ValidationError(
                "Quantity 0 se greater honi chahiye."
            )

        return value

    # -----------------------------------------------------
    # PURCHASE PRICE
    # -----------------------------------------------------

    def validate_purchase_price(self, value):

        if value < 0:
            raise serializers.ValidationError(
                "Purchase price negative nahi ho sakta."
            )

        return value

    # -----------------------------------------------------
    # CREATE
    # -----------------------------------------------------

    def create(
        self,
        validated_data
    ):

        quantity = validated_data["quantity"]

        purchase_price = validated_data[
            "purchase_price"
        ]

        validated_data["total"] = (
            quantity * purchase_price
        )

        return PurchaseItem.objects.create(
            **validated_data
        )

    # -----------------------------------------------------
    # UPDATE
    # -----------------------------------------------------

    def update(
        self,
        instance,
        validated_data
    ):

        quantity = validated_data.get(
            "quantity",
            instance.quantity
        )

        purchase_price = validated_data.get(
            "purchase_price",
            instance.purchase_price
        )

        validated_data["total"] = (
            quantity * purchase_price
        )

        return super().update(
            instance,
            validated_data
        )


# =========================================================
# PURCHASE
# =========================================================

class PurchaseSerializer(
    serializers.ModelSerializer
):

    items = PurchaseItemSerializer(
        many=True,
        required=False
    )

    supplier_name = serializers.CharField(
        source="supplier.name",
        read_only=True
    )

    class Meta:
        model = Purchase

        fields = [
            "id",
            "supplier",
            "supplier_name",
            "bill_number",
            "bill_date",
            "tax",
            "grand_total",
            "bill_image",
            "is_confirmed",
            "created_at",
            "items",
        ]

        read_only_fields = [
            "id",
            "grand_total",
            "is_confirmed",
            "created_at",
        ]

    # -----------------------------------------------------
    # TAX
    # -----------------------------------------------------

    def validate_tax(self, value):

        if value < 0:
            raise serializers.ValidationError(
                "Tax negative nahi ho sakta."
            )

        return value

    # -----------------------------------------------------
    # PURCHASE TOTAL
    # -----------------------------------------------------

    def calculate_purchase_total(
        self,
        items_data,
        tax
    ):

        subtotal = Decimal("0.00")

        for item in items_data:

            quantity = item["quantity"]

            purchase_price = item[
                "purchase_price"
            ]

            subtotal += (
                quantity * purchase_price
            )

        return subtotal + tax

    # -----------------------------------------------------
    # CREATE
    # -----------------------------------------------------

    @transaction.atomic
    def create(
        self,
        validated_data
    ):

        items_data = validated_data.pop(
            "items",
            []
        )

        tax = validated_data.get(
            "tax",
            Decimal("0.00")
        )

        grand_total = (
            self.calculate_purchase_total(
                items_data,
                tax
            )
        )

        validated_data["grand_total"] = (
            grand_total
        )

        # Purchase confirm automatically nahi hoga.
        validated_data["is_confirmed"] = False

        purchase = Purchase.objects.create(
            **validated_data
        )

        for item_data in items_data:

            quantity = item_data[
                "quantity"
            ]

            purchase_price = item_data[
                "purchase_price"
            ]

            total = (
                quantity * purchase_price
            )

            PurchaseItem.objects.create(
                purchase=purchase,
                product=item_data["product"],
                quantity=quantity,
                purchase_price=purchase_price,
                total=total,
            )

        return purchase

    # -----------------------------------------------------
    # UPDATE
    # -----------------------------------------------------

    @transaction.atomic
    def update(
        self,
        instance,
        validated_data
    ):

        items_data = validated_data.pop(
            "items",
            None
        )

        # Confirmed status frontend se manually
        # change nahi kiya ja sakta.
        validated_data.pop(
            "is_confirmed",
            None
        )

        tax = validated_data.get(
            "tax",
            instance.tax
        )

        # -------------------------------------------------
        # MAIN FIELDS
        # -------------------------------------------------

        for attr, value in validated_data.items():

            setattr(
                instance,
                attr,
                value
            )

        # -------------------------------------------------
        # ITEMS PROVIDED
        # -------------------------------------------------

        if items_data is not None:

            grand_total = (
                self.calculate_purchase_total(
                    items_data,
                    tax
                )
            )

            instance.grand_total = (
                grand_total
            )

        # -------------------------------------------------
        # ITEMS NOT PROVIDED
        # -------------------------------------------------

        else:

            existing_subtotal = (
                instance.items
                .aggregate(
                    total=Sum("total")
                )
                .get("total")
                or Decimal("0.00")
            )

            instance.grand_total = (
                existing_subtotal + tax
            )

        instance.save()

        # -------------------------------------------------
        # NO ITEM UPDATE
        # -------------------------------------------------

        if items_data is None:
            return instance

        # -------------------------------------------------
        # DELETE OLD ITEMS
        # -------------------------------------------------

        instance.items.all().delete()

        # -------------------------------------------------
        # CREATE NEW ITEMS
        # -------------------------------------------------

        for item_data in items_data:

            quantity = item_data[
                "quantity"
            ]

            purchase_price = item_data[
                "purchase_price"
            ]

            total = (
                quantity * purchase_price
            )

            PurchaseItem.objects.create(
                purchase=instance,
                product=item_data["product"],
                quantity=quantity,
                purchase_price=purchase_price,
                total=total,
            )

        return instance


# =========================================================
# PURCHASE DRAFT ITEM
# =========================================================

class PurchaseDraftItemSerializer(
    serializers.ModelSerializer
):

    matched_product_details = ProductSerializer(
        source="matched_product",
        read_only=True
    )

    class Meta:
        model = PurchaseDraftItem

        fields = [
            "id",
            "draft",
            "original_product_code",
            "original_product_name",
            "size",
            "weight",
            "quantity",
            "purchase_price",
            "selling_price",
            "matched_product",
            "matched_product_details",
            "is_identified",
            "created_at",
        ]

        read_only_fields = [
            "id",
            "draft",
            "matched_product_details",
            "is_identified",
            "created_at",
        ]

    # -----------------------------------------------------
    # QUANTITY
    # -----------------------------------------------------

    def validate_quantity(self, value):

        if value <= 0:

            raise serializers.ValidationError(
                "Quantity 0 se greater honi chahiye."
            )

        return value

    # -----------------------------------------------------
    # PURCHASE PRICE
    # -----------------------------------------------------

    def validate_purchase_price(self, value):

        if value < 0:

            raise serializers.ValidationError(
                "Purchase price negative nahi ho sakta."
            )

        return value

    # -----------------------------------------------------
    # SELLING PRICE
    # -----------------------------------------------------

    def validate_selling_price(self, value):

        if value < 0:

            raise serializers.ValidationError(
                "Selling price negative nahi ho sakta."
            )

        return value

    # -----------------------------------------------------
    # CREATE
    # -----------------------------------------------------

    def create(
        self,
        validated_data
    ):

        original_product_code = (
            validated_data.get(
                "original_product_code",
                ""
            )
            or ""
        ).strip()

        original_product_name = (
            validated_data.get(
                "original_product_name",
                ""
            )
            or ""
        ).strip()

        validated_data[
            "original_product_code"
        ] = original_product_code

        validated_data[
            "original_product_name"
        ] = original_product_name

        # -------------------------------------------------
        # MANUAL PRODUCT MAPPING
        # -------------------------------------------------

        matched_product = (
            validated_data.get(
                "matched_product"
            )
        )

        if matched_product:

            validated_data[
                "is_identified"
            ] = True

            # Existing product ka selling price
            # sirf prefill ke liye use hoga.
            if (
                "selling_price"
                not in validated_data
                or validated_data[
                    "selling_price"
                ] == 0
            ):

                validated_data[
                    "selling_price"
                ] = matched_product.selling_price

            return PurchaseDraftItem.objects.create(
                **validated_data
            )

        # -------------------------------------------------
        # AUTOMATIC PRODUCT MATCH
        # -------------------------------------------------

        matched_product = find_product_match(
            product_code=original_product_code,
            product_name=original_product_name
        )

        if matched_product:

            validated_data[
                "matched_product"
            ] = matched_product

            validated_data[
                "is_identified"
            ] = True

            # Existing product ka current selling
            # price review screen par prefill.
            if (
                "selling_price"
                not in validated_data
                or validated_data[
                    "selling_price"
                ] == 0
            ):

                validated_data[
                    "selling_price"
                ] = matched_product.selling_price

        else:

            validated_data[
                "matched_product"
            ] = None

            validated_data[
                "is_identified"
            ] = False

        return PurchaseDraftItem.objects.create(
            **validated_data
        )

    # -----------------------------------------------------
    # UPDATE
    # -----------------------------------------------------

    def update(
        self,
        instance,
        validated_data
    ):

        manual_mapping_provided = (
            "matched_product"
            in validated_data
        )

        code_was_changed = (
            "original_product_code"
            in validated_data
        )

        name_was_changed = (
            "original_product_name"
            in validated_data
        )

        original_product_code = (
            validated_data.get(
                "original_product_code",
                instance.original_product_code
            )
            or ""
        ).strip()

        original_product_name = (
            validated_data.get(
                "original_product_name",
                instance.original_product_name
            )
            or ""
        ).strip()

        validated_data[
            "original_product_code"
        ] = original_product_code

        validated_data[
            "original_product_name"
        ] = original_product_name

        # -------------------------------------------------
        # MANUAL MATCH
        # -------------------------------------------------

        if manual_mapping_provided:

            matched_product = (
                validated_data.get(
                    "matched_product"
                )
            )

        # -------------------------------------------------
        # CODE / NAME CHANGED
        # -------------------------------------------------

        elif (
            code_was_changed
            or name_was_changed
        ):

            matched_product = find_product_match(
                product_code=original_product_code,
                product_name=original_product_name
            )

        # -------------------------------------------------
        # NOTHING CHANGED
        # -------------------------------------------------

        else:

            matched_product = (
                instance.matched_product
            )

        # -------------------------------------------------
        # MATCH FOUND
        # -------------------------------------------------

        if matched_product:

            validated_data[
                "matched_product"
            ] = matched_product

            validated_data[
                "is_identified"
            ] = True

            # Agar frontend ne selling price nahi bheja
            # to existing product ka current price prefill.
            if "selling_price" not in validated_data:

                validated_data[
                    "selling_price"
                ] = matched_product.selling_price

        # -------------------------------------------------
        # NO MATCH
        # -------------------------------------------------

        else:

            validated_data[
                "matched_product"
            ] = None

            validated_data[
                "is_identified"
            ] = False

        return super().update(
            instance,
            validated_data
        )


# =========================================================
# PURCHASE DRAFT
# =========================================================

class PurchaseDraftSerializer(
    serializers.ModelSerializer
):

    items = PurchaseDraftItemSerializer(
        many=True,
        required=False
    )

    supplier_name = serializers.CharField(
        source="supplier.name",
        read_only=True
    )

    class Meta:
        model = PurchaseDraft

        fields = [
            "id",
            "supplier",
            "supplier_name",
            "original_supplier_name",
            "supplier_phone",
            "supplier_gstin",
            "bill_number",
            "bill_date",
            "bill_image",
            "is_verified",
            "created_at",
            "items",
        ]

        read_only_fields = [
            "id",
            "is_verified",
            "created_at",
            "supplier_phone",
            "supplier_gstin",
        ]

    # -----------------------------------------------------
    # PREPARE DRAFT ITEM
    # -----------------------------------------------------

    def prepare_draft_item(
        self,
        item_data
    ):
        """
        Draft item ko identify karta hai.

        Priority:

        1. Manual matched_product
        2. Product Code
        3. Product Name
        4. No match
        """

        original_product_code = (
            item_data.get(
                "original_product_code",
                ""
            )
            or ""
        ).strip()

        original_product_name = (
            item_data.get(
                "original_product_name",
                ""
            )
            or ""
        ).strip()

        item_data[
            "original_product_code"
        ] = original_product_code

        item_data[
            "original_product_name"
        ] = original_product_name

        # -------------------------------------------------
        # MANUAL MATCH
        # -------------------------------------------------

        matched_product = (
            item_data.get(
                "matched_product"
            )
        )

        if matched_product:

            item_data[
                "matched_product"
            ] = matched_product

            item_data[
                "is_identified"
            ] = True

            if (
                "selling_price" not in item_data
                or item_data[
                    "selling_price"
                ] == 0
            ):

                item_data[
                    "selling_price"
                ] = matched_product.selling_price

            return item_data

        # -------------------------------------------------
        # AUTOMATIC MATCH
        # -------------------------------------------------

        matched_product = find_product_match(
            product_code=original_product_code,
            product_name=original_product_name
        )

        if matched_product:

            item_data[
                "matched_product"
            ] = matched_product

            item_data[
                "is_identified"
            ] = True

            if (
                "selling_price" not in item_data
                or item_data[
                    "selling_price"
                ] == 0
            ):

                item_data[
                    "selling_price"
                ] = matched_product.selling_price

        else:

            item_data[
                "matched_product"
            ] = None

            item_data[
                "is_identified"
            ] = False

        return item_data

    # -----------------------------------------------------
    # CREATE
    # -----------------------------------------------------

    @transaction.atomic
    def create(
        self,
        validated_data
    ):

        items_data = validated_data.pop(
            "items",
            []
        )

        validated_data[
            "is_verified"
        ] = False

        draft = PurchaseDraft.objects.create(
            **validated_data
        )

        for item_data in items_data:

            item_data = (
                self.prepare_draft_item(
                    item_data
                )
            )

            # Safety:
            # nested serializer se draft field
            # kabhi accidentally aaye to remove.
            item_data.pop(
                "draft",
                None
            )

            PurchaseDraftItem.objects.create(
                draft=draft,
                **item_data
            )

        return draft

    # -----------------------------------------------------
    # UPDATE
    # -----------------------------------------------------

    @transaction.atomic
    def update(
        self,
        instance,
        validated_data
    ):

        items_data = validated_data.pop(
            "items",
            None
        )

        # Verified status manually change nahi hoga.
        validated_data.pop(
            "is_verified",
            None
        )

        # -------------------------------------------------
        # UPDATE MAIN FIELDS
        # -------------------------------------------------

        for attr, value in validated_data.items():

            setattr(
                instance,
                attr,
                value
            )

        instance.save()

        # -------------------------------------------------
        # NO ITEM UPDATE
        # -------------------------------------------------

        if items_data is None:
            return instance

        # -------------------------------------------------
        # DELETE OLD ITEMS
        # -------------------------------------------------

        instance.items.all().delete()

        # -------------------------------------------------
        # CREATE NEW ITEMS
        # -------------------------------------------------

        for item_data in items_data:

            item_data = (
                self.prepare_draft_item(
                    item_data
                )
            )

            item_data.pop(
                "draft",
                None
            )

            PurchaseDraftItem.objects.create(
                draft=instance,
                **item_data
            )

        return instance


# =========================================================
# SALE ITEM
# =========================================================

class SaleItemSerializer(
    serializers.ModelSerializer
):

    product_name = serializers.CharField(
        source="product.name",
        read_only=True
    )

    product_code = serializers.CharField(
        source="product.product_code",
        read_only=True
    )

    size = serializers.CharField(
        source="product.size",
        read_only=True,
    )

    weight = serializers.CharField(
        source="product.weight",
        read_only=True,
    )

    class Meta:
        model = SaleItem

        fields = [
            "id",
            "sale",
            "product",
            "product_name",
            "product_code",
            "size",
            "weight",
            "quantity",
            "selling_price",
            "purchase_cost",
            "total",
        ]

        read_only_fields = [
            "id",
            "sale",
            "total",
            "purchase_cost",
            "product_name",
            "product_code",
            "size",
            "weight",
        ]

    # -----------------------------------------------------
    # QUANTITY
    # -----------------------------------------------------

    def validate_quantity(self, value):

        if value <= 0:

            raise serializers.ValidationError(
                "Quantity 0 se greater honi chahiye."
            )

        return value

    # -----------------------------------------------------
    # SELLING PRICE
    # -----------------------------------------------------

    def validate_selling_price(self, value):

        if value < 0:

            raise serializers.ValidationError(
                "Selling price negative nahi ho sakta."
            )

        return value

    # -----------------------------------------------------
    # CREATE
    # -----------------------------------------------------

    def create(
        self,
        validated_data
    ):

        quantity = validated_data[
            "quantity"
        ]

        selling_price = validated_data[
            "selling_price"
        ]

        validated_data["total"] = (
            quantity * selling_price
        )
        validated_data["purchase_cost"] = (
            validated_data["product"].purchase_price
        )

        return SaleItem.objects.create(
            **validated_data
        )

    # -----------------------------------------------------
    # UPDATE
    # -----------------------------------------------------

    def update(
        self,
        instance,
        validated_data
    ):

        quantity = validated_data.get(
            "quantity",
            instance.quantity
        )

        selling_price = validated_data.get(
            "selling_price",
            instance.selling_price
        )

        validated_data["total"] = (
            quantity * selling_price
        )
        product = validated_data.get("product", instance.product)
        validated_data["purchase_cost"] = product.purchase_price

        return super().update(
            instance,
            validated_data
        )


# =========================================================
# SALE
# =========================================================

class SaleSerializer(
    serializers.ModelSerializer
):

    items = SaleItemSerializer(
        many=True,
    )

    customer_name = serializers.CharField(
        source="customer.name",
        read_only=True
    )

    new_customer_name = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        max_length=200,
    )

    customer_phone = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        max_length=20,
    )

    customer_address = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
    )

    class Meta:
        model = Sale

        fields = [
            "id",
            "customer",
            "customer_name",
            "new_customer_name",
            "customer_phone",
            "customer_address",
            "invoice_number",
            "sale_date",
            "subtotal",
            "tax",
            "discount",
            "grand_total",
            "payment_method",
            "is_confirmed",
            "items",
        ]

        read_only_fields = [
            "id",
            "sale_date",
            "subtotal",
            "grand_total",
            "is_confirmed",
            "tax",
        ]

    # -----------------------------------------------------
    # DISCOUNT
    # -----------------------------------------------------

    def validate_discount(self, value):

        if value < 0:

            raise serializers.ValidationError(
                "Discount negative nahi ho sakta."
            )

        return value

    # -----------------------------------------------------
    # SALE TOTALS
    # -----------------------------------------------------

    def calculate_sale_totals(
        self,
        items_data,
        discount
    ):

        subtotal = Decimal("0.00")

        for item in items_data:

            quantity = item[
                "quantity"
            ]

            selling_price = item[
                "selling_price"
            ]

            subtotal += (
                quantity * selling_price
            )

        grand_total = (
            subtotal - discount
        )

        if grand_total < 0:

            raise serializers.ValidationError({
                "discount": (
                    "Discount subtotal se "
                    "zyada nahi ho sakta."
                )
            })

        return (
            subtotal,
            grand_total
        )

    def resolve_customer(self, validated_data):
        customer_name = validated_data.pop(
            "new_customer_name",
            "",
        ).strip()
        customer_phone = validated_data.pop(
            "customer_phone",
            "",
        ).strip()
        customer_address = validated_data.pop(
            "customer_address",
            "",
        ).strip()

        if validated_data.get("customer") is None and customer_name:
            customer = (
                Customer.objects.filter(phone=customer_phone).first()
                if customer_phone
                else None
            )
            if customer is None:
                customer = Customer.objects.create(
                    name=customer_name,
                    phone=customer_phone,
                    address=customer_address,
                )
            validated_data["customer"] = customer

    # -----------------------------------------------------
    # CREATE
    # -----------------------------------------------------

    @transaction.atomic
    def create(
        self,
        validated_data
    ):

        items_data = validated_data.pop(
            "items",
            []
        )
        self.resolve_customer(validated_data)

        discount = validated_data.get(
            "discount",
            Decimal("0.00")
        )

        subtotal, grand_total = (
            self.calculate_sale_totals(
                items_data,
                discount
            )
        )

        # Sales me GST / Tax use nahi ho raha.
        validated_data["tax"] = (
            Decimal("0.00")
        )

        validated_data["subtotal"] = (
            subtotal
        )

        validated_data["grand_total"] = (
            grand_total
        )

        validated_data[
            "is_confirmed"
        ] = False

        sale = Sale.objects.create(
            **validated_data
        )

        for item_data in items_data:

            quantity = item_data[
                "quantity"
            ]

            selling_price = item_data[
                "selling_price"
            ]

            total = (
                quantity * selling_price
            )

            SaleItem.objects.create(
                sale=sale,
                product=item_data["product"],
                quantity=quantity,
                selling_price=selling_price,
                purchase_cost=item_data["product"].purchase_price,
                total=total,
            )

        return sale

    # -----------------------------------------------------
    # UPDATE
    # -----------------------------------------------------

    @transaction.atomic
    def update(
        self,
        instance,
        validated_data
    ):

        self.resolve_customer(validated_data)

        items_data = validated_data.pop(
            "items",
            None
        )

        discount = validated_data.get(
            "discount",
            instance.discount
        )

        # Tax manually change nahi hoga.
        validated_data.pop(
            "tax",
            None
        )

        validated_data["tax"] = (
            Decimal("0.00")
        )

        # -------------------------------------------------
        # MAIN FIELDS
        # -------------------------------------------------

        for attr, value in validated_data.items():

            setattr(
                instance,
                attr,
                value
            )

        # -------------------------------------------------
        # ITEMS PROVIDED
        # -------------------------------------------------

        if items_data is not None:

            subtotal, grand_total = (
                self.calculate_sale_totals(
                    items_data,
                    discount
                )
            )

            instance.subtotal = (
                subtotal
            )

            instance.grand_total = (
                grand_total
            )

        # -------------------------------------------------
        # ITEMS NOT PROVIDED
        # -------------------------------------------------

        else:

            existing_subtotal = (
                instance.items
                .aggregate(
                    total=Sum("total")
                )
                .get("total")
                or Decimal("0.00")
            )

            instance.subtotal = (
                existing_subtotal
            )

            instance.grand_total = (
                existing_subtotal - discount
            )

            if instance.grand_total < 0:

                raise serializers.ValidationError({
                    "discount": (
                        "Discount subtotal se "
                        "zyada nahi ho sakta."
                    )
                })

        instance.save()

        # -------------------------------------------------
        # NO ITEM UPDATE
        # -------------------------------------------------

        if items_data is None:
            return instance

        # -------------------------------------------------
        # DELETE OLD ITEMS
        # -------------------------------------------------

        instance.items.all().delete()

        # -------------------------------------------------
        # CREATE NEW ITEMS
        # -------------------------------------------------

        for item_data in items_data:

            quantity = item_data[
                "quantity"
            ]

            selling_price = item_data[
                "selling_price"
            ]

            total = (
                quantity * selling_price
            )

            SaleItem.objects.create(
                sale=instance,
                product=item_data["product"],
                quantity=quantity,
                selling_price=selling_price,
                purchase_cost=item_data["product"].purchase_price,
                total=total,
            )

        return instance


# =========================================================
# SALES RETURN ITEM
# =========================================================

class SaleReturnItemSerializer(
    serializers.ModelSerializer
):

    product_name = serializers.CharField(
        source="product.name",
        read_only=True
    )

    product_code = serializers.CharField(
        source="product.product_code",
        read_only=True
    )

    class Meta:
        model = SaleReturnItem

        fields = [
            "id",
            "sale_return",
            "product",
            "product_name",
            "product_code",
            "quantity",
        ]

        read_only_fields = [
            "id",
            "sale_return",
            "product_name",
            "product_code",
        ]

    # -----------------------------------------------------
    # QUANTITY
    # -----------------------------------------------------

    def validate_quantity(self, value):

        if value <= 0:

            raise serializers.ValidationError(
                "Return quantity 0 se greater honi chahiye."
            )

        return value


# =========================================================
# SALES RETURN
# =========================================================

class SaleReturnSerializer(
    serializers.ModelSerializer
):

    items = SaleReturnItemSerializer(
        many=True
    )

    sale_invoice_number = serializers.CharField(
        source="sale.invoice_number",
        read_only=True
    )

    class Meta:
        model = SaleReturn

        fields = [
            "id",
            "sale",
            "sale_invoice_number",
            "return_date",
            "reason",
            "items",
        ]

        read_only_fields = [
            "id",
            "sale_invoice_number",
            "return_date",
        ]

    # -----------------------------------------------------
    # RETURN QUANTITY VALIDATION
    # -----------------------------------------------------

    def validate_return_items(
        self,
        sale,
        items_data,
        current_return=None
    ):
        """
        Check karta hai ki total returned quantity
        sold quantity se zyada na ho.
        """

        requested_quantities = {}

        # -------------------------------------------------
        # GROUP SAME PRODUCTS
        # -------------------------------------------------

        for item_data in items_data:

            product = item_data[
                "product"
            ]

            quantity = item_data[
                "quantity"
            ]

            product_id = product.id

            if product_id not in requested_quantities:

                requested_quantities[
                    product_id
                ] = {
                    "product": product,
                    "quantity": Decimal("0.00")
                }

            requested_quantities[
                product_id
            ]["quantity"] += quantity

        # -------------------------------------------------
        # VALIDATE EACH PRODUCT
        # -------------------------------------------------

        for data in requested_quantities.values():

            product = data["product"]

            requested_quantity = data[
                "quantity"
            ]

            # ---------------------------------------------
            # TOTAL SOLD
            # ---------------------------------------------

            sold_quantity = (
                SaleItem.objects
                .filter(
                    sale=sale,
                    product=product
                )
                .aggregate(
                    total=Sum("quantity")
                )
                .get("total")
                or Decimal("0.00")
            )

            if sold_quantity <= 0:

                raise serializers.ValidationError({
                    "product": (
                        f"{product.name} "
                        "is sale mein sold nahi hua tha."
                    )
                })

            # ---------------------------------------------
            # PREVIOUS RETURNS
            # ---------------------------------------------

            previous_returns = (
                SaleReturnItem.objects
                .filter(
                    sale_return__sale=sale,
                    product=product
                )
            )

            # ---------------------------------------------
            # UPDATE ME CURRENT RETURN EXCLUDE
            # ---------------------------------------------

            if current_return is not None:

                previous_returns = (
                    previous_returns.exclude(
                        sale_return=current_return
                    )
                )

            already_returned = (
                previous_returns
                .aggregate(
                    total=Sum("quantity")
                )
                .get("total")
                or Decimal("0.00")
            )

            remaining_quantity = (
                sold_quantity -
                already_returned
            )

            # ---------------------------------------------
            # MAX RETURN CHECK
            # ---------------------------------------------

            if requested_quantity > remaining_quantity:

                raise serializers.ValidationError({
                    "quantity": (
                        f"{product.name} ke liye "
                        f"maximum "
                        f"{remaining_quantity} "
                        "quantity return ki ja sakti hai."
                    )
                })

    # -----------------------------------------------------
    # CREATE RETURN
    # -----------------------------------------------------

    @transaction.atomic
    def create(
        self,
        validated_data
    ):

        items_data = validated_data.pop(
            "items",
            []
        )

        sale = validated_data[
            "sale"
        ]

        # -------------------------------------------------
        # CONFIRMED SALE CHECK
        # -------------------------------------------------

        if not sale.is_confirmed:

            raise serializers.ValidationError({
                "sale": (
                    "Return sirf confirmed sale "
                    "ke liye create ki ja sakti hai."
                )
            })

        # -------------------------------------------------
        # ITEMS REQUIRED
        # -------------------------------------------------

        if not items_data:

            raise serializers.ValidationError({
                "items": (
                    "Kam se kam ek return item "
                    "required hai."
                )
            })

        # -------------------------------------------------
        # VALIDATE QUANTITY
        # -------------------------------------------------

        self.validate_return_items(
            sale=sale,
            items_data=items_data
        )

        # -------------------------------------------------
        # CREATE RETURN
        # -------------------------------------------------

        sale_return = SaleReturn.objects.create(
            **validated_data
        )

        # -------------------------------------------------
        # CREATE ITEMS + ADD STOCK
        # -------------------------------------------------

        for item_data in items_data:

            product = item_data[
                "product"
            ]

            return_quantity = item_data[
                "quantity"
            ]

            SaleReturnItem.objects.create(
                sale_return=sale_return,
                product=product,
                quantity=return_quantity
            )

            # Customer return:
            # stock increases.

            product.stock += (
                return_quantity
            )

            product.save(
                update_fields=[
                    "stock"
                ]
            )

        return sale_return

    # -----------------------------------------------------
    # UPDATE RETURN
    # -----------------------------------------------------

    @transaction.atomic
    def update(
        self,
        instance,
        validated_data
    ):

        items_data = validated_data.pop(
            "items",
            None
        )

        sale = instance.sale

        # -------------------------------------------------
        # CONFIRMED SALE CHECK
        # -------------------------------------------------

        if not sale.is_confirmed:

            raise serializers.ValidationError({
                "sale": (
                    "Return sirf confirmed sale "
                    "ke liye update ki ja sakti hai."
                )
            })

        # -------------------------------------------------
        # ORIGINAL SALE CHANGE ALLOW NAHI
        # -------------------------------------------------

        validated_data.pop(
            "sale",
            None
        )

        # -------------------------------------------------
        # ONLY HEADER UPDATE
        # -------------------------------------------------

        if items_data is None:

            for attr, value in validated_data.items():

                setattr(
                    instance,
                    attr,
                    value
                )

            instance.save()

            return instance

        # -------------------------------------------------
        # ITEMS REQUIRED
        # -------------------------------------------------

        if not items_data:

            raise serializers.ValidationError({
                "items": (
                    "Kam se kam ek return item "
                    "required hai."
                )
            })

        # -------------------------------------------------
        # VALIDATE NEW RETURN ITEMS
        # -------------------------------------------------

        self.validate_return_items(
            sale=sale,
            items_data=items_data,
            current_return=instance
        )

        # -------------------------------------------------
        # REVERSE OLD RETURN STOCK
        # -------------------------------------------------

        old_items = list(
            instance.items
            .select_related("product")
            .all()
        )

        for item in old_items:

            product = item.product

            product.stock -= (
                item.quantity
            )

            product.save(
                update_fields=[
                    "stock"
                ]
            )

        # -------------------------------------------------
        # UPDATE HEADER
        # -------------------------------------------------

        for attr, value in validated_data.items():

            setattr(
                instance,
                attr,
                value
            )

        instance.save()

        # -------------------------------------------------
        # DELETE OLD ITEMS
        # -------------------------------------------------

        instance.items.all().delete()

        # -------------------------------------------------
        # CREATE NEW ITEMS + ADD STOCK
        # -------------------------------------------------

        for item_data in items_data:

            product = item_data[
                "product"
            ]

            return_quantity = item_data[
                "quantity"
            ]

            SaleReturnItem.objects.create(
                sale_return=instance,
                product=product,
                quantity=return_quantity
            )

            # Customer return:
            # stock increases.

            product.stock += (
                return_quantity
            )

            product.save(
                update_fields=[
                    "stock"
                ]
            )

        return instance
import json
from decimal import Decimal
from unittest.mock import patch

import fitz
from django.contrib.auth import get_user_model
from django.test import Client
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from .models import (
    AdminProfile,
    Category,
    Customer,
    Product,
    Purchase,
    PurchaseDraft,
    PurchaseDraftItem,
    PurchaseItem,
    Sale,
    SaleItem,
    Supplier,
)
from .services.ocr_service import parse_bill_text


class AuthenticatedApiTestCase(APITestCase):
    def setUp(self):
        self.admin_user = get_user_model().objects.create_user(
            username="testadmin",
            password="Strong-test-password-1",
            is_staff=True,
        )
        self.client.force_authenticate(user=self.admin_user)


class BillOcrMetadataTests(APITestCase):
    def test_invoice_date_wins_over_unrelated_gstin_date(self):
        parsed = parse_bill_text([
            "GSTIN No. 24ABCDE Date: 01/12/2023",
            "Invoice Number & Date: ALSK/2627-2056",
            "18/09/2026",
            "Transaction Type: DEBIT",
            "Preparation Date & Time: 18/09/2026",
            "GLAZE VITRIFIED TILES - 2 PC",
            "2",
            "217.00",
            "434.00",
            "Grand Total: 434.00",
        ])

        self.assertEqual(parsed["bill_date"], "2026-09-18")

    def test_inline_invoice_number_and_date_is_prioritized(self):
        parsed = parse_bill_text([
            "GSTIN No. 24ABCDE Date: 01/12/2023",
            "Invoice Number & Date: ALSK/2627-2056 18/09/2026",
            "GLAZE VITRIFIED TILES - 2 PC",
            "2",
            "217.00",
            "434.00",
            "Grand Total: 434.00",
        ])

        self.assertEqual(parsed["bill_date"], "2026-09-18")

    def test_extracts_supplier_gstin_and_contact_phone_not_buyer_gstin(self):
        parsed = parse_bill_text([
            "ALASKA SURFACES LLP",
            "GSTIN No.: 24ACDFA2859E1ZO",
            "Details of Receiver (Buyer Details)",
            "GSTIN No.: 21FRHPM6847J1ZE",
            "For, ALASKA SURFACES LLP",
            "ContaotUs: +91 97373 26287",
        ])

        self.assertEqual(parsed["supplier_gstin"], "24ACDFA2859E1ZO")
        self.assertEqual(parsed["supplier_phone"], "919737326287")

    def test_extracts_supplier_phone_from_common_abbreviated_label(self):
        parsed = parse_bill_text([
            "ACME TILES PRIVATE LIMITED",
            "Mob. No.: +91 (98765) 43210",
            "GSTIN: 24ACDFA2859E1ZO",
            "Details of Receiver",
            "Phone: 9876500000",
        ])

        self.assertEqual(parsed["supplier_phone"], "919876543210")

    def test_extracts_supplier_phone_when_label_and_number_are_on_separate_lines(self):
        parsed = parse_bill_text([
            "ACME TILES PRIVATE LIMITED",
            "Ph No:",
            "0674 1234567",
            "GSTIN: 24ACDFA2859E1ZO",
        ])

        self.assertEqual(parsed["supplier_phone"], "06741234567")

    def test_extracts_supplier_phone_and_gstin_from_footer_not_address_or_buyer(self):
        parsed = parse_bill_text([
            "MAHAVEER TILES",
            "Details of Receiver (Buyer Details)",
            "Buyer Address: Village Road, Cuttack",
            "Phone: 9876500000",
            "GSTIN: 21ABCDE1234F1Z5",
            "Product Table",
            "Tile 600x1200",
            "2",
            "500",
            "1000",
            "Grand Total: 1000",
            "Registered Office: Plot 18, Industrial Estate",
            "Bhubaneswar, Odisha 751001",
            "Phone: 0674 2345678",
            "GSTIN: 21SELLR1234F1Z5",
            "Email: sales@example.test",
        ])

        self.assertEqual(parsed["supplier_phone"], "06742345678")
        self.assertEqual(parsed["supplier_gstin"], "21SELLR1234F1Z5")
        self.assertNotIn("supplier_address", parsed)
        self.assertNotIn("supplier_email", parsed)

    def test_extracts_size_and_weight_from_separate_bill_lines(self):
        parsed = parse_bill_text([
            "VITRIFIED FLOOR TILE",
            "600X1200 MM",
            "25 KG",
            "2",
            "500.00",
            "1000.00",
            "Grand Total",
            "1000.00",
        ])

        self.assertEqual(len(parsed["items"]), 1)
        self.assertEqual(parsed["items"][0]["size"], "600X1200 MM")
        self.assertEqual(parsed["items"][0]["weight"], "25 KG")
        self.assertEqual(parsed["items"][0]["quantity"], Decimal("2"))

    def test_extracts_inline_weight_without_counting_it_as_quantity(self):
        parsed = parse_bill_text([
            "VITRIFIED FLOOR TILE 600X1200MM 25 KG 2 500.00 1000.00",
            "Grand Total",
            "1000.00",
        ])

        self.assertEqual(len(parsed["items"]), 1)
        self.assertEqual(parsed["items"][0]["size"], "600X1200MM")
        self.assertEqual(parsed["items"][0]["weight"], "25 KG")
        self.assertEqual(parsed["items"][0]["quantity"], Decimal("2"))

    def test_inline_pc_counts_remain_in_distinct_product_names(self):
        parsed = parse_bill_text([
            "GLAZE VITRIFIED TILES - 2 PC PRE 600X1200 20 217 4340",
            "GLAZE VITRIFIED TILES - 3 PC PRE 600X1200 10 320 3200",
            "Grand Total: 7540",
        ])

        self.assertEqual(len(parsed["items"]), 2)
        self.assertEqual(
            [item["name"] for item in parsed["items"]],
            [
                "GLAZE VITRIFIED TILES - 2 PC",
                "GLAZE VITRIFIED TILES - 3 PC",
            ],
        )
        self.assertEqual(
            [item["quantity"] for item in parsed["items"]],
            [Decimal("20"), Decimal("10")],
        )
        self.assertEqual(
            [item["line_total"] for item in parsed["items"]],
            [Decimal("4340"), Decimal("3200")],
        )

    def test_extracts_small_ft_dimensions_from_bill(self):
        parsed = parse_bill_text([
            "STONE TILE",
            "4 x 2 ft",
            "2",
            "500.00",
            "1000.00",
            "Grand Total",
            "1000.00",
        ])

        self.assertEqual(len(parsed["items"]), 1)
        self.assertEqual(parsed["items"][0]["size"], "4 x 2 ft")

    def test_extracts_labelled_size_and_weight(self):
        parsed = parse_bill_text([
            "STONE TILE",
            "Size: 4 x 2 ft",
            "Weight: 25 KG",
            "2",
            "500.00",
            "1000.00",
            "Grand Total",
            "1000.00",
        ])

        self.assertEqual(len(parsed["items"]), 1)
        self.assertEqual(parsed["items"][0]["size"], "4 x 2 ft")
        self.assertEqual(parsed["items"][0]["weight"], "25 KG")


class AuthenticationApiTests(APITestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_user(
            username="mahaveeradmin",
            password="Strong-test-password-1",
            is_staff=True,
        )

    def test_business_api_requires_authenticated_admin(self):
        response = self.client.get(reverse("supplier-list"))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_recovery_status_reports_missing_provider_credentials(self):
        response = self.client.get(reverse("auth-recovery-status"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIs(response.json()["otp_configured"], False)

    def test_admin_can_login_and_access_protected_api(self):
        csrf_client = Client(enforce_csrf_checks=True)
        csrf_client.get(reverse("auth-csrf"))
        csrf_token = csrf_client.cookies["csrftoken"].value

        login_response = csrf_client.post(
            reverse("auth-login"),
            data=json.dumps({
                "username": "mahaveeradmin",
                "password": "Strong-test-password-1",
            }),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_token,
        )

        self.assertEqual(login_response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            csrf_client.get(reverse("auth-current-user")).json()["username"],
            "mahaveeradmin",
        )
        self.assertEqual(
            csrf_client.get(reverse("supplier-list")).status_code,
            status.HTTP_200_OK,
        )

    def test_login_requires_csrf_token(self):
        csrf_client = Client(enforce_csrf_checks=True)
        response = csrf_client.post(
            reverse("auth-login"),
            data=json.dumps({
                "username": "mahaveeradmin",
                "password": "Strong-test-password-1",
            }),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_logout_clears_the_authenticated_session(self):
        csrf_client = Client(enforce_csrf_checks=True)
        csrf_client.get(reverse("auth-csrf"))
        token = csrf_client.cookies["csrftoken"].value
        csrf_client.post(
            reverse("auth-login"),
            data=json.dumps({
                "username": "mahaveeradmin",
                "password": "Strong-test-password-1",
            }),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
        )

        logout_token = csrf_client.cookies["csrftoken"].value
        logout_response = csrf_client.post(
            reverse("auth-logout"),
            data="{}",
            content_type="application/json",
            HTTP_X_CSRFTOKEN=logout_token,
        )

        self.assertEqual(logout_response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            csrf_client.get(reverse("auth-current-user")).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_non_staff_user_cannot_login(self):
        user = get_user_model().objects.create_user(
            username="regular",
            password="Strong-test-password-1",
        )
        response = self.client.post(
            reverse("auth-login"),
            {"username": "regular", "password": "Strong-test-password-1"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.client.force_authenticate(user=user)
        protected_response = self.client.get(reverse("supplier-list"))
        self.assertEqual(
            protected_response.status_code,
            status.HTTP_403_FORBIDDEN,
        )

    @patch("core.auth_views.verify_otp")
    @patch("core.auth_views.send_otp")
    def test_admin_can_add_and_verify_recovery_phone(self, send_mock, verify_mock):
        self.client.force_login(self.admin)
        send_response = self.client.post(
            reverse("auth-phone-send-otp"),
            {"phone": "+91 98765 43210"},
            format="json",
        )
        self.assertEqual(send_response.status_code, status.HTTP_200_OK)
        send_mock.assert_called_once_with("919876543210")

        verify_response = self.client.post(
            reverse("auth-phone-verify-otp"),
            {"otp": "123456"},
            format="json",
        )
        self.assertEqual(verify_response.status_code, status.HTTP_200_OK)
        verify_mock.assert_called_once_with("919876543210", "123456")
        profile = AdminProfile.objects.get(user=self.admin)
        self.assertEqual(profile.phone, "919876543210")
        self.assertTrue(profile.phone_verified)

    @patch("core.auth_views.verify_otp")
    def test_phone_otp_can_recover_username(self, verify_mock):
        self.admin.username = "myadmin"
        self.admin.save(update_fields=["username"])
        AdminProfile.objects.create(
            user=self.admin,
            phone="919876543210",
            phone_verified=True,
        )
        response = self.client.post(
            reverse("auth-recovery-complete"),
            {
                "phone": "9876543210",
                "purpose": "username",
                "otp": "123456",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(json.loads(response.content)["username"], "myadmin")
        verify_mock.assert_called_once_with("919876543210", "123456")

    @patch("core.auth_views.verify_otp")
    def test_phone_otp_resets_password(self, verify_mock):
        AdminProfile.objects.create(
            user=self.admin,
            phone="919876543210",
            phone_verified=True,
        )
        response = self.client.post(
            reverse("auth-recovery-complete"),
            {
                "phone": "919876543210",
                "purpose": "password",
                "otp": "123456",
                "new_password": "An-even-stronger-new-password-2!",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.admin.refresh_from_db()
        self.assertTrue(
            self.admin.check_password("An-even-stronger-new-password-2!")
        )
        verify_mock.assert_called_once_with("919876543210", "123456")

    @override_settings(MSG91_AUTH_KEY="", MSG91_OTP_TEMPLATE_ID="")
    def test_recovery_reports_missing_sms_setup_without_account_disclosure(self):
        AdminProfile.objects.create(
            user=self.admin,
            phone="919876543210",
            phone_verified=True,
        )
        responses = []
        for phone in ("919876543210", "919876543211"):
            response = self.client.post(
                reverse("auth-recovery-send-otp"),
                {"phone": phone, "purpose": "username"},
                format="json",
            )
            responses.append((response.status_code, json.loads(response.content)))

        self.assertEqual(responses[0], responses[1])
        self.assertEqual(responses[0][0], status.HTTP_503_SERVICE_UNAVAILABLE)

    def test_username_and_password_change_require_current_password(self):
        self.client.force_login(self.admin)
        wrong_password = self.client.post(
            reverse("auth-update-username"),
            {"username": "newname", "current_password": "wrong"},
            format="json",
        )
        self.assertEqual(wrong_password.status_code, status.HTTP_400_BAD_REQUEST)

        username_response = self.client.post(
            reverse("auth-update-username"),
            {
                "username": "newname",
                "current_password": "Strong-test-password-1",
            },
            format="json",
        )
        self.assertEqual(username_response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            json.loads(username_response.content)["username"],
            "newname",
        )

        password_response = self.client.post(
            reverse("auth-update-password"),
            {
                "current_password": "Strong-test-password-1",
                "new_password": "Another-strong-password-3!",
            },
            format="json",
        )
        self.assertEqual(password_response.status_code, status.HTTP_200_OK)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.check_password("Another-strong-password-3!"))


class CategoryApiTests(AuthenticatedApiTestCase):
    def test_category_list_includes_database_statistics(self):
        category = Category.objects.create(
            name="Metrics Test Category",
            description="Floor tiles",
        )
        product = Product.objects.create(
            name="Test tile",
            category="Metrics Test Category",
        )
        supplier = Supplier.objects.create(name="Tile supplier")
        purchase = Purchase.objects.create(supplier=supplier)
        PurchaseItem.objects.create(
            purchase=purchase,
            product=product,
            quantity=Decimal("3"),
            purchase_price=Decimal("20"),
            total=Decimal("60"),
        )
        sale = Sale.objects.create(
            invoice_number="CAT-001",
            subtotal=Decimal("40"),
            grand_total=Decimal("40"),
        )
        SaleItem.objects.create(
            sale=sale,
            product=product,
            quantity=Decimal("2"),
            selling_price=Decimal("20"),
            total=Decimal("40"),
        )

        response = self.client.get(reverse("category-list"))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        category_data = next(
            item for item in response.data if item["id"] == category.id
        )
        self.assertEqual(category_data["purchase_qty"], "3.00")
        self.assertEqual(category_data["sales_qty"], "2.00")
        self.assertEqual(category_data["purchase_price"], "60.00")
        self.assertEqual(category_data["sales_price"], "40.00")

    def test_category_rename_updates_products_and_delete_is_guarded(self):
        category = Category.objects.create(name="Old name")
        product = Product.objects.create(
            name="Linked product",
            category="Old name",
        )

        response = self.client.patch(
            reverse("category-detail", args=[category.id]),
            {"name": "New name"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        product.refresh_from_db()
        self.assertEqual(product.category, "New name")

        delete_response = self.client.delete(
            reverse("category-detail", args=[category.id])
        )
        self.assertEqual(
            delete_response.status_code,
            status.HTTP_409_CONFLICT,
        )


class SupplierApiTests(AuthenticatedApiTestCase):
    def test_supplier_profile_is_persisted_and_purchase_total_is_aggregated(self):
        supplier = Supplier.objects.create(
            name="Supplier profile",
            contact_person="Contact",
            phone="9876543210",
            email="supplier@example.com",
            city="Cuttack",
            state="Odisha",
            outstanding=Decimal("12.50"),
        )
        Purchase.objects.create(
            supplier=supplier,
            grand_total=Decimal("125.00"),
        )

        response = self.client.get(reverse("supplier-list"))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        supplier_data = response.data[0]
        self.assertEqual(supplier_data["contact_person"], "Contact")
        self.assertEqual(supplier_data["city"], "Cuttack")
        self.assertEqual(supplier_data["outstanding"], "12.50")
        self.assertEqual(supplier_data["total_purchases"], "125.00")

    def test_supplier_delete_is_blocked_when_purchase_history_exists(self):
        supplier = Supplier.objects.create(name="History supplier")
        Purchase.objects.create(supplier=supplier)

        response = self.client.delete(
            reverse("supplier-detail", args=[supplier.id])
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(Supplier.objects.filter(pk=supplier.id).exists())


class PurchaseHistoryApiTests(AuthenticatedApiTestCase):
    def test_purchase_list_returns_history_with_supplier_and_item_details(self):
        supplier = Supplier.objects.create(name="History supplier")
        product = Product.objects.create(
            name="History tile",
            product_code="HIST-001",
            size="600X1200 MM",
            weight="25 KG",
        )
        purchase = Purchase.objects.create(
            supplier=supplier,
            bill_number="HISTORY-001",
            tax=Decimal("5.00"),
            grand_total=Decimal("25.00"),
        )
        PurchaseItem.objects.create(
            purchase=purchase,
            product=product,
            quantity=Decimal("2"),
            purchase_price=Decimal("10.00"),
            total=Decimal("20.00"),
        )

        response = self.client.get(reverse("purchase-list"))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        record = next(
            item for item in response.data if item["id"] == purchase.id
        )
        self.assertEqual(record["supplier_name"], "History supplier")
        self.assertEqual(record["bill_number"], "HISTORY-001")
        self.assertEqual(record["tax"], "5.00")
        self.assertEqual(record["grand_total"], "25.00")
        self.assertEqual(record["items"][0]["product_name"], "History tile")
        self.assertEqual(record["items"][0]["product_code"], "HIST-001")
        self.assertEqual(record["items"][0]["size"], "600X1200 MM")
        self.assertEqual(record["items"][0]["weight"], "25 KG")

    def test_purchase_draft_list_returns_saved_size_and_weight(self):
        draft = PurchaseDraft.objects.create(
            original_supplier_name="OCR supplier",
            supplier_phone="919737326287",
            supplier_gstin="24ACDFA2859E1ZO",
        )
        PurchaseDraftItem.objects.create(
            draft=draft,
            original_product_name="OCR tile",
            size="600X1200 MM",
            weight="25 KG",
            quantity=Decimal("2"),
            purchase_price=Decimal("100.00"),
        )

        response = self.client.get(
            reverse("purchase-draft-detail", args=[draft.id])
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["supplier_phone"], "919737326287")
        self.assertEqual(response.data["supplier_gstin"], "24ACDFA2859E1ZO")
        self.assertEqual(response.data["items"][0]["size"], "600X1200 MM")
        self.assertEqual(response.data["items"][0]["weight"], "25 KG")

    def test_verify_fills_blank_supplier_contact_details_from_ocr(self):
        supplier = Supplier.objects.create(name="OCR supplier")
        draft = PurchaseDraft.objects.create(
            supplier=supplier,
            original_supplier_name="OCR supplier",
            supplier_phone="919737326287",
            supplier_gstin="24ACDFA2859E1ZO",
        )
        item = PurchaseDraftItem.objects.create(
            draft=draft,
            original_product_name="OCR tile",
            quantity=Decimal("1"),
            purchase_price=Decimal("100.00"),
        )

        response = self.client.post(
            reverse("purchase-draft-verify-draft", args=[draft.id]),
            {
                "supplier_id": supplier.id,
                "items": [{"id": item.id, "selling_price": 150}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        supplier.refresh_from_db()
        self.assertEqual(supplier.phone, "919737326287")
        self.assertEqual(supplier.gstin, "24ACDFA2859E1ZO")

    def test_verify_does_not_overwrite_existing_supplier_contact_details(self):
        supplier = Supplier.objects.create(
            name="OCR supplier",
            phone="9876543210",
            gstin="21ABCDE1234F1Z5",
        )
        draft = PurchaseDraft.objects.create(
            supplier=supplier,
            original_supplier_name="OCR supplier",
            supplier_phone="919737326287",
            supplier_gstin="24ACDFA2859E1ZO",
        )
        item = PurchaseDraftItem.objects.create(
            draft=draft,
            original_product_name="OCR tile",
            quantity=Decimal("1"),
            purchase_price=Decimal("100.00"),
        )

        response = self.client.post(
            reverse("purchase-draft-verify-draft", args=[draft.id]),
            {
                "supplier_id": supplier.id,
                "items": [{"id": item.id, "selling_price": 150}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        supplier.refresh_from_db()
        self.assertEqual(supplier.phone, "9876543210")
        self.assertEqual(supplier.gstin, "21ABCDE1234F1Z5")


class PurchaseConfirmationTests(AuthenticatedApiTestCase):
    def test_confirm_updates_stock_once_and_reports_confirmation(self):
        supplier = Supplier.objects.create(name="Confirm supplier")
        product = Product.objects.create(
            name="Confirm tile",
            stock=Decimal("3"),
        )
        purchase = Purchase.objects.create(supplier=supplier)
        PurchaseItem.objects.create(
            purchase=purchase,
            product=product,
            quantity=Decimal("2"),
            purchase_price=Decimal("50"),
            total=Decimal("100"),
        )
        confirm_url = reverse(
            "purchase-confirm-purchase",
            args=[purchase.id],
        )

        response = self.client.post(confirm_url, {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["is_confirmed"])
        self.assertTrue(response.data["stock_updated"])
        product.refresh_from_db()
        self.assertEqual(product.stock, Decimal("5"))

        repeated_response = self.client.post(
            confirm_url,
            {},
            format="json",
        )

        self.assertEqual(repeated_response.status_code, status.HTTP_200_OK)
        self.assertFalse(repeated_response.data["stock_updated"])
        product.refresh_from_db()
        self.assertEqual(product.stock, Decimal("5"))


class ProductDeleteTests(AuthenticatedApiTestCase):
    def setUp(self):
        super().setUp()
        self.product = Product.objects.create(name="Demo tile")
        self.delete_url = reverse(
            "product-detail",
            args=[self.product.id],
        )

    def test_delete_removes_matching_draft_item_and_keeps_draft(self):
        draft = PurchaseDraft.objects.create(
            original_supplier_name="Demo supplier",
        )
        matching_item = PurchaseDraftItem.objects.create(
            draft=draft,
            original_product_name="Demo tile",
            matched_product=self.product,
        )
        other_item = PurchaseDraftItem.objects.create(
            draft=draft,
            original_product_name="Other tile",
        )

        response = self.client.delete(self.delete_url)

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Product.objects.filter(pk=self.product.pk).exists())
        self.assertFalse(
            PurchaseDraftItem.objects.filter(pk=matching_item.pk).exists()
        )
        self.assertTrue(PurchaseDraftItem.objects.filter(pk=other_item.pk).exists())
        self.assertTrue(PurchaseDraft.objects.filter(pk=draft.pk).exists())

    def test_delete_is_blocked_when_product_has_purchase_history(self):
        supplier = Supplier.objects.create(name="Demo supplier")
        purchase = Purchase.objects.create(supplier=supplier)
        purchase_item = PurchaseItem.objects.create(
            purchase=purchase,
            product=self.product,
            quantity=Decimal("2"),
            purchase_price=Decimal("10"),
            total=Decimal("20"),
        )

        response = self.client.delete(self.delete_url)

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("purchase or sales history", response.data["detail"])
        self.assertTrue(Product.objects.filter(pk=self.product.pk).exists())
        self.assertTrue(PurchaseItem.objects.filter(pk=purchase_item.pk).exists())

    def test_delete_removes_product_without_history(self):
        response = self.client.delete(self.delete_url)

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Product.objects.filter(pk=self.product.pk).exists())


class DashboardSummaryTests(AuthenticatedApiTestCase):
    def test_dashboard_returns_live_database_aggregates(self):
        product = Product.objects.create(
            name="Dashboard tile",
            category="Tiles",
            stock=Decimal("4"),
            low_stock_limit=Decimal("5"),
        )
        customer = Customer.objects.create(name="Dashboard customer")
        sale = Sale.objects.create(
            customer=customer,
            invoice_number="DASH-001",
            subtotal=Decimal("100"),
            grand_total=Decimal("118"),
        )
        SaleItem.objects.create(
            sale=sale,
            product=product,
            quantity=Decimal("2"),
            selling_price=Decimal("50"),
            total=Decimal("100"),
        )
        supplier = Supplier.objects.create(name="Dashboard supplier")
        Purchase.objects.create(
            supplier=supplier,
            bill_number="DASH-PUR-001",
            grand_total=Decimal("90"),
        )

        response = self.client.get(
            reverse("dashboard-summary"),
            {"days": 7},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["summary"]["sales_this_month"], "118.00")
        self.assertEqual(response.data["summary"]["sales_count_this_month"], 1)
        self.assertEqual(response.data["summary"]["purchases_this_month"], "90.00")
        self.assertEqual(response.data["summary"]["product_count"], 1)
        self.assertEqual(response.data["summary"]["customer_count"], 1)
        self.assertEqual(len(response.data["sales_chart"]), 7)
        self.assertEqual(response.data["sales_by_category"][0]["category"], "Tiles")
        self.assertEqual(response.data["recent_sales"][0]["invoice_number"], "DASH-001")
        self.assertEqual(
            response.data["recent_sales"][0]["customer_id"],
            customer.id,
        )
        self.assertEqual(
            response.data["recent_sales"][0]["customer_name"],
            customer.name,
        )
        self.assertEqual(response.data["recent_products"][0]["id"], product.id)
        self.assertEqual(response.data["low_stock_products"][0]["id"], product.id)

    def test_dashboard_rejects_unsupported_period(self):
        response = self.client.get(
            reverse("dashboard-summary"),
            {"days": 14},
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class SalesAndReportTests(AuthenticatedApiTestCase):
    def setUp(self):
        super().setUp()
        self.customer = Customer.objects.create(
            name="Report customer",
            phone="9876543210",
        )
        self.product = Product.objects.create(
            name="Report tile",
            product_code="REPORT-TILE",
            size="600x1200",
            weight="25 KG",
            purchase_price=Decimal("20.00"),
            selling_price=Decimal("50.00"),
            stock=Decimal("10.00"),
        )

    def test_sale_api_returns_nested_lines_and_saves_historical_cost(self):
        response = self.client.post(
            reverse("sale-list"),
            {
                "customer": self.customer.id,
                "invoice_number": "REPORT-SALE-001",
                "discount": "10.00",
                "payment_method": "Cash",
                "items": [{
                    "product": self.product.id,
                    "quantity": "2.00",
                    "selling_price": "50.00",
                }],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(response.data["items"]), 1)
        self.assertEqual(response.data["items"][0]["size"], "600x1200")
        self.assertEqual(response.data["items"][0]["weight"], "25 KG")
        self.assertEqual(response.data["items"][0]["purchase_cost"], "20.00")

        sale_item = SaleItem.objects.get(sale_id=response.data["id"])
        self.assertEqual(sale_item.purchase_cost, Decimal("20.00"))

        list_response = self.client.get(reverse("sale-list"))
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(list_response.data[0]["items"]), 1)

    def test_sale_creates_customer_and_reuses_matching_phone(self):
        payload = {
            "new_customer_name": "Walk-in Sales Customer",
            "customer_phone": "9876501234",
            "customer_address": "Main Road",
            "invoice_number": "CUSTOMER-SALE-001",
            "items": [{
                "product": self.product.id,
                "quantity": "1.00",
                "selling_price": "50.00",
            }],
        }
        first_response = self.client.post(
            reverse("sale-list"),
            payload,
            format="json",
        )

        self.assertEqual(first_response.status_code, status.HTTP_201_CREATED)
        created_customer = Customer.objects.get(phone="9876501234")
        self.assertEqual(first_response.data["customer"], created_customer.id)
        self.assertEqual(first_response.data["customer_name"], "Walk-in Sales Customer")

        payload.update({
            "new_customer_name": "Same Customer",
            "customer_address": "Updated Address",
            "invoice_number": "CUSTOMER-SALE-002",
        })
        second_response = self.client.post(
            reverse("sale-list"),
            payload,
            format="json",
        )

        self.assertEqual(second_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second_response.data["customer"], created_customer.id)
        self.assertEqual(
            Customer.objects.filter(phone="9876501234").count(),
            1,
        )

    def test_confirmed_sale_invoice_downloads_professional_tax_free_pdf(self):
        sale_response = self.client.post(
            reverse("sale-list"),
            {
                "customer": self.customer.id,
                "invoice_number": "INVOICE-PDF-001",
                "payment_method": "Cash",
                "items": [{
                    "product": self.product.id,
                    "quantity": "2.00",
                    "selling_price": "50.00",
                }],
            },
            format="json",
        )
        self.assertEqual(sale_response.status_code, status.HTTP_201_CREATED)
        sale_id = sale_response.data["id"]

        unconfirmed_response = self.client.get(
            f"/api/sales/{sale_id}/invoice/"
        )
        self.assertEqual(unconfirmed_response.status_code, status.HTTP_400_BAD_REQUEST)

        confirm_response = self.client.post(
            f"/api/sales/{sale_id}/confirm/"
        )
        self.assertEqual(confirm_response.status_code, status.HTTP_200_OK)

        invoice_response = self.client.get(
            f"/api/sales/{sale_id}/invoice/"
        )
        self.assertEqual(invoice_response.status_code, status.HTTP_200_OK)
        self.assertEqual(invoice_response["Content-Type"], "application/pdf")
        self.assertIn("attachment;", invoice_response["Content-Disposition"])
        self.assertIn(
            f"Report-customer-INVOICE-PDF-001-{sale_id}.pdf",
            invoice_response["Content-Disposition"],
        )
        self.assertTrue(invoice_response.content.startswith(b"%PDF"))
        invoice_text = "\n".join(
            page.get_text()
            for page in fitz.open(
                stream=invoice_response.content,
                filetype="pdf",
            )
        )
        for expected_text in (
            "SALES INVOICE",
            "ORIGINAL COPY",
            "Billing Details",
            "Invoice Details",
            "INVOICE-PDF-001",
            "Product Code",
            "Item Description",
            "Unit Price",
            "Grand Total",
            "Payment Method",
            "Amount in Words",
            "Authorized Signature",
            "GST is not charged",
        ):
            self.assertIn(expected_text, invoice_text)

        another_customer = Customer.objects.create(
            name="Another invoice customer",
            phone="9000011111",
        )
        another_sale_response = self.client.post(
            reverse("sale-list"),
            {
                "customer": another_customer.id,
                "invoice_number": "INVOICE-PDF-002",
                "payment_method": "UPI",
                "items": [{
                    "product": self.product.id,
                    "quantity": "1.00",
                    "selling_price": "50.00",
                }],
            },
            format="json",
        )
        self.assertEqual(
            another_sale_response.status_code,
            status.HTTP_201_CREATED,
        )
        another_sale_id = another_sale_response.data["id"]
        self.client.post(f"/api/sales/{another_sale_id}/confirm/")
        another_invoice_response = self.client.get(
            f"/api/sales/{another_sale_id}/invoice/"
        )

        self.assertEqual(another_invoice_response.status_code, status.HTTP_200_OK)
        self.assertIn(
            f"Another-invoice-customer-INVOICE-PDF-002-{another_sale_id}.pdf",
            another_invoice_response["Content-Disposition"],
        )
        self.assertNotEqual(
            invoice_response["Content-Disposition"],
            another_invoice_response["Content-Disposition"],
        )

    def test_report_applies_returns_to_revenue_and_cost(self):
        sale_response = self.client.post(
            reverse("sale-list"),
            {
                "customer": self.customer.id,
                "invoice_number": "REPORT-SALE-002",
                "discount": "10.00",
                "payment_method": "UPI",
                "items": [{
                    "product": self.product.id,
                    "quantity": "2.00",
                    "selling_price": "50.00",
                }],
            },
            format="json",
        )
        self.assertEqual(sale_response.status_code, status.HTTP_201_CREATED)
        sale_id = sale_response.data["id"]
        self.client.post(f"/api/sales/{sale_id}/confirm/")
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, Decimal("8.00"))

        return_response = self.client.post(
            reverse("sale-return-list"),
            {
                "sale": sale_id,
                "reason": "One box returned",
                "items": [{
                    "product": self.product.id,
                    "quantity": "1.00",
                }],
            },
            format="json",
        )
        self.assertEqual(return_response.status_code, status.HTTP_201_CREATED)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, Decimal("9.00"))

        today = timezone.localdate().isoformat()
        report_response = self.client.get(
            reverse("business-report"),
            {"from": today, "to": today},
        )

        self.assertEqual(report_response.status_code, status.HTTP_200_OK)
        summary = report_response.data["summary"]
        self.assertEqual(summary["sales_revenue"], "90.00")
        self.assertEqual(summary["return_value"], "45.00")
        self.assertEqual(summary["net_revenue"], "45.00")
        self.assertEqual(summary["cost_of_goods_sold"], "20.00")
        self.assertEqual(summary["gross_profit"], "25.00")
        self.assertTrue(report_response.data["cost_basis_complete"])

    def test_report_rejects_invalid_date_range(self):
        response = self.client.get(
            reverse("business-report"),
            {"from": "2026-02-02", "to": "2026-02-01"},
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

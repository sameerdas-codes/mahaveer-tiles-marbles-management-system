import json
import re

from django.conf import settings
from django.contrib.auth import (
    authenticate,
    login,
    logout,
    update_session_auth_hash,
    get_user_model,
)
from django.contrib.auth.password_validation import validate_password
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from .models import AdminPhoneChallenge, AdminProfile
from .services.msg91 import Msg91Error, send_otp, verify_otp

User = get_user_model()
OTP_SEND_COOLDOWN_SECONDS = 60
PHONE_CHALLENGE_LIFETIME_SECONDS = 300


@ensure_csrf_cookie
@require_GET
def csrf_token(request):
    return JsonResponse({"csrfToken": get_token(request)})


@csrf_protect
@require_POST
def login_view(request):
    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"detail": "Invalid request body."}, status=400)

    if not isinstance(payload, dict):
        return JsonResponse({"detail": "Invalid request body."}, status=400)

    username = str(payload.get("username", "")).strip()
    password = payload.get("password", "")
    if not isinstance(password, str):
        return JsonResponse(
            {"detail": "Invalid username or password."},
            status=400,
        )

    user = authenticate(
        request,
        username=username,
        password=password,
    )
    if user is None or not user.is_active or not user.is_staff:
        return JsonResponse(
            {"detail": "Invalid username or password."},
            status=400,
        )

    login(request, user)
    return JsonResponse({"username": user.get_username()})


@require_GET
def current_user(request):
    if (
        not request.user.is_authenticated
        or not request.user.is_active
        or not request.user.is_staff
    ):
        return JsonResponse({"detail": "Authentication required."}, status=401)

    return JsonResponse({"username": request.user.get_username()})


@csrf_protect
@require_POST
def logout_view(request):
    logout(request)
    return JsonResponse({"detail": "Logged out."})


def _payload(request):
    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _admin_user(request):
    user = request.user
    return user if user.is_authenticated and user.is_active and user.is_staff else None


def _json_error(message, status=400):
    return JsonResponse({"detail": message}, status=status)


def _normalize_phone(value):
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) == 10 and digits[0] in "6789":
        digits = f"91{digits}"
    if len(digits) != 12 or not digits.startswith("91"):
        return ""
    return digits


def _masked_phone(phone):
    return f"+91 ******{phone[-4:]}" if phone else ""


def _send_otp_with_cooldown(phone):
    key = f"admin-otp:{phone}"
    if not cache.add(key, True, timeout=OTP_SEND_COOLDOWN_SECONDS):
        raise Msg91Error("Please wait before requesting another OTP.")
    try:
        send_otp(phone)
    except Msg91Error:
        cache.delete(key)
        raise


def _profile_for(user):
    profile, _ = AdminProfile.objects.get_or_create(user=user)
    return profile


@require_GET
def recovery_status(request):
    return JsonResponse({
        "otp_configured": bool(
            settings.MSG91_AUTH_KEY and settings.MSG91_OTP_TEMPLATE_ID
        ),
    })


@require_GET
def account_profile(request):
    user = _admin_user(request)
    if user is None:
        return _json_error("Authentication required.", status=401)
    profile = _profile_for(user)
    return JsonResponse({
        "username": user.get_username(),
        "phone": _masked_phone(profile.phone),
        "phone_verified": profile.phone_verified,
        "has_phone": bool(profile.phone),
    })


@csrf_protect
@require_POST
def update_username(request):
    user = _admin_user(request)
    if user is None:
        return _json_error("Authentication required.", status=401)
    payload = _payload(request)
    if payload is None:
        return _json_error("Invalid request body.")

    username = str(payload.get("username", "")).strip()
    current_password = payload.get("current_password", "")
    if not username or len(username) > 150 or not isinstance(current_password, str):
        return _json_error("Enter a valid username and current password.")
    try:
        User._meta.get_field(User.USERNAME_FIELD).run_validators(username)
    except ValidationError as error:
        return JsonResponse({"detail": list(error.messages)}, status=400)
    if not user.check_password(current_password):
        return _json_error("Current password is incorrect.")
    if User.objects.exclude(pk=user.pk).filter(username__iexact=username).exists():
        return _json_error("That username is already in use.")

    user.username = username
    user.save(update_fields=["username"])
    return JsonResponse({"username": user.get_username()})


@csrf_protect
@require_POST
def update_password(request):
    user = _admin_user(request)
    if user is None:
        return _json_error("Authentication required.", status=401)
    payload = _payload(request)
    if payload is None:
        return _json_error("Invalid request body.")
    current_password = payload.get("current_password", "")
    new_password = payload.get("new_password", "")
    if not isinstance(current_password, str) or not isinstance(new_password, str):
        return _json_error("Enter valid password values.")
    if not user.check_password(current_password):
        return _json_error("Current password is incorrect.")
    try:
        validate_password(new_password, user=user)
    except ValidationError as error:
        return JsonResponse({"detail": list(error.messages)}, status=400)

    user.set_password(new_password)
    user.save(update_fields=["password"])
    update_session_auth_hash(request, user)
    return JsonResponse({"detail": "Password updated successfully."})


@csrf_protect
@require_POST
def send_phone_otp(request):
    user = _admin_user(request)
    if user is None:
        return _json_error("Authentication required.", status=401)
    payload = _payload(request)
    phone = _normalize_phone(payload.get("phone") if payload else "")
    if not phone:
        return _json_error("Enter a valid Indian mobile number.")

    try:
        _send_otp_with_cooldown(phone)
    except Msg91Error as error:
        return _json_error(str(error), status=503)

    AdminPhoneChallenge.objects.update_or_create(
        user=user,
        defaults={"phone": phone},
    )
    return JsonResponse({"detail": "OTP sent to the mobile number."})


@csrf_protect
@require_POST
def verify_phone_otp(request):
    user = _admin_user(request)
    if user is None:
        return _json_error("Authentication required.", status=401)
    payload = _payload(request)
    otp = str(payload.get("otp", "")).strip() if payload else ""
    if not re.fullmatch(r"\d{4,8}", otp):
        return _json_error("Enter the OTP sent to your mobile number.")

    challenge = AdminPhoneChallenge.objects.filter(user=user).first()
    if (
        challenge is None
        or (timezone.now() - challenge.created_at).total_seconds()
        > PHONE_CHALLENGE_LIFETIME_SECONDS
    ):
        if challenge:
            challenge.delete()
        return _json_error("OTP expired. Request a new OTP.")

    try:
        verify_otp(challenge.phone, otp)
    except Msg91Error as error:
        return _json_error(str(error), status=400)

    profile = _profile_for(user)
    profile.phone = challenge.phone
    profile.phone_verified = True
    profile.save(update_fields=["phone", "phone_verified"])
    challenge.delete()
    return JsonResponse({
        "detail": "Recovery phone verified successfully.",
        "phone": _masked_phone(profile.phone),
        "phone_verified": True,
    })


@csrf_protect
@require_POST
def send_recovery_otp(request):
    payload = _payload(request)
    if payload is None:
        return _json_error("Invalid request body.")
    phone = _normalize_phone(payload.get("phone"))
    purpose = payload.get("purpose")
    if (
        not phone
        or not isinstance(purpose, str)
        or purpose not in {"username", "password"}
    ):
        return _json_error("Enter a valid mobile number and recovery option.")

    generic_response = {
        "detail": (
            "If a verified admin account matches that phone, "
            "an OTP will be sent."
        )
    }
    if not settings.MSG91_AUTH_KEY or not settings.MSG91_OTP_TEMPLATE_ID:
        return _json_error(
            "OTP recovery is unavailable until MSG91 is configured.",
            status=503,
        )

    profile = (
        AdminProfile.objects
        .select_related("user")
        .filter(
            phone=phone,
            phone_verified=True,
            user__is_active=True,
            user__is_staff=True,
        )
        .first()
    )
    if profile is None:
        return JsonResponse(generic_response)

    try:
        _send_otp_with_cooldown(phone)
    except Msg91Error as error:
        return _json_error(str(error), status=503)

    return JsonResponse(generic_response)


@csrf_protect
@require_POST
def complete_recovery(request):
    payload = _payload(request)
    if payload is None:
        return _json_error("Invalid request body.")
    phone = _normalize_phone(payload.get("phone"))
    purpose = payload.get("purpose")
    otp = str(payload.get("otp", "")).strip()
    if (
        not phone
        or not isinstance(purpose, str)
        or purpose not in {"username", "password"}
        or not re.fullmatch(r"\d{4,8}", otp)
    ):
        return _json_error("Enter valid recovery details.")

    profile = (
        AdminProfile.objects
        .select_related("user")
        .filter(
            phone=phone,
            phone_verified=True,
            user__is_active=True,
            user__is_staff=True,
        )
        .first()
    )
    if profile is None:
        return _json_error("OTP or recovery details are invalid.", status=400)

    if purpose == "password":
        new_password = payload.get("new_password", "")
        if not isinstance(new_password, str):
            return _json_error("Enter a valid new password.")
        try:
            validate_password(new_password, user=profile.user)
        except ValidationError as error:
            return JsonResponse({"detail": list(error.messages)}, status=400)

    try:
        verify_otp(phone, otp)
    except Msg91Error:
        return _json_error("OTP or recovery details are invalid.", status=400)

    if purpose == "username":
        return JsonResponse({"username": profile.user.get_username()})

    profile.user.set_password(new_password)
    profile.user.save(update_fields=["password"])
    return JsonResponse({"detail": "Password reset successfully."})

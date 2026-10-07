import requests

from django.conf import settings


MSG91_OTP_URL = "https://control.msg91.com/api/v5/otp"
REQUEST_TIMEOUT = (3, 10)


class Msg91Error(Exception):
    pass


def _request_otp_api(url, params):
    auth_key = settings.MSG91_AUTH_KEY
    if not auth_key or not settings.MSG91_OTP_TEMPLATE_ID:
        raise Msg91Error(
            "MSG91 is not configured. Set MSG91_AUTH_KEY and "
            "MSG91_OTP_TEMPLATE_ID in backend/.env."
        )

    try:
        response = requests.get(
            url,
            params=params,
            headers={"authkey": auth_key},
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as error:
        raise Msg91Error("OTP service is temporarily unavailable.") from error

    try:
        data = response.json()
    except ValueError as error:
        raise Msg91Error("OTP service returned an invalid response.") from error

    if not isinstance(data, dict):
        raise Msg91Error("OTP service returned an invalid response.")
    if not response.ok or str(data.get("type", "")).lower() != "success":
        raise Msg91Error(
            str(data.get("message") or "OTP request failed.")
        )
    return data


def send_otp(phone):
    return _request_otp_api(
        MSG91_OTP_URL,
        {
            "template_id": settings.MSG91_OTP_TEMPLATE_ID,
            "mobile": phone,
            "otp_length": 6,
            "otp_expiry": 5,
        },
    )


def verify_otp(phone, otp):
    return _request_otp_api(
        f"{MSG91_OTP_URL}/verify",
        {
            "mobile": phone,
            "otp": otp,
        },
    )

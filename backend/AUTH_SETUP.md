# Admin account recovery setup

1. In MSG91, configure the OTP service and an approved OTP template containing
   the `##OTP##` variable.
2. Add `MSG91_AUTH_KEY` and `MSG91_OTP_TEMPLATE_ID` to `backend/.env`.
   Do not commit the real credentials or share them in chat.
3. Restart Django, sign in as an administrator, open **Account**, add the
   recovery mobile number, and verify it with the OTP.
4. The verified number can then recover the admin username or reset the
   password from the sign-in screen.

OTP recovery intentionally does not work until MSG91 is configured and a
recovery phone has been verified. Account changes require the current password;
passwords are checked using Django's configured validators.

import { useEffect, useState } from "react";
import { apiFetch } from "../api/api";

function AccountSettings({ onClose, onUsernameUpdated }) {
  const [profile, setProfile] = useState(null);
  const [otpConfigured, setOtpConfigured] = useState(null);
  const [username, setUsername] = useState("");
  const [currentUsernamePassword, setCurrentUsernamePassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [phoneOtpSent, setPhoneOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([
      apiFetch("/api/auth/account/"),
      apiFetch("/api/auth/recovery/status/"),
    ])
      .then(async ([profileResponse, statusResponse]) => {
        const [data, statusData] = await Promise.all([
          profileResponse.json(),
          statusResponse.json(),
        ]);
        if (!profileResponse.ok) {
          throw new Error(data.detail || "Could not load account.");
        }
        if (!statusResponse.ok) {
          throw new Error(statusData.detail || "Could not check recovery setup.");
        }
        if (active) {
          setProfile(data);
          setUsername(data.username);
          setOtpConfigured(statusData.otp_configured);
        }
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || "Could not load account.");
      });
    return () => { active = false; };
  }, []);

  const submitRequest = async (url, payload, onSuccess) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await apiFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(Array.isArray(data.detail) ? data.detail.join(" ") : data.detail);
      }
      onSuccess(data);
    } catch (requestError) {
      setError(requestError.message || "Request failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="account-modal" role="dialog" aria-modal="true" aria-labelledby="account-title">
        <header className="account-modal-header">
          <div>
            <span>ADMIN SECURITY</span>
            <h2 id="account-title">Account settings</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close account settings">×</button>
        </header>

        {profile && (
          <div className="account-phone-status">
            <strong>Recovery phone</strong>
            <span>
              {profile.phone_verified ? profile.phone : "Not verified"}
              {profile.phone_verified ? " · Verified" : ""}
            </span>
          </div>
        )}

        {otpConfigured === false && (
          <p className="account-setup-warning" role="status">
            Phone verification and forgot-account recovery need MSG91 OTP
            credentials. Add <code>MSG91_AUTH_KEY</code> and{" "}
            <code>MSG91_OTP_TEMPLATE_ID</code> to <code>backend/.env</code>,
            then restart the backend. Setup steps are in{" "}
            <code>backend/AUTH_SETUP.md</code>.
          </p>
        )}

        <form className="account-form" onSubmit={(event) => {
          event.preventDefault();
          submitRequest("/api/auth/account/username/", {
            username,
            current_password: currentUsernamePassword,
          }, (data) => {
            setCurrentUsernamePassword("");
            onUsernameUpdated(data.username);
            setMessage("Username updated.");
          });
        }}>
          <h3>Change username</h3>
          <label htmlFor="account-username">New username</label>
          <input id="account-username" value={username} onChange={(event) => setUsername(event.target.value)} required />
          <label htmlFor="username-current-password">Confirm with current password</label>
          <input id="username-current-password" type="password" autoComplete="current-password" value={currentUsernamePassword} onChange={(event) => setCurrentUsernamePassword(event.target.value)} required />
          <button disabled={busy}>Update username</button>
        </form>

        <form className="account-form" onSubmit={(event) => {
          event.preventDefault();
          submitRequest("/api/auth/account/password/", {
            current_password: currentPassword,
            new_password: newPassword,
          }, () => {
            setCurrentPassword("");
            setNewPassword("");
            setMessage("Password updated securely.");
          });
        }}>
          <h3>Change password</h3>
          <label htmlFor="password-current">Current password</label>
          <input id="password-current" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
          <label htmlFor="password-new">New password</label>
          <input id="password-new" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
          <button disabled={busy}>Update password</button>
        </form>

        <form className="account-form" onSubmit={(event) => {
          event.preventDefault();
          if (!phoneOtpSent) {
            submitRequest("/api/auth/account/phone/send-otp/", { phone }, (data) => {
              setPhoneOtpSent(true);
              setMessage(data.detail);
            });
          } else {
            submitRequest("/api/auth/account/phone/verify-otp/", { otp }, (data) => {
              setProfile((previous) => ({ ...previous, phone: data.phone, phone_verified: true, has_phone: true }));
              setPhoneOtpSent(false);
              setPhone("");
              setOtp("");
              setMessage(data.detail);
            });
          }
        }}>
          <h3>{profile?.phone_verified ? "Update recovery phone" : "Add recovery phone"}</h3>
          {!phoneOtpSent ? (
            <>
              <label htmlFor="account-phone">Indian mobile number</label>
              <input id="account-phone" type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+91 98765 43210" required />
            </>
          ) : (
            <>
              <p className="account-help">Enter the OTP sent to {phone}.</p>
              <label htmlFor="account-phone-otp">One-time password</label>
              <input id="account-phone-otp" inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(event) => setOtp(event.target.value)} required />
            </>
          )}
          <button disabled={busy || otpConfigured === false}>{busy ? "Please wait..." : phoneOtpSent ? "Verify phone" : "Send verification OTP"}</button>
        </form>

        {error && <p className="account-error" role="alert">{error}</p>}
        {message && <p className="account-message" role="status">{message}</p>}
        <p className="account-help">Forgot username/password recovery is enabled only after this phone number is verified.</p>
      </section>
    </div>
  );
}

export default AccountSettings;

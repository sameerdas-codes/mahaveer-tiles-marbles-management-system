import { useState } from "react";
import { apiFetch } from "../api/api";
import "../Auth.css";

function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryComplete, setRecoveryComplete] = useState(false);
  const [otpConfigured, setOtpConfigured] = useState(null);

  const openRecovery = async (purpose) => {
    setRecoveryMode(purpose);
    setError("");
    setRecoveryMessage("");
    setRecoveryComplete(false);
    setOtpConfigured(null);
    try {
      const response = await apiFetch("/api/auth/recovery/status/");
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Could not check recovery setup.");
      }
      setOtpConfigured(data.otp_configured);
    } catch (statusError) {
      setError(statusError.message || "Could not check recovery setup.");
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const response = await apiFetch("/api/auth/login/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Login nahi ho saka.");
      }

      onLogin(data.username);
    } catch (loginError) {
      setError(loginError.message || "Login nahi ho saka.");
    } finally {
      setSubmitting(false);
    }
  };

  const sendRecoveryOtp = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setRecoveryMessage("");
    setOtp("");
    try {
      const response = await apiFetch("/api/auth/recovery/send-otp/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, purpose: recoveryMode }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          Array.isArray(data.detail) ? data.detail.join(" ") : data.detail,
        );
      }
      setRecoveryMessage(data.detail);
    } catch (recoveryError) {
      setError(recoveryError.message || "OTP could not be requested.");
    } finally {
      setSubmitting(false);
    }
  };

  const completeRecovery = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setRecoveryMessage("");
    try {
      const response = await apiFetch("/api/auth/recovery/complete/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          otp,
          purpose: recoveryMode,
          ...(recoveryMode === "password"
            ? { new_password: newPassword }
            : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          Array.isArray(data.detail) ? data.detail.join(" ") : data.detail,
        );
      }
      if (recoveryMode === "username") {
        setUsername(data.username);
        setRecoveryMessage(`Your username is ${data.username}.`);
      } else {
        setRecoveryMessage("Password reset. You can now sign in.");
        setPassword("");
      }
      setRecoveryComplete(true);
      setOtp("");
      setNewPassword("");
    } catch (recoveryError) {
      setError(recoveryError.message || "Recovery could not be completed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="admin-login-page">
      <section className="admin-login-card">
        <div className="admin-login-brand">
          <div className="admin-login-mark">M</div>
          <div>
            <p>MAHAVEER TILES &amp; MARBELS</p>
            <span>Management System</span>
          </div>
        </div>

        {!recoveryMode ? (
          <>
            <div className="admin-login-heading">
              <span>ADMIN ACCESS</span>
              <h1>Welcome back</h1>
              <p>Sign in to manage your business workspace.</p>
            </div>

            <form className="admin-login-form" onSubmit={handleSubmit}>
              <label htmlFor="admin-username">Username</label>
              <input
                id="admin-username"
                name="username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Enter your username"
                required
                autoFocus
              />

              <label htmlFor="admin-password">Password</label>
              <input
                id="admin-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                required
              />

              {error && <p className="admin-login-error" role="alert">{error}</p>}

              <button type="submit" disabled={submitting || otpConfigured === false}>
                {submitting ? "Signing in..." : "Sign in"}
              </button>
            </form>
            <div className="admin-recovery-links">
              <button type="button" onClick={() => openRecovery("username")}>
                Forgot username?
              </button>
              <button type="button" onClick={() => openRecovery("password")}>
                Forgot password?
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="admin-login-heading">
              <span>ACCOUNT RECOVERY</span>
              <h1>{recoveryMode === "username" ? "Recover username" : "Reset password"}</h1>
              <p>Verify the mobile number registered to your admin account.</p>
            </div>
            {otpConfigured === false && (
              <p className="admin-recovery-setup" role="status">
                Phone recovery is not configured yet. Add MSG91 credentials to
                <code> backend/.env</code> and restart Django. See{" "}
                <code>backend/AUTH_SETUP.md</code>.
              </p>
            )}
            {recoveryComplete && (
              <p className="admin-recovery-message" role="status">
                {recoveryMessage}
              </p>
            )}
            {!recoveryComplete && (
            <form className="admin-login-form" onSubmit={recoveryMessage && otp ? completeRecovery : sendRecoveryOtp}>
              <label htmlFor="recovery-phone">Registered mobile number</label>
              <input
                id="recovery-phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+91 98765 43210"
                required
              />
              {recoveryMessage && (
                <>
                  <p className="admin-recovery-message" role="status">{recoveryMessage}</p>
                  <button className="admin-recovery-resend" type="button" disabled={submitting} onClick={sendRecoveryOtp}>
                    Resend OTP
                  </button>
                  <label htmlFor="recovery-otp">One-time password</label>
                  <input
                    id="recovery-otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={otp}
                    onChange={(event) => setOtp(event.target.value)}
                    placeholder="Enter OTP"
                    required
                  />
                  {recoveryMode === "password" && (
                    <>
                      <label htmlFor="recovery-new-password">New password</label>
                      <input
                        id="recovery-new-password"
                        type="password"
                        autoComplete="new-password"
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        placeholder="Choose a new password"
                        required
                      />
                    </>
                  )}
                </>
              )}
              {error && <p className="admin-login-error" role="alert">{error}</p>}
              <button type="submit" disabled={submitting}>
                {submitting ? "Please wait..." : recoveryMessage && otp ? "Verify and continue" : "Send recovery OTP"}
              </button>
            </form>
            )}
            <button
              className="admin-recovery-back"
              type="button"
              onClick={() => { setRecoveryMode(""); setRecoveryMessage(""); setRecoveryComplete(false); setError(""); setOtp(""); }}
            >
              Back to sign in
            </button>
          </>
        )}

        <p className="admin-login-footer">
          Secure administrator sign-in
        </p>
      </section>
    </main>
  );
}

export default Login;

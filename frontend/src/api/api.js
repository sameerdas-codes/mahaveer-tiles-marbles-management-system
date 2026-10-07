const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function getCsrfToken() {
  const cookie = document.cookie
    .split("; ")
    .find((value) => value.startsWith("csrftoken="));

  return cookie ? decodeURIComponent(cookie.split("=")[1]) : "";
}

export async function apiFetch(input, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  const csrfToken = getCsrfToken();

  if (!SAFE_METHODS.has(method) && csrfToken) {
    headers.set("X-CSRFToken", csrfToken);
  }

  return fetch(input, {
    ...options,
    credentials: "same-origin",
    headers,
  });
}
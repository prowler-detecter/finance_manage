const API_BASE = "/api";

export async function apiRequest(path, options = {}) {
  const token = localStorage.getItem("finance_token");
  const headers = {
    ...(options.headers || {})
  };
  const hasBody = options.body !== undefined && options.body !== null;
  const hasContentTypeHeader = Object.keys(headers).some((key) => key.toLowerCase() === "content-type");

  if (hasBody && !hasContentTypeHeader && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    const message = body?.message || `Request failed: ${response.status}`;
    const shouldInvalidateAuth =
      response.status === 401 || (response.status === 403 && String(message).includes("账号已被禁用"));
    if (token && shouldInvalidateAuth) {
      localStorage.removeItem("finance_token");
      window.dispatchEvent(
        new CustomEvent("finance_auth_invalid", {
          detail: { message }
        })
      );
    }
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

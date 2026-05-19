import { useState } from "react";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/AuthContext";

export default function LoginPage() {
  const { login } = useAuth();
  const [mode, setMode] = useState("login");
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onLogin(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await login(loginForm.username, loginForm.password);
    } catch (err) {
      setError(err.message || "登录失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function onRegister(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const res = await apiRequest("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          username: registerForm.username,
          password: registerForm.password
        })
      });
      setSuccess(res?.data?.message || "注册申请已提交，等待管理员审核");
      setRegisterForm({ username: "", password: "" });
    } catch (err) {
      setError(err.message || "注册申请失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="auth-tabs">
          <button
            type="button"
            className={`btn btn-compact ${mode === "login" ? "btn-primary" : "btn-outline"}`}
            onClick={() => {
              setMode("login");
              setError("");
              setSuccess("");
            }}
          >
            登录
          </button>
          <button
            type="button"
            className={`btn btn-compact ${mode === "register" ? "btn-primary" : "btn-outline"}`}
            onClick={() => {
              setMode("register");
              setError("");
              setSuccess("");
            }}
          >
            注册
          </button>
        </div>

        {mode === "login" ? (
          <form onSubmit={onLogin}>
            <h1>系统登录</h1>
            <label>
              用户名
              <input
                value={loginForm.username}
                onChange={(e) => setLoginForm((v) => ({ ...v, username: e.target.value }))}
                required
              />
            </label>
            <label>
              密码
              <input
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm((v) => ({ ...v, password: e.target.value }))}
                required
              />
            </label>
            {error ? <p className="error-text">{error}</p> : null}
            {success ? <p className="text-green">{success}</p> : null}
            <button className="btn btn-primary" disabled={submitting}>
              {submitting ? "登录中..." : "登录"}
            </button>
          </form>
        ) : (
          <form onSubmit={onRegister}>
            <h1>新用户注册</h1>
            <p className="muted-text">提交后需管理员审核通过才可登录。</p>
            <label>
              用户名
              <input
                value={registerForm.username}
                onChange={(e) => setRegisterForm((v) => ({ ...v, username: e.target.value }))}
                required
              />
            </label>
            <label>
              密码
              <input
                type="password"
                value={registerForm.password}
                onChange={(e) => setRegisterForm((v) => ({ ...v, password: e.target.value }))}
                required
              />
            </label>
            {error ? <p className="error-text">{error}</p> : null}
            {success ? <p className="text-green">{success}</p> : null}
            <button className="btn btn-primary" disabled={submitting}>
              {submitting ? "提交中..." : "提交注册申请"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

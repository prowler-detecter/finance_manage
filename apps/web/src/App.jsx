import { useState } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { useAuth } from "./state/AuthContext";
import LoginPage from "./pages/LoginPage";
import PartnersPage from "./pages/PartnersPage";
import ProductsPage from "./pages/ProductsPage";
import TransactionsPage from "./pages/TransactionsPage";
import InventoryPage from "./pages/InventoryPage";
import MaterialLibraryPage from "./pages/MaterialLibraryPage";
import DashboardPage from "./pages/DashboardPage";
import UsersPage from "./pages/UsersPage";

function ProtectedLayout() {
  const { user, logout } = useAuth();
  const [mobileNavCollapsed, setMobileNavCollapsed] = useState(true);
  if (!user) return <Navigate to="/login" replace />;
  const isManager = ["admin", "super_admin"].includes(String(user?.role || ""));
  const roleTextMap = {
    super_admin: "超级管理员",
    admin: "管理员"
  };
  const roleText = roleTextMap[String(user?.role || "")] || "";
  const sidebarUserText = roleText ? `${user.username}（${roleText}）` : user.username;
  const navListId = "sidebar-nav-list";

  return (
    <>
      <header className="top-system-bar">
        <div className="top-system-bar-title">玉环宏辉塑料模具有限公司——财务及仓储管理系统</div>
      </header>
      <div className="layout">
        <aside className={`sidebar${mobileNavCollapsed ? " is-collapsed" : ""}`}>
          <div className="sidebar-user desktop-only">{sidebarUserText}</div>
          <div className="sidebar-user-toolbar mobile-only">
            <button
              type="button"
              className="sidebar-user-toggle"
              onClick={() => setMobileNavCollapsed((prev) => !prev)}
              aria-expanded={!mobileNavCollapsed}
              aria-controls={navListId}
              aria-label={mobileNavCollapsed ? "展开导航菜单" : "收起导航菜单"}
            >
              <span className="sidebar-user-name">{sidebarUserText}</span>
              <span className="sidebar-toggle-text">{mobileNavCollapsed ? "展开" : "收起"}</span>
            </button>
          </div>
          <nav id={navListId} className="nav-list">
            <NavLink className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} to="/dashboard">
              📊 概览仪表盘
            </NavLink>
            <NavLink className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} to="/transactions">
              📝 记账登记
            </NavLink>
            <NavLink className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} to="/partners">
              👥 客户与欠款
            </NavLink>
            <NavLink className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} to="/inventory">
              🏬 库存管理
            </NavLink>
            <NavLink className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} to="/material-library">
              🧱 物料/加工库
            </NavLink>
            <NavLink className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} to="/products">
              📦 产品管理
            </NavLink>
            {isManager ? (
              <NavLink className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} to="/users">
                👤 用户管理
              </NavLink>
            ) : null}
          </nav>
          <button className="btn btn-outline sidebar-logout" onClick={logout}>
            退出登录
          </button>
        </aside>
        <main className="content">
          <Routes>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/material-library" element={<MaterialLibraryPage />} />
            <Route path="/material-inventory" element={<Navigate to="/material-library" replace />} />
            <Route path="/partners" element={<PartnersPage />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/users" element={isManager ? <UsersPage /> : <Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
      </div>
    </>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <div className="centered">加载中...</div>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      <Route path="/*" element={<ProtectedLayout />} />
    </Routes>
  );
}

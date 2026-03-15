import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { useAuth } from "./state/AuthContext";
import LoginPage from "./pages/LoginPage";
import PartnersPage from "./pages/PartnersPage";
import ProductsPage from "./pages/ProductsPage";
import TransactionsPage from "./pages/TransactionsPage";
import InventoryPage from "./pages/InventoryPage";
import DashboardPage from "./pages/DashboardPage";

function ProtectedLayout() {
  const { user, logout } = useAuth();
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="layout">
      <aside className="sidebar">
        <h2>玉环宏辉有限公司财务及仓储管理系统</h2>
        <nav className="nav-list">
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
          <NavLink className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} to="/products">
            📦 产品管理
          </NavLink>
        </nav>
        <button className="btn btn-outline" onClick={logout}>
          退出登录
        </button>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/partners" element={<PartnersPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
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

import { Navigate, Route, Routes, Link } from "react-router-dom";
import { useAuth } from "./state/AuthContext";
import LoginPage from "./pages/LoginPage";
import PartnersPage from "./pages/PartnersPage";
import ProductsPage from "./pages/ProductsPage";
import TransactionsPage from "./pages/TransactionsPage";
import InventoryPage from "./pages/InventoryPage";

function ProtectedLayout() {
  const { user, logout } = useAuth();
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="layout">
      <aside className="sidebar">
        <h2>财务管理系统</h2>
        <nav>
          <Link to="/transactions">记账</Link>
          <Link to="/inventory">库存</Link>
          <Link to="/partners">客户/供应商</Link>
          <Link to="/products">产品</Link>
        </nav>
        <button className="btn btn-outline" onClick={logout}>
          退出登录
        </button>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/partners" element={<PartnersPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="*" element={<Navigate to="/transactions" replace />} />
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
      <Route path="/login" element={user ? <Navigate to="/transactions" replace /> : <LoginPage />} />
      <Route path="/*" element={<ProtectedLayout />} />
    </Routes>
  );
}

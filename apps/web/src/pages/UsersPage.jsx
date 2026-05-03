import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/AuthContext";

function roleLabel(role) {
  if (role === "super_admin") return "最高管理员";
  if (role === "admin") return "日常管理员";
  return "普通用户";
}

function statusLabel(status) {
  if (status === "pending") return "待审核";
  if (status === "approved") return "已通过";
  if (status === "rejected") return "已拒绝";
  return status;
}

export default function UsersPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canManageRoles = user?.role === "super_admin";
  const userKeywordFocusRef = useRef(false);
  const [registrationFilter, setRegistrationFilter] = useState("pending");
  const [userKeyword, setUserKeyword] = useState("");
  const [resetPwdUserId, setResetPwdUserId] = useState(null);
  const [resetPwd, setResetPwd] = useState("");
  const [renameUserId, setRenameUserId] = useState(null);
  const [renameUsername, setRenameUsername] = useState("");

  const registrationsQuery = useQuery({
    queryKey: ["admin-registrations", registrationFilter],
    queryFn: async () =>
      (
        await apiRequest(
          `/admin/registrations${registrationFilter ? `?status=${encodeURIComponent(registrationFilter)}` : ""}`
        )
      ).data
  });

  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => (await apiRequest("/admin/users")).data
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, action }) =>
      apiRequest(`/admin/registrations/${id}/review`, {
        method: "PATCH",
        body: JSON.stringify({ action })
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-registrations"] });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    }
  });

  const roleMutation = useMutation({
    mutationFn: async ({ id, role }) =>
      apiRequest(`/admin/users/${id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role })
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    }
  });

  const activeMutation = useMutation({
    mutationFn: async ({ id, active }) =>
      apiRequest(`/admin/users/${id}/active`, {
        method: "PATCH",
        body: JSON.stringify({ active })
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    }
  });

  const resetPwdMutation = useMutation({
    mutationFn: async ({ id, password }) =>
      apiRequest(`/admin/users/${id}/password`, {
        method: "PATCH",
        body: JSON.stringify({ password })
      }),
    onSuccess: () => {
      setResetPwdUserId(null);
      setResetPwd("");
    }
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, username }) =>
      apiRequest(`/admin/users/${id}/username`, {
        method: "PATCH",
        body: JSON.stringify({ username })
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    }
  });

  const filteredUsers = useMemo(() => {
    const rows = usersQuery.data || [];
    const keyword = String(userKeyword || "").trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter((row) => String(row.username || "").toLowerCase().includes(keyword));
  }, [usersQuery.data, userKeyword]);

  function handleUserKeywordChange(event) {
    if (!userKeywordFocusRef.current) return;
    setUserKeyword(event.target.value);
  }

  async function handleReview(row, action) {
    const actionText = action === "approve" ? "通过" : "拒绝";
    const ok = window.confirm(`确认${actionText}申请用户「${row.username}」？`);
    if (!ok) return;
    try {
      await reviewMutation.mutateAsync({ id: row.id, action });
      window.alert(`已${actionText}`);
    } catch (error) {
      window.alert(error.message || "操作失败");
    }
  }

  async function handleToggleRole(user) {
    if (user.role === "super_admin") {
      window.alert("最高管理员角色不可在此处调整");
      return;
    }
    const nextRole = user.role === "admin" ? "user" : "admin";
    const ok = window.confirm(`确认将「${user.username}」设置为${roleLabel(nextRole)}？`);
    if (!ok) return;
    try {
      await roleMutation.mutateAsync({ id: user.id, role: nextRole });
      window.alert("角色已更新");
    } catch (error) {
      window.alert(error.message || "角色更新失败");
    }
  }

  async function handleToggleActive(user) {
    const nextActive = !user.active;
    const actionText = nextActive ? "启用" : "禁用";
    const ok = window.confirm(`确认${actionText}账号「${user.username}」？`);
    if (!ok) return;
    try {
      await activeMutation.mutateAsync({ id: user.id, active: nextActive });
      window.alert(`账号已${actionText}`);
    } catch (error) {
      window.alert(error.message || "账号状态更新失败");
    }
  }

  async function submitResetPassword(userId) {
    const password = String(resetPwd || "").trim();
    if (!password) {
      window.alert("请输入新密码");
      return;
    }

    try {
      await resetPwdMutation.mutateAsync({ id: userId, password });
      window.alert("密码已重置");
    } catch (error) {
      window.alert(error.message || "重置密码失败");
    }
  }

  async function submitRenameUsername(targetUserId) {
    const username = String(renameUsername || "").trim();
    if (!username) {
      window.alert("请输入新用户名");
      return;
    }

    try {
      await renameMutation.mutateAsync({ id: targetUserId, username });
      setRenameUserId(null);
      setRenameUsername("");
      if (Number(user?.id || 0) === Number(targetUserId || 0)) {
        window.alert("当前登录账号用户名已修改，页面将刷新以同步信息。");
        window.location.reload();
        return;
      }
      window.alert("用户名已更新");
    } catch (error) {
      window.alert(error.message || "用户名更新失败");
    }
  }

  return (
    <section className="page-section">
      <div className="header-row">
        <h1>用户管理</h1>
      </div>

      <div className="card">
        <div className="section-title-row">
          <h3>注册申请审核</h3>
          <div className="section-actions">
            <select value={registrationFilter} onChange={(e) => setRegistrationFilter(e.target.value)}>
              <option value="pending">待审核</option>
              <option value="approved">已通过</option>
              <option value="rejected">已拒绝</option>
            </select>
          </div>
        </div>

        {registrationsQuery.isLoading ? <p>加载中...</p> : null}
        {registrationsQuery.isError ? <p className="error-text">{registrationsQuery.error.message}</p> : null}

        <table className="fixed-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>用户名</th>
              <th>状态</th>
              <th>申请时间</th>
              <th>审核人</th>
              <th>审核时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {(registrationsQuery.data || []).length === 0 ? (
              <tr>
                <td colSpan="7" className="cell-muted">
                  暂无数据
                </td>
              </tr>
            ) : (
              (registrationsQuery.data || []).map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{row.username}</td>
                  <td>{statusLabel(row.status)}</td>
                  <td>{row.createdAt?.slice(0, 19).replace("T", " ") || "-"}</td>
                  <td>{row.reviewerName || "-"}</td>
                  <td>{row.reviewedAt?.slice(0, 19).replace("T", " ") || "-"}</td>
                  <td>
                    {row.status === "pending" ? (
                      <div className="client-actions">
                        <button className="btn btn-small-outline" onClick={() => handleReview(row, "approve")}>通过</button>
                        <button className="btn btn-small-outline" onClick={() => handleReview(row, "reject")}>拒绝</button>
                      </div>
                    ) : (
                      <span className="cell-muted">-</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="section-title-row">
          <h3>系统用户</h3>
          <div className="section-actions">
            <input
              name="user-search-keyword"
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              type="text"
              placeholder="按用户名检索"
              value={userKeyword}
              onFocus={() => {
                userKeywordFocusRef.current = true;
              }}
              onBlur={() => {
                userKeywordFocusRef.current = false;
              }}
              onChange={handleUserKeywordChange}
            />
            <span className="muted-text">匹配 {filteredUsers.length} / {(usersQuery.data || []).length} 条</span>
          </div>
        </div>

        {usersQuery.isLoading ? <p>加载中...</p> : null}
        {usersQuery.isError ? <p className="error-text">{usersQuery.error.message}</p> : null}

        <table className="fixed-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>用户名</th>
              <th>角色</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.length === 0 ? (
              <tr>
                <td colSpan="6" className="cell-muted">
                  暂无数据
                </td>
              </tr>
            ) : (
              filteredUsers.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{row.username}</td>
                  <td>{roleLabel(row.role)}</td>
                  <td>{row.active ? "启用" : "禁用"}</td>
                  <td>{row.createdAt?.slice(0, 19).replace("T", " ") || "-"}</td>
                  <td>
                    <div className="client-actions">
                      {canManageRoles ? (
                        <button
                          className="btn btn-small-outline"
                          onClick={() => handleToggleRole(row)}
                          disabled={row.role === "super_admin"}
                        >
                          {row.role === "admin" ? "降为普通用户" : row.role === "user" ? "设为日常管理员" : "-"}
                        </button>
                      ) : null}
                      <button className="btn btn-small-outline" onClick={() => handleToggleActive(row)}>
                        {row.active ? "禁用" : "启用"}
                      </button>
                      <button
                        className="btn btn-small-outline"
                        onClick={() => {
                          setResetPwdUserId(row.id);
                          setResetPwd("");
                        }}
                      >
                        重置密码
                      </button>
                      <button
                        className="btn btn-small-outline"
                        onClick={() => {
                          setRenameUserId(row.id);
                          setRenameUsername(row.username || "");
                        }}
                        disabled={row.role === "super_admin" && user?.role !== "super_admin"}
                      >
                        修改用户名
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div
        className={`modal${resetPwdUserId ? "" : " hidden"}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setResetPwdUserId(null);
            setResetPwd("");
          }
        }}
      >
        <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="reset-user-password-title">
          <h3 id="reset-user-password-title">重置用户密码</h3>
          <div className="form-group">
            <label>新密码</label>
            <input
              type="password"
              value={resetPwd}
              onChange={(e) => setResetPwd(e.target.value)}
              placeholder="请输入新密码"
            />
          </div>
          <div className="modal-actions">
            <button
              className="btn"
              onClick={() => {
                setResetPwdUserId(null);
                setResetPwd("");
              }}
            >
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={() => resetPwdUserId && submitResetPassword(resetPwdUserId)}
              disabled={resetPwdMutation.isPending}
            >
              {resetPwdMutation.isPending ? "保存中..." : "确认重置"}
            </button>
          </div>
        </div>
      </div>

      <div
        className={`modal${renameUserId ? "" : " hidden"}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setRenameUserId(null);
            setRenameUsername("");
          }
        }}
      >
        <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="rename-user-title">
          <h3 id="rename-user-title">修改用户名</h3>
          <div className="form-group">
            <label>新用户名</label>
            <input
              type="text"
              value={renameUsername}
              onChange={(e) => setRenameUsername(e.target.value)}
              placeholder="请输入新用户名"
            />
          </div>
          <div className="modal-actions">
            <button
              className="btn"
              onClick={() => {
                setRenameUserId(null);
                setRenameUsername("");
              }}
            >
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={() => renameUserId && submitRenameUsername(renameUserId)}
              disabled={renameMutation.isPending}
            >
              {renameMutation.isPending ? "保存中..." : "确认修改"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

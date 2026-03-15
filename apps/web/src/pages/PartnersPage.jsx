import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";

export default function PartnersPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    type: "customer"
  });

  const partnersQuery = useQuery({
    queryKey: ["partners"],
    queryFn: async () => (await apiRequest("/partners")).data
  });

  const createMutation = useMutation({
    mutationFn: async (payload) =>
      apiRequest("/partners", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    onSuccess: () => {
      setForm({ name: "", type: "customer" });
      queryClient.invalidateQueries({ queryKey: ["partners"] });
    }
  });

  return (
    <section>
      <h1>客户/供应商</h1>
      <div className="card">
        <h3>新增对象</h3>
        <div className="row">
          <input
            placeholder="名称"
            value={form.name}
            onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
          />
          <select value={form.type} onChange={(e) => setForm((v) => ({ ...v, type: e.target.value }))}>
            <option value="customer">客户</option>
            <option value="supplier">供应商</option>
          </select>
          <button
            className="btn btn-primary"
            onClick={() => createMutation.mutate(form)}
            disabled={!form.name || createMutation.isPending}
          >
            保存
          </button>
        </div>
      </div>

      <div className="card">
        <h3>对象列表</h3>
        {partnersQuery.isLoading ? <p>加载中...</p> : null}
        {partnersQuery.isError ? <p className="error-text">{partnersQuery.error.message}</p> : null}
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>名称</th>
              <th>类型</th>
            </tr>
          </thead>
          <tbody>
            {(partnersQuery.data || []).map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td>{p.name}</td>
                <td>{p.type === "customer" ? "客户" : "供应商"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

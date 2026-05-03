import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UsersPage from "./UsersPage";
import { apiRequest } from "../lib/api";

vi.mock("../lib/api", () => ({
  apiRequest: vi.fn()
}));

vi.mock("../state/AuthContext", () => ({
  useAuth: () => ({
    user: { id: 1, username: "admin", role: "super_admin" }
  })
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <UsersPage />
    </QueryClientProvider>
  );
}

describe("UsersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiRequest.mockImplementation(async (path) => {
      if (String(path).startsWith("/admin/registrations")) {
        return { data: [] };
      }
      if (path === "/admin/users") {
        return {
          data: [
            {
              id: 1,
              username: "admin",
              role: "super_admin",
              active: true,
              createdAt: "2026-03-22T18:13:09.000Z",
              updatedAt: "2026-03-22T18:13:09.000Z"
            },
            {
              id: 2,
              username: "test",
              role: "user",
              active: true,
              createdAt: "2026-03-22T18:13:09.000Z",
              updatedAt: "2026-03-22T18:13:09.000Z"
            }
          ]
        };
      }
      throw new Error(`unexpected api path: ${path}`);
    });
  });

  it("defaults user search to empty and shows full user list", async () => {
    renderPage();

    const input = screen.getByPlaceholderText("按用户名检索");
    expect(input).toHaveValue("");

    await screen.findByText("admin");
    await screen.findByText("test");
    expect(screen.getByText("匹配 2 / 2 条")).toBeInTheDocument();
  });
});


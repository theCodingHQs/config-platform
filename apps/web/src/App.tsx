import React, { useState, useEffect } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Navigate,
  useParams,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { MetadataProvider } from "./context/metadata-context";
import { PageRuntimeProvider } from "./context/page-runtime-context";
import { AuthProvider, useAuth } from "./context/auth-context";
import { renderNode } from "./renderer/render-node";
import { fetchPublishedPages, type CurrentUser } from "./api/client";
import { EntityManager } from "./studio/EntityManager";
import { PageManager } from "./studio/PageManager";
import { PageBuilder } from "./studio/PageBuilder";
import { PermissionsManager } from "./studio/PermissionsManager";
import { WorkspaceSettings } from "./studio/WorkspaceSettings";
import { ThemeStudio } from "./studio/ThemeStudio";
import {
  fetchWorkspaces,
  switchWorkspace,
  type WorkspaceItem,
} from "./api/client";
import { AuthPage } from "./pages/AuthPage";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { ThemeProvider } from "./context/theme-context";
import { ThemeModeSwitch } from "./components/ThemeModeSwitch";
import {
  Zap,
  Menu,
  ChevronLeft,
  ChevronRight,
  Plus,
  FileText,
  BarChart2,
  Users,
  Package,
  LogOut,
  Shield,
  Sliders,
} from "lucide-react";
import type { PageDefinition } from "@config-platform/schema";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function RuntimeDynamicPage({
  pages,
  tenantId,
}: {
  pages: PageDefinition[];
  tenantId: string;
}) {
  const params = useParams();
  const navigate = useNavigate();
  const currentPath = `/${params["*"] || ""}`;

  const matched = pages.find((p) => p.route === currentPath);
  if (!matched) {
    if (pages.length === 0) {
      return (
        <div
          style={{ maxWidth: "600px", margin: "4rem auto", textAlign: "center", padding: "2rem" }}
        >
          <div style={{ marginBottom: "1rem", color: "var(--accent)" }}>
            <FileText size={48} style={{ margin: "0 auto", opacity: 0.8 }} />
          </div>
          <h2 style={{ fontSize: "var(--font-size-2xl)", fontWeight: 600, marginBottom: "0.5rem" }}>
            No Pages in Workspace
          </h2>
          <p style={{ color: "var(--text-muted)", marginBottom: "1.5rem", fontSize: "var(--font-size-sm)" }}>
            This workspace doesn't have any published pages yet. Use Page Studio to design and publish your first page.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate("/studio/pages")}
          >
            Open Page Studio
          </button>
        </div>
      );
    }
    return (
      <div
        style={{ maxWidth: "800px", margin: "3rem auto", textAlign: "center" }}
      >
        <h2>Page Not Found</h2>
        <p style={{ color: "var(--text-muted)", marginTop: "0.5rem" }}>
          No published page matches route "{currentPath}".
        </p>
      </div>
    );
  }

  return (
    <PageRuntimeProvider
      key={matched.id || matched.route}
      tenantId={tenantId}
      page={matched}
      params={params}
      navigate={navigate}
    >
      <div
        style={{ maxWidth: "1200px", margin: "0 auto", padding: "2rem 1.5rem" }}
      >
        {renderNode(matched.root)}
      </div>
    </PageRuntimeProvider>
  );
}

function getPageIcon(page: PageDefinition): React.ReactNode {
  const name = (
    ((page as any).name || "") +
    " " +
    (page.route || "")
  ).toLowerCase();
  if (
    name.includes("dash") ||
    name.includes("analytic") ||
    name.includes("stat") ||
    name.includes("telemetry") ||
    name.includes("metric") ||
    name.includes("report")
  )
    return <BarChart2 size={16} />;
  if (
    name.includes("user") ||
    name.includes("member") ||
    name.includes("team") ||
    name.includes("person")
  )
    return <Users size={16} />;
  if (name.includes("order") || name.includes("inventory") || name.includes("product") || name.includes("item"))
    return <Package size={16} />;
  return <FileText size={16} />;
}

function getPageTitle(page: PageDefinition): string {
  if ((page as any).name) return (page as any).name;
  return page.root?.children?.[0]?.props?.value || page.route.replace(/^\//, "");
}

function WorkspaceSwitcher({
  currentTenantId,
  defaultName,
}: {
  currentTenantId: string;
  defaultName?: string;
}) {
  const { data: workspaces, isLoading } = useQuery({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
  });

  const [switching, setSwitching] = useState(false);

  const handleSwitch = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const targetTenantId = e.target.value;
    if (!targetTenantId || targetTenantId === currentTenantId) return;
    try {
      setSwitching(true);
      await switchWorkspace(targetTenantId);
      window.location.reload();
    } catch (err) {
      console.error("Failed to switch workspace", err);
    } finally {
      setSwitching(false);
    }
  };

  if (isLoading || !workspaces || workspaces.length <= 1) {
    const current = workspaces?.find((w) => w.tenantId === currentTenantId);
    return (
      <span
        style={{
          fontSize: "var(--font-size-xs)",
          fontFamily: "monospace",
          padding: "0.25rem 0.5rem",
          backgroundColor: "var(--surface-subtle)",
          borderRadius: "var(--radius-sm)",
          color: "var(--text-muted)",
          border: "1px solid var(--border)",
        }}
        title="Current Workspace"
      >
        Workspace: {current?.tenantName || defaultName || currentTenantId}
      </span>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
      <span style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
        Workspace:
      </span>
      <select
        value={currentTenantId}
        onChange={handleSwitch}
        disabled={switching}
        style={{
          fontSize: "var(--font-size-xs)",
          padding: "0.25rem 0.5rem",
          backgroundColor: "var(--surface-subtle)",
          color: "var(--text)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
          cursor: "pointer",
        }}
      >
        {workspaces.map((w) => (
          <option key={w.tenantId} value={w.tenantId}>
            {w.tenantName} ({w.role})
          </option>
        ))}
      </select>
    </div>
  );
}

function AppContent({ user }: { user: CurrentUser }) {
  const { logout } = useAuth();
  const location = useLocation();
  const isStudioRoute = location.pathname.startsWith("/studio");

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);

  // Close mobile drawer when route changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const { data: apiPublishedPages = [] } = useQuery<PageDefinition[]>({
    queryKey: ["published-pages", user.tenantId],
    queryFn: () => fetchPublishedPages(user.tenantId),
  });

  const effectivePages = apiPublishedPages;

  return (
    <div
      style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}
    >
      {/* Top Navbar: Brand + Studio Tools + User Profile */}
      <header
        style={{
          borderBottom: "1px solid var(--border)",
          backgroundColor: "var(--surface)",
          position: "sticky",
          top: 0,
          zIndex: 30,
          height: "var(--navbar-height)",
        }}
        className="nav-height"
      >
        <div
          style={{
            maxWidth: "100%",
            height: "100%",
            padding: "0 1.25rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}
          >
            {/* Sidebar toggle for runtime app pages */}
            {!isStudioRoute && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  if (
                    typeof window !== "undefined" &&
                    window.innerWidth <= 768
                  ) {
                    setMobileMenuOpen((prev) => !prev);
                  } else {
                    setDesktopCollapsed((prev) => !prev);
                  }
                }}
                style={{
                  padding: "0.375rem 0.5rem",
                  display: "inline-flex",
                  alignItems: "center",
                }}
                title="Toggle Pages Sidebar"
                aria-label="Toggle Pages Sidebar"
              >
                <Menu size={16} />
              </button>
            )}

            <NavLink
              to="/"
              style={{
                fontWeight: 700,
                fontSize: "var(--font-size-md)",
                letterSpacing: "-0.02em",
                color: "var(--accent)",
                textDecoration: "none",
                display: "flex",
                alignItems: "center",
                gap: "0.375rem",
              }}
            >
              <Zap size={16} /> ConfigPlatform
            </NavLink>

            <span style={{ color: "var(--border)" }}>|</span>

            {/* Studio Navigation in Navbar */}
            <nav
              style={{ display: "flex", gap: "0.375rem", alignItems: "center" }}
            >
              <span
                style={{
                  fontSize: "var(--font-size-xs)",
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  marginRight: "0.25rem",
                }}
              >
                Studio:
              </span>
              <NavLink
                to="/studio/data"
                className={({ isActive }) =>
                  isActive ? "btn btn-secondary active" : "btn btn-ghost"
                }
                style={({ isActive }) => ({
                  fontSize: "var(--font-size-sm)",
                  padding: "0.25rem 0.625rem",
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? "var(--accent)" : "var(--text)",
                  backgroundColor: isActive
                    ? "var(--accent-subtle)"
                    : "transparent",
                })}
              >
                Data Entities
              </NavLink>
              <NavLink
                to="/studio/pages"
                className={({ isActive }) =>
                  isActive ? "btn btn-secondary active" : "btn btn-ghost"
                }
                style={({ isActive }) => ({
                  fontSize: "var(--font-size-sm)",
                  padding: "0.25rem 0.625rem",
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? "var(--accent)" : "var(--text)",
                  backgroundColor: isActive
                    ? "var(--accent-subtle)"
                    : "transparent",
                })}
              >
                Pages
              </NavLink>
              <NavLink
                to="/studio/permissions"
                className={({ isActive }) =>
                  isActive ? "btn btn-secondary active" : "btn btn-ghost"
                }
                style={({ isActive }) => ({
                  fontSize: "var(--font-size-sm)",
                  padding: "0.25rem 0.625rem",
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? "var(--accent)" : "var(--text)",
                  backgroundColor: isActive
                    ? "var(--accent-subtle)"
                    : "transparent",
                })}
              >
                Permissions
              </NavLink>
              <NavLink
                to="/studio/theme"
                className={({ isActive }) =>
                  isActive ? "btn btn-secondary active" : "btn btn-ghost"
                }
                style={({ isActive }) => ({
                  fontSize: "var(--font-size-sm)",
                  padding: "0.25rem 0.625rem",
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? "var(--accent)" : "var(--text)",
                  backgroundColor: isActive
                    ? "var(--accent-subtle)"
                    : "transparent",
                })}
              >
                Theme
              </NavLink>
              <NavLink
                to="/studio/settings"
                className={({ isActive }) =>
                  isActive ? "btn btn-secondary active" : "btn btn-ghost"
                }
                style={({ isActive }) => ({
                  fontSize: "var(--font-size-sm)",
                  padding: "0.25rem 0.625rem",
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? "var(--accent)" : "var(--text)",
                  backgroundColor: isActive
                    ? "var(--accent-subtle)"
                    : "transparent",
                })}
              >
                Settings
              </NavLink>
            </nav>
          </div>

          {/* User Profile, Theme Mode Switch & Tenant Badge */}
          <div
            style={{ display: "flex", alignItems: "center", gap: "var(--spacing-3)" }}
          >
            <WorkspaceSwitcher
              currentTenantId={user.tenantId}
              defaultName={user.tenantName}
            />

            <span
              style={{
                fontSize: "var(--font-size-xs)",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                padding: "var(--spacing-1) var(--spacing-2)",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--accent-subtle)",
                color: "var(--accent)",
                border: "var(--border-width-sm) solid var(--accent)",
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--spacing-1)",
              }}
            >
              <Shield size={11} /> {user.role}
            </span>

            <span
              style={{
                fontSize: "var(--font-size-xs)",
                fontWeight: 500,
                color: "var(--text)",
              }}
            >
              {user.email}
            </span>

            <ThemeModeSwitch compact />

            <button
              type="button"
              className="btn btn-ghost"
              onClick={logout}
              style={{
                fontSize: "var(--font-size-xs)",
                padding: "var(--spacing-1) var(--spacing-2)",
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--spacing-1)",
                color: "var(--text-muted)",
              }}
              title="Sign Out"
            >
              <LogOut size={14} />
              <span>Log out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Body */}
      {isStudioRoute ? (
        /* Studio Views (Data Entities, Page Manager, Page Builder) take full width */
        <main style={{ flex: 1 }}>
          <Routes>
            <Route
              path="/studio/data"
              element={
                <div
                  style={{
                    maxWidth: "1400px",
                    margin: "0 auto",
                    padding: "2rem 1.5rem",
                  }}
                >
                  <EntityManager />
                </div>
              }
            />
            <Route
              path="/studio/pages"
              element={
                <div
                  style={{
                    maxWidth: "1400px",
                    margin: "0 auto",
                    padding: "2rem 1.5rem",
                  }}
                >
                  <PageManager />
                </div>
              }
            />
            <Route
              path="/studio/permissions"
              element={
                <div
                  style={{
                    maxWidth: "1400px",
                    margin: "0 auto",
                    padding: "2rem 1.5rem",
                  }}
                >
                  <PermissionsManager />
                </div>
              }
            />
            <Route
              path="/studio/settings"
              element={
                <div
                  style={{
                    maxWidth: "1400px",
                    margin: "0 auto",
                    padding: "2rem 1.5rem",
                  }}
                >
                  <WorkspaceSettings />
                </div>
              }
            />
            <Route
              path="/studio/theme"
              element={<ThemeStudio />}
            />
            <Route path="/studio/pages/:id" element={<PageBuilder />} />
          </Routes>
        </main>
      ) : (
        /* Application Runtime View with Responsive Sidebar */
        <div className="app-layout">
          {/* Mobile backdrop */}
          {mobileMenuOpen && (
            <div
              className="sidebar-backdrop"
              onClick={() => setMobileMenuOpen(false)}
            />
          )}

          {/* Responsive Sidebar for Application Pages */}
          <aside
            className={`app-sidebar ${desktopCollapsed ? "collapsed" : ""} ${
              mobileMenuOpen ? "open" : ""
            }`}
          >
            <div className="app-sidebar-header">
              <span className="app-sidebar-title">Application Pages</span>
              <button
                type="button"
                className="btn btn-ghost app-sidebar-collapse-btn"
                onClick={() => setDesktopCollapsed((prev) => !prev)}
                title={desktopCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
                aria-label={
                  desktopCollapsed ? "Expand Sidebar" : "Collapse Sidebar"
                }
              >
                {desktopCollapsed ? (
                  <ChevronRight size={14} />
                ) : (
                  <ChevronLeft size={14} />
                )}
              </button>
            </div>

            <nav className="app-sidebar-nav">
              {effectivePages.length === 0 ? (
                <div
                  style={{
                    padding: "1rem 0.75rem",
                    color: "var(--text-muted)",
                    fontSize: "var(--font-size-sm)",
                    textAlign: "center",
                  }}
                >
                  <p style={{ margin: "0 0 0.5rem 0", lineHeight: 1.4 }}>
                    No published pages.
                  </p>
                  <NavLink
                    to="/studio/pages"
                    className="btn btn-secondary"
                    style={{
                      fontSize: "var(--font-size-xs)",
                      padding: "0.25rem 0.625rem",
                      display: "inline-block",
                    }}
                  >
                    Create Page
                  </NavLink>
                </div>
              ) : (
                effectivePages.map((p) => {
                  const title = getPageTitle(p);
                  const icon = getPageIcon(p);
                  return (
                    <NavLink
                      key={p.id}
                      to={p.route}
                      title={title}
                      className={({ isActive }) =>
                        `app-sidebar-item ${isActive ? "active" : ""}`
                      }
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      <span className="app-sidebar-icon">{icon}</span>
                      <span className="app-sidebar-item-title">{title}</span>
                    </NavLink>
                  );
                })
              )}
            </nav>

            <div className="app-sidebar-footer">
              <NavLink
                to="/studio/pages"
                className="btn btn-secondary"
                title="Build New Page"
                style={{
                  width: "100%",
                  fontSize: "var(--font-size-xs)",
                  gap: "0.375rem",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Plus size={14} />
                <span className="app-sidebar-footer-text">Build New Page</span>
              </NavLink>
            </div>
          </aside>

          {/* App Runtime Content Area */}
          <main className="app-main-content">
            <Routes>
              <Route
                path="/"
                element={
                  effectivePages.length > 0 ? (
                    <Navigate to={effectivePages[0].route} replace />
                  ) : (
                    <Navigate to="/studio/pages" replace />
                  )
                }
              />
              <Route
                path="/*"
                element={
                  <RuntimeDynamicPage
                    pages={effectivePages}
                    tenantId={user.tenantId}
                  />
                }
              />
            </Routes>
          </main>
        </div>
      )}
    </div>
  );
}

function AuthenticatedApp() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "var(--bg)",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              display: "inline-flex",
              padding: "0.75rem",
              borderRadius: "var(--radius-xl)",
              backgroundColor: "var(--accent-subtle)",
              color: "var(--accent)",
              marginBottom: "1rem",
            }}
          >
            <Zap size={28} />
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>
            Loading workspace session...
          </p>
        </div>
      </div>
    );
  }

  if (
    typeof window !== "undefined" &&
    window.location.pathname === "/accept-invite"
  ) {
    return <AcceptInvitePage />;
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <MetadataProvider tenantId={user.tenantId}>
      <BrowserRouter>
        <AppContent user={user} />
      </BrowserRouter>
    </MetadataProvider>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <AuthenticatedApp />
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;

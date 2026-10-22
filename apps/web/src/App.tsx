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
import {
  MetadataProvider,
  useOptionalMetadata,
} from "./context/metadata-context";
import { DynamicIcon } from "./components/dynamic-icon";
import { PageRuntimeProvider } from "./context/page-runtime-context";
import { AuthProvider, useAuth } from "./context/auth-context";
import { renderNode } from "./renderer/render-node";
const EntityManager = React.lazy(() =>
  import("./studio/EntityManager").then((m) => ({ default: m.EntityManager }))
);
const PageManager = React.lazy(() =>
  import("./studio/PageManager").then((m) => ({ default: m.PageManager }))
);
const PageBuilder = React.lazy(() =>
  import("./studio/PageBuilder").then((m) => ({ default: m.PageBuilder }))
);
const PermissionsManager = React.lazy(() =>
  import("./studio/PermissionsManager").then((m) => ({
    default: m.PermissionsManager,
  }))
);
const ExportTemplatesManager = React.lazy(() =>
  import("./studio/ExportTemplatesManager").then((m) => ({
    default: m.ExportTemplatesManager,
  }))
);
const GridTemplateDesigner = React.lazy(() =>
  import("./studio/GridTemplateDesigner").then((m) => ({
    default: m.GridTemplateDesigner,
  }))
);
const WorkspaceSettings = React.lazy(() =>
  import("./studio/WorkspaceSettings").then((m) => ({
    default: m.WorkspaceSettings,
  }))
);
const PlatformSetup = React.lazy(() =>
  import("./studio/PlatformSetup").then((m) => ({ default: m.PlatformSetup }))
);
const ReportSchedules = React.lazy(() =>
  import("./studio/ReportSchedules").then((m) => ({ default: m.ReportSchedules }))
);
const ThemeStudio = React.lazy(() =>
  import("./studio/ThemeStudio").then((m) => ({ default: m.ThemeStudio }))
);

function StudioLoadingFallback() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "50vh",
        color: "var(--text-muted)",
        fontSize: "var(--font-size-sm)",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            width: "2rem",
            height: "2rem",
            margin: "0 auto 1rem",
            border: "2px solid var(--border)",
            borderTopColor: "var(--accent)",
            borderRadius: "var(--radius-pill)",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <span>Loading Studio...</span>
      </div>
    </div>
  );
}
import {
  fetchWorkspaces,
  switchWorkspace,
  fetchPageNavigation,
  fetchPublishedPages,
  type CurrentUser,
  type PageNavigation,
} from "./api/client";
import { AuthPage } from "./pages/AuthPage";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { ThemeProvider } from "./context/theme-context";
import { ThemeModeSwitch } from "./components/ThemeModeSwitch";
import { DatePreferencesButton } from "./components/date-preferences-dialog";
import { HeaderMobileMenu } from "./components/header-mobile-menu";
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
  Folder,
} from "lucide-react";
import type { PageDefinition } from "@config-platform/schema";
import { AppBarProvider } from "./context/app-bar-context";
import { DateSettingsProvider } from "./context/date-settings-provider";

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
          style={{
            maxWidth: "600px",
            margin: "4rem auto",
            textAlign: "center",
            padding: "2rem",
          }}
        >
          <div style={{ marginBottom: "1rem", color: "var(--accent)" }}>
            <FileText size={48} style={{ margin: "0 auto", opacity: 0.8 }} />
          </div>
          <h2
            style={{
              fontSize: "var(--font-size-2xl)",
              fontWeight: 600,
              marginBottom: "0.5rem",
            }}
          >
            No Pages in Workspace
          </h2>
          <p
            style={{
              color: "var(--text-muted)",
              marginBottom: "1.5rem",
              fontSize: "var(--font-size-sm)",
            }}
          >
            This workspace doesn't have any published pages yet. Use Page Studio
            to design and publish your first page.
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
      <div className={`page-container${matched.width === "full" ? " page-container-full" : ""}`}>
        {renderNode(matched.root)}
      </div>
    </PageRuntimeProvider>
  );
}

function getPageIcon(page: PageDefinition, metadata?: any): React.ReactNode {
  // An icon chosen in Page Settings wins over anything derived
  if (page.icon) {
    return <DynamicIcon name={page.icon} size={16} />;
  }
  // Check if page links to an entity in dataSources or root
  if (metadata) {
    const dsEntityId = page.dataSources?.[0]?.entityId;
    if (dsEntityId) {
      const entity = metadata.resolveEntity(dsEntityId);
      if (entity?.icon) {
        return <DynamicIcon name={entity.icon} size={16} />;
      }
    }
    const rootEntityId = page.root?.props?.entityId;
    if (rootEntityId) {
      const entity = metadata.resolveEntity(rootEntityId);
      if (entity?.icon) {
        return <DynamicIcon name={entity.icon} size={16} />;
      }
    }
  }

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
  if (
    name.includes("order") ||
    name.includes("inventory") ||
    name.includes("product") ||
    name.includes("item")
  )
    return <Package size={16} />;
  return <FileText size={16} />;
}

function getPageTitle(page: PageDefinition): string {
  if ((page as any).name) return (page as any).name;
  return (
    page.root?.children?.[0]?.props?.value || page.route.replace(/^\//, "")
  );
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
          borderRadius: "var(--radius-control)",
          color: "var(--text-muted)",
          border: "1px solid var(--border)",
        }}
        title="Current Workspace"
        className="header-workspace"
      >
        <span className="header-workspace-prefix">Workspace: </span>
        {current?.tenantName || defaultName || currentTenantId}
      </span>
    );
  }

  return (
    <div className="header-workspace" style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
      <span
        className="header-workspace-prefix"
        style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}
      >
        Workspace:
      </span>
      <select
        aria-label="Workspace"
        value={currentTenantId}
        onChange={handleSwitch}
        disabled={switching}
        style={{
          fontSize: "var(--font-size-xs)",
          padding: "0.25rem 0.5rem",
          backgroundColor: "var(--surface-subtle)",
          color: "var(--text)",
          borderRadius: "var(--radius-control)",
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
  const metadata = useOptionalMetadata();
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
  const { data: pageNavigation } = useQuery<PageNavigation>({
    queryKey: ["page-navigation", user.tenantId],
    queryFn: () => fetchPageNavigation(user.tenantId),
  });
  const publishedPageIds = new Set(effectivePages.map((page) => page.id));
  const visibleNavigationPages = (pageNavigation?.pages ?? []).filter((page) => publishedPageIds.has(page.id));
  const renderNavigation = (folderId: string | null, depth = 0): React.ReactNode => (
    <>
      {visibleNavigationPages.filter((page) => page.folderId === folderId).map((summary) => {
        const page = effectivePages.find((candidate) => candidate.id === summary.id);
        if (!page) return null;
        // The page's saved name; definitions don't carry one (migration strips it), so
        // getPageTitle would fall back to the route for pages that don't start with a text node.
        const title = summary.name?.trim() || getPageTitle(page);
        const icon = getPageIcon(page, metadata);
        return (
          <NavLink
            key={page.id}
            to={page.route}
            title={title}
            className={({ isActive }) => `app-sidebar-item ${isActive ? "active" : ""}`}
            style={{ paddingLeft: `${0.75 + depth * 0.9}rem` }}
            onClick={() => setMobileMenuOpen(false)}
          >
            <span className="app-sidebar-icon">{icon}</span>
            <span className="app-sidebar-item-title">{title}</span>
          </NavLink>
        );
      })}
      {(pageNavigation?.folders ?? []).filter((folder) => folder.parentId === folderId).map((folder) => (
        <details key={folder.id} open>
          <summary style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.6rem 0.75rem", paddingLeft: `${0.75 + depth * 0.9}rem`, cursor: "pointer", color: "var(--text-muted)", listStyle: "none" }}>
            {folder.icon ? <DynamicIcon name={folder.icon} size={16} /> : <Folder size={16} />}
            <span className="app-sidebar-item-title">{folder.name}</span>
          </summary>
          {renderNavigation(folder.id, depth + 1)}
        </details>
      ))}
    </>
  );

  return (
    <div
      style={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <DateSettingsProvider>
      <AppBarProvider routeKey={location.pathname}>
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
          className="app-header-inner"
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
              <Zap size={16} /> <span className="header-brand-text">ConfigPlatform</span>
            </NavLink>

            <span className="header-studio" style={{ color: "var(--border)" }}>|</span>

            {/* Studio Navigation in Navbar (desktop: building happens on a big screen) */}
            <nav
              className="header-studio"
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
                to="/studio/export-templates"
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
                Export Templates
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
              {user.isPlatformAdmin && (
                <NavLink
                  to="/studio/platform"
                  title="Settings for the whole server: email service, sign-ups, website address"
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
                  Platform
                </NavLink>
              )}
            </nav>
          </div>

          {/* User Profile, Theme Mode Switch & Tenant Badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--spacing-3)",
            }}
          >
            <WorkspaceSwitcher
              currentTenantId={user.tenantId}
              defaultName={user.tenantName}
            />

            <span
              className="header-detail"
              style={{
                fontSize: "var(--font-size-xs)",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                padding: "var(--spacing-1) var(--spacing-2)",
                borderRadius: "var(--radius-control)",
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
              className="header-detail"
              style={{
                fontSize: "var(--font-size-xs)",
                fontWeight: 500,
                color: "var(--text)",
              }}
            >
              {user.email}
            </span>

            {/* Phones: these move into the "⋯" menu below */}
            <span className="header-desktop-controls">
              <DatePreferencesButton />
              <ThemeModeSwitch compact />
            </span>
            <HeaderMobileMenu email={user.email} role={user.role} onLogout={logout} />

            <button
              type="button"
              className="btn btn-ghost header-desktop-controls"
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
              <span className="header-label">Log out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Body */}
      {isStudioRoute ? (
        /* Standard studio screens use the theme's Layout container (.page-container);
           full-bleed workspaces (Page Builder, Grid Designer) render without it. */
        <main
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflowY: "auto",
          }}
        >
          <React.Suspense fallback={<StudioLoadingFallback />}>
            <Routes>
              <Route
                path="/studio/data"
                element={<div className="page-container"><EntityManager /></div>}
              />
              <Route
                path="/studio/pages"
                element={<div className="page-container"><PageManager /></div>}
              />
              {user.isPlatformAdmin && (
                <Route
                  path="/studio/platform"
                  element={<div className="page-container"><PlatformSetup /></div>}
                />
              )}
              <Route
                path="/studio/report-schedules"
                element={<div className="page-container"><ReportSchedules /></div>}
              />
              <Route
                path="/studio/export-templates"
                element={<div className="page-container"><ExportTemplatesManager /></div>}
              />
              <Route
                path="/studio/permissions"
                element={<div className="page-container"><PermissionsManager /></div>}
              />
              <Route
                path="/studio/settings"
                element={<div className="page-container"><WorkspaceSettings /></div>}
              />
              <Route
                path="/studio/theme"
                // Always full width: settings and live preview sit side by side
                element={<div className="page-container page-container-full"><ThemeStudio /></div>}
              />
              {/* Full-bleed workspaces */}
              <Route
                path="/studio/export-templates/:id/designer"
                element={<GridTemplateDesigner />}
              />
              <Route path="/studio/pages/:id" element={<PageBuilder />} />
            </Routes>
          </React.Suspense>
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
              ) : renderNavigation(null)}
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
      </AppBarProvider>
      </DateSettingsProvider>
    </div>
  );
}

function AuthenticatedApp() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100%",
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
              borderRadius: "var(--radius-control)",
              backgroundColor: "var(--accent-subtle)",
              color: "var(--accent)",
              marginBottom: "1rem",
            }}
          >
            <Zap size={28} />
          </div>
          <p
            style={{
              color: "var(--text-muted)",
              fontSize: "var(--font-size-sm)",
            }}
          >
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

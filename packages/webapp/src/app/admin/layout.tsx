"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FolderKanban,
  Plug,
  ChevronLeft,
  ChevronRight,
  LogOut,
} from "lucide-react";
import { LogoMark } from "@/components/logo";
import { AdminProvider, useAdmin } from "@/lib/admin";

const navItems = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/projects", label: "Projects", icon: FolderKanban },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminProvider>
      <AdminShell>{children}</AdminShell>
    </AdminProvider>
  );
}

function AdminShell({ children }: { children: ReactNode }) {
  const { serverUrl, apiKey, connected, connect, disconnect } = useAdmin();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [formUrl, setFormUrl] = useState(serverUrl);
  const [formKey, setFormKey] = useState("");

  function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    connect(formUrl.replace(/\/+$/, ""), formKey);
  }

  const isActive = (href: string) => {
    if (href === "/admin") return pathname === "/admin";
    return pathname.startsWith(href);
  };

  return (
    <div className="flex min-h-screen">
      <aside
        className={`flex flex-col border-r border-border bg-card transition-all duration-200 ${
          sidebarOpen ? "w-56" : "w-14"
        }`}
      >
        <div className="flex h-14 items-center gap-2 border-b border-border px-3">
          <LogoMark className="h-6 shrink-0 text-primary" />
          {sidebarOpen && (
            <span className="text-sm font-semibold tracking-tight">Weysabi Admin</span>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="ml-auto rounded-md p-1 hover:bg-muted transition-colors"
          >
            {sidebarOpen ? (
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive(item.href)
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              title={sidebarOpen ? undefined : item.label}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {sidebarOpen && <span>{item.label}</span>}
            </Link>
          ))}
        </nav>

        <div className="border-t border-border p-2">
          <div className="flex items-center gap-2 px-3 py-2">
            <span
              className={`h-2 w-2 rounded-full shrink-0 ${
                connected ? "bg-green-500" : "bg-red-500"
              }`}
            />
            {sidebarOpen && (
              <span className="text-xs text-muted-foreground">
                {connected ? "Connected" : "Disconnected"}
              </span>
            )}
            {sidebarOpen && connected && (
              <button
                onClick={disconnect}
                className="ml-auto rounded-md p-1 hover:bg-muted transition-colors"
                title="Disconnect"
              >
                <LogOut className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {!connected && (
          <div className="border-b border-border bg-card px-6 py-4">
            <form onSubmit={handleConnect} className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs text-muted-foreground mb-1 font-medium">
                  Server URL
                </label>
                <input
                  type="text"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder="http://localhost:3000"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
                />
              </div>
              <div className="flex-1 min-w-[140px]">
                <label className="block text-xs text-muted-foreground mb-1 font-medium">
                  Admin API Key
                </label>
                <input
                  type="password"
                  value={formKey}
                  onChange={(e) => setFormKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
                />
              </div>
              <button
                type="submit"
                className="inline-flex h-[38px] items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground shadow transition-all hover:bg-primary/90"
              >
                <Plug className="h-4 w-4 mr-1.5" />
                Connect
              </button>
            </form>
          </div>
        )}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

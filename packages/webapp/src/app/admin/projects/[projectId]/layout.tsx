"use client";

import { useState, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import {
  BarChart3,
  MessageSquare,
  Activity,
  FileText,
  KeyRound,
  Settings,
  ChevronLeft,
} from "lucide-react";
import { useAdmin } from "@/lib/admin";

export default function ProjectLayout({ children }: { children: ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();
  const pathname = usePathname();
  const { apiFetch } = useAdmin();
  const [projectName, setProjectName] = useState("");

  useEffect(() => {
    apiFetch(`/v1/projects/${projectId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (p) setProjectName((p as { name: string }).name);
      })
      .catch(() => {});
  }, [projectId, apiFetch]);

  const base = `/admin/projects/${projectId}`;
  const tabs = [
    { href: base, label: "Overview", icon: Settings, exact: true },
    { href: `${base}/prompts`, label: "Prompts", icon: MessageSquare },
    { href: `${base}/conversations`, label: "Conversations", icon: Activity },
    { href: `${base}/runs`, label: "Runs", icon: BarChart3 },
    { href: `${base}/documents`, label: "Documents", icon: FileText },
    { href: `${base}/api-keys`, label: "API Keys", icon: KeyRound },
  ];

  const isActive = (tab: (typeof tabs)[0]) => {
    if (tab.exact) return pathname === tab.href;
    return pathname.startsWith(tab.href);
  };

  return (
    <div>
      <div className="border-b border-border bg-card">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex items-center gap-3 py-4">
            <Link
              href="/admin/projects"
              className="rounded-md p-1 hover:bg-muted transition-colors"
            >
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            </Link>
            <div>
              <h1 className="text-lg font-bold">{projectName || "Loading..."}</h1>
            </div>
          </div>
          <nav className="flex gap-1 -mb-px">
            {tabs.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex items-center gap-2 px-4 py-3 text-sm border-b-2 transition-colors ${
                  isActive(tab)
                    ? "border-primary text-foreground font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-6 py-6">{children}</div>
    </div>
  );
}

"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

const DEFAULTS = {
  url: (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_SABI_ADMIN_URL) || "",
};

function getStored(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key) ?? fallback;
}

function setStored(key: string, value: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem(key, value);
  }
}

interface Project {
  id: string;
  name: string;
  slug: string;
  metadata: Record<string, unknown>;
  settings: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

interface AdminContextValue {
  serverUrl: string;
  apiKey: string;
  connected: boolean;
  connect: (url: string, key: string) => void;
  disconnect: () => void;
  projects: Project[];
  loading: boolean;
  error: string | null;
  refreshProjects: () => Promise<void>;
  apiFetch: (path: string, options?: RequestInit) => Promise<Response>;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
  const [serverUrl, setServerUrl] = useState(() => getStored("sabi_admin_url", DEFAULTS.url));
  const [apiKey, setApiKey] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = !!serverUrl;

  const apiFetch = useCallback(
    async (path: string, options?: RequestInit): Promise<Response> => {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        ...(options?.headers as Record<string, string>),
      };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      const res = await fetch(`${serverUrl}${path}`, { ...options, headers });
      return res;
    },
    [serverUrl, apiKey]
  );

  const refreshProjects = useCallback(async () => {
    if (!serverUrl) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/v1/projects");
      if (!res.ok) throw new Error(`Failed to load projects: ${res.status}`);
      const data = (await res.json()) as { items: Project[]; total: number };
      setProjects(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, serverUrl]);

  useEffect(() => {
    if (serverUrl) {
      refreshProjects();
    }
  }, [serverUrl, refreshProjects]);

  function connect(url: string, key: string) {
    setApiKey(key);
    setServerUrl(url);
    setStored("sabi_admin_url", url);
  }

  function disconnect() {
    setServerUrl("");
    setApiKey("");
    setProjects([]);
    setError(null);
  }

  return (
    <AdminContext.Provider
      value={{
        serverUrl,
        apiKey,
        connected,
        connect,
        disconnect,
        projects,
        loading,
        error,
        refreshProjects,
        apiFetch,
      }}
    >
      {children}
    </AdminContext.Provider>
  );
}

export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used within AdminProvider");
  return ctx;
}

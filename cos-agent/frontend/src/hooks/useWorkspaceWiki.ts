import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.ts";

export const WORKSPACE_WIKI_PAGES_KEY = ["workspace", "wiki-pages"] as const;

export type WorkspaceWikiPage = {
  id: string;
  tenant_id: string;
  slug: string;
  title: string;
  body_md: string;
  frontmatter_json: Record<string, unknown>;
  scope_tenant: "tenant";
  scope_audience: "user" | "team" | "company" | "platform";
  owner_user_id: string | null;
  status: "draft" | "approved" | "deprecated";
  version: number;
  created_at: string;
  updated_at: string;
};

export type WikiOutgoingLink = {
  to_slug: string;
  to_page_id: string | null;
  target_title: string | null;
  resolved: boolean;
};

export type WikiBacklink = {
  from_page_id: string;
  from_slug: string;
  from_title: string;
};

export function useWorkspaceWikiPageBySlug(enabled: boolean, slug: string) {
  const enc = encodeURIComponent(slug);
  return useQuery({
    queryKey: ["workspace", "wiki-page-slug", slug] as const,
    queryFn: () =>
      api.get<WorkspaceWikiPage>(`/api/workspace/wiki-pages/by-slug/${enc}`),
    enabled: enabled && slug.length > 0,
  });
}

export function useWorkspaceWikiOutgoingLinks(enabled: boolean, pageId: string) {
  return useQuery({
    queryKey: ["workspace", "wiki-outgoing", pageId] as const,
    queryFn: () =>
      api.get<WikiOutgoingLink[]>(
        `/api/workspace/wiki-pages/${encodeURIComponent(pageId)}/outgoing-links`,
      ),
    enabled: enabled && pageId.length > 0,
  });
}

export function useWorkspaceWikiBacklinks(enabled: boolean, pageId: string) {
  return useQuery({
    queryKey: ["workspace", "wiki-backlinks", pageId] as const,
    queryFn: () =>
      api.get<WikiBacklink[]>(
        `/api/workspace/wiki-pages/${encodeURIComponent(pageId)}/backlinks`,
      ),
    enabled: enabled && pageId.length > 0,
  });
}

export function useWorkspaceWikiPages(enabled: boolean, status: string | null) {
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return useQuery({
    queryKey: [...WORKSPACE_WIKI_PAGES_KEY, status ?? ""] as const,
    queryFn: () =>
      api.get<WorkspaceWikiPage[]>(`/api/workspace/wiki-pages${suffix}`),
    enabled,
  });
}

export function useCreateWorkspaceWikiPage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      slug: string;
      title: string;
      body_md?: string;
      scope_audience?: string;
      frontmatter_json?: Record<string, unknown>;
      status?: string;
    }) => api.post<WorkspaceWikiPage>("/api/workspace/wiki-pages", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: WORKSPACE_WIKI_PAGES_KEY });
      void qc.invalidateQueries({ queryKey: ["workspace", "wiki-page-slug"] });
      void qc.invalidateQueries({ queryKey: ["workspace", "wiki-outgoing"] });
      void qc.invalidateQueries({ queryKey: ["workspace", "wiki-backlinks"] });
    },
  });
}

export function usePatchWorkspaceWikiPage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      id: string;
      patch: {
        slug?: string;
        title?: string;
        body_md?: string;
        scope_audience?: string;
        frontmatter_json?: Record<string, unknown>;
        status?: string;
      };
    }) =>
      api.patch<WorkspaceWikiPage>(
        `/api/workspace/wiki-pages/${args.id}`,
        args.patch,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: WORKSPACE_WIKI_PAGES_KEY });
      void qc.invalidateQueries({ queryKey: ["workspace", "wiki-page-slug"] });
      void qc.invalidateQueries({ queryKey: ["workspace", "wiki-outgoing"] });
      void qc.invalidateQueries({ queryKey: ["workspace", "wiki-backlinks"] });
    },
  });
}

export function useDeleteWorkspaceWikiPage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ deleted: boolean }>(`/api/workspace/wiki-pages/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: WORKSPACE_WIKI_PAGES_KEY });
      void qc.invalidateQueries({ queryKey: ["workspace", "wiki-page-slug"] });
      void qc.invalidateQueries({ queryKey: ["workspace", "wiki-outgoing"] });
      void qc.invalidateQueries({ queryKey: ["workspace", "wiki-backlinks"] });
    },
  });
}

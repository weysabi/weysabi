import type { ProjectStore } from "./store";
import type { Project, Page } from "./types";
import { CreateProjectInputSchema, UpdateProjectInputSchema, PageOptionsSchema } from "./types";

export function createProjectService(store: ProjectStore) {
  return {
    async create(input: unknown): Promise<Project> {
      const parsed = CreateProjectInputSchema.parse(input);
      return store.create(parsed);
    },

    async get(projectId: string): Promise<Project | null> {
      return store.get(projectId);
    },

    async getBySlug(slug: string): Promise<Project | null> {
      return store.getBySlug(slug);
    },

    async list(options?: unknown): Promise<Page<Project>> {
      const parsed = PageOptionsSchema.parse(options ?? {});
      return store.list(parsed);
    },

    async update(projectId: string, input: unknown): Promise<Project> {
      const parsed = UpdateProjectInputSchema.parse(input);
      return store.update(projectId, parsed);
    },

    async delete(projectId: string): Promise<void> {
      return store.delete(projectId);
    },
  };
}

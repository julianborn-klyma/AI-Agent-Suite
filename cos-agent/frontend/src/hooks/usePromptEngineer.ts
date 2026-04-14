import { useCallback, useRef, useState } from "react";
import { ApiError, api } from "../lib/api.ts";

export type OptimizedPrompt = {
  system_prompt: string;
  user_prompt: string;
  search_queries: string[];
  recommended_model: "haiku" | "sonnet" | "opus";
  estimated_complexity: "low" | "medium" | "high";
};

export function usePromptEngineer() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const classifyTimer = useRef<number | null>(null);
  const classifyResolvers = useRef<
    Array<(v: "low" | "medium" | "high") => void>
  >([]);

  const optimize = useCallback(async (rawRequest: string, taskType: string) => {
    setIsLoading(true);
    setError(null);
    try {
      return await api.post<OptimizedPrompt>("/api/prompt-engineer/optimize", {
        raw_request: rawRequest,
        task_type: taskType,
      });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
          ? e.message
          : String(e);
      setError(msg);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getSearchQueries = useCallback(async (rawRequest: string, numQueries?: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const r = await api.post<{ queries: string[] }>(
        "/api/prompt-engineer/search-queries",
        { raw_request: rawRequest, num_queries: numQueries },
      );
      return r.queries;
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
          ? e.message
          : String(e);
      setError(msg);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const classifyComplexity = useCallback((message: string) => {
    return new Promise<"low" | "medium" | "high">((resolve) => {
      classifyResolvers.current.push(resolve);
      if (classifyTimer.current !== null) {
        window.clearTimeout(classifyTimer.current);
      }
      classifyTimer.current = window.setTimeout(async () => {
        classifyTimer.current = null;
        const resolvers = classifyResolvers.current.splice(0);
        try {
          const r = await api.post<{ complexity: "low" | "medium" | "high" }>(
            "/api/prompt-engineer/classify",
            { message },
          );
          const c = r.complexity;
          for (const fn of resolvers) fn(c);
        } catch {
          for (const fn of resolvers) fn("medium");
        }
      }, 300);
    });
  }, []);

  return {
    optimize,
    getSearchQueries,
    classifyComplexity,
    isLoading,
    error,
  };
}

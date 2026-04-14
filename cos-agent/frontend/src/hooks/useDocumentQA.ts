import { useCallback, useState } from "react";
import { api } from "../lib/api.ts";

export type QAMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Array<{
    chunk_index: number;
    page_number?: number;
    section_title?: string;
    excerpt: string;
  }>;
};

export type DocumentVerification = {
  sections_found: string[];
  missing_sections: string[];
  contradictions: Array<{
    description: string;
    chunk_a: number;
    chunk_b: number;
  }>;
  critical_assumptions: string[];
  overall_assessment: string;
};

export function useDocumentQA(documentId: string) {
  const [messages, setMessages] = useState<QAMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [verification, setVerification] = useState<DocumentVerification | null>(
    null,
  );

  const askQuestion = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed || isLoading) return;
      const userMsg: QAMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
      };
      setMessages((m) => [...m, userMsg]);
      setIsLoading(true);
      try {
        const data = await api.post<{
          answer: string;
          sources: QAMessage["sources"];
          chunksSearched: number;
        }>(`/api/documents/${encodeURIComponent(documentId)}/ask`, {
          question: trimmed,
        });
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: data.answer,
            sources: data.sources,
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [documentId, isLoading],
  );

  const runVerification = useCallback(async () => {
    setIsLoading(true);
    try {
      const v = await api.post<DocumentVerification>(
        `/api/documents/${encodeURIComponent(documentId)}/verify`,
        {},
      );
      setVerification(v);
    } finally {
      setIsLoading(false);
    }
  }, [documentId]);

  const clearVerification = useCallback(() => setVerification(null), []);

  return {
    messages,
    isLoading,
    askQuestion,
    verification,
    runVerification,
    clearVerification,
  };
}

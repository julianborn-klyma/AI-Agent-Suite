import { assertEquals } from "@std/assert";
import {
  canAutoApprovePersonalWikiPage,
  isPersonalWikiSlug,
} from "./personalWikiConstants.ts";

Deno.test("isPersonalWikiSlug — nur me-* Slugs", () => {
  assertEquals(isPersonalWikiSlug("me-index"), true);
  assertEquals(isPersonalWikiSlug("company-handbook"), false);
});

Deno.test("canAutoApprovePersonalWikiPage — nur user + Owner + me-*", () => {
  assertEquals(
    canAutoApprovePersonalWikiPage({
      slug: "me-index",
      scope_audience: "user",
      owner_user_id: "u1",
      editorUserId: "u1",
    }),
    true,
  );
  assertEquals(
    canAutoApprovePersonalWikiPage({
      slug: "me-index",
      scope_audience: "company",
      owner_user_id: null,
      editorUserId: "u1",
    }),
    false,
  );
  assertEquals(
    canAutoApprovePersonalWikiPage({
      slug: "handbuch",
      scope_audience: "user",
      owner_user_id: "u1",
      editorUserId: "u1",
    }),
    false,
  );
});

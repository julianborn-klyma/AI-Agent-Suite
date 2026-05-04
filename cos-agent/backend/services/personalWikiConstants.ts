/** Erlaubte Slugs für automatisch gepflegtes persönliches Wiki (scope_audience=user). */
export const PERSONAL_WIKI_SLUGS = [
  "me-index",
  "me-entscheidungen",
  "me-kommunikation",
  "me-lernen",
] as const;

export type PersonalWikiSlug = (typeof PERSONAL_WIKI_SLUGS)[number];

export const PERSONAL_WIKI_PAGES: {
  slug: PersonalWikiSlug;
  title: string;
  initialBody: string;
}[] = [
  {
    slug: "me-index",
    title: "Über mich",
    initialBody:
      "# Persönliches Wiki\n\nDiese Seiten unter **me-*** werden aus deinen Tages-Signalen (E-Mail-, Slack-Zusammenfassungen) und aus dem Daily Check-in ergänzt. Nur du als Besitzer:in — automatisch **freigegeben**.\n",
  },
  {
    slug: "me-entscheidungen",
    title: "Entscheidungen & Prioritäten",
    initialBody:
      "# Entscheidungen & Prioritäten\n\nHier landen verdichtete Entscheidungen und Prioritäten aus deinen Signalen.\n",
  },
  {
    slug: "me-kommunikation",
    title: "Kommunikation",
    initialBody:
      "# Kommunikation\n\nKurznotizen aus E-Mail- und Slack-Tageszusammenfassungen.\n",
  },
  {
    slug: "me-lernen",
    title: "Was ich lerne",
    initialBody:
      "# Was ich lerne\n\nExtrahierte Learnings und Reflexionen aus dem Chat.\n",
  },
];

export function isPersonalWikiSlug(slug: string): slug is PersonalWikiSlug {
  return (PERSONAL_WIKI_SLUGS as readonly string[]).includes(slug);
}

/** Auto-approve nur für persönliche User-Seiten mit passendem Owner. */
export function canAutoApprovePersonalWikiPage(params: {
  slug: string;
  scope_audience: string;
  owner_user_id: string | null;
  editorUserId: string;
}): boolean {
  if (params.scope_audience !== "user") return false;
  if (!params.owner_user_id || params.owner_user_id !== params.editorUserId) {
    return false;
  }
  return isPersonalWikiSlug(params.slug);
}

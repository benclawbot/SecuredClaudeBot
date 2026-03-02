/**
 * Link Parser — extracts readable content from web pages.
 * Uses @mozilla/readability + linkedom for server-side DOM parsing.
 */
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { createChildLogger } from "../logger/index.js";
import { isUrlSafe } from "../security/ssrf.js";

const log = createChildLogger("links");

export interface ParsedLink {
  url: string;
  title: string;
  content: string;
  excerpt: string;
  siteName?: string;
  byline?: string;
  wordCount: number;
  fetchedAt: number;
}

/**
 * Fetch and parse a URL into readable text content.
 */
export async function parseLink(url: string): Promise<ParsedLink> {
  if (!isUrlSafe(url)) {
    throw new Error(`URL blocked by SSRF policy: ${url}`);
  }

  log.info({ url }, "Fetching link");

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; SecureClaudebot/1.0; +https://github.com/benclawbot/SecuredClaudeBot)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();

  // Parse with linkedom (server-side DOM)
  const { document } = parseHTML(html);

  // Extract with Readability
  const reader = new Readability(document as any);
  const article = reader.parse();

  if (!article) {
    // Fallback: extract text from body
    const bodyText = document.body?.textContent?.trim().slice(0, 5000) ?? "";
    return {
      url,
      title: document.title ?? url,
      content: bodyText,
      excerpt: bodyText.slice(0, 200),
      wordCount: bodyText.split(/\s+/).length,
      fetchedAt: Date.now(),
    };
  }

  const content = article.textContent.trim();

  return {
    url,
    title: article.title,
    content,
    excerpt: article.excerpt ?? content.slice(0, 200),
    siteName: article.siteName ?? undefined,
    byline: article.byline ?? undefined,
    wordCount: content.split(/\s+/).length,
    fetchedAt: Date.now(),
  };
}

/**
 * Extract all links from HTML text.
 */
export function extractLinks(html: string): string[] {
  const { document } = parseHTML(html);
  const anchors = document.querySelectorAll("a[href]");
  const links: string[] = [];

  for (const a of anchors) {
    const href = a.getAttribute("href");
    if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
      links.push(href);
    }
  }

  return [...new Set(links)]; // Dedupe
}

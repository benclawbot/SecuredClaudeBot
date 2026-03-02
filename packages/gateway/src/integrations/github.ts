/**
 * GitHub Integration — interact with repos, issues, PRs via Octokit.
 */
import { Octokit } from "@octokit/rest";
import { createChildLogger } from "../logger/index.js";

const log = createChildLogger("integrations:github");

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  url: string;
  createdAt: string;
}

export interface GitHubPR {
  number: number;
  title: string;
  body: string;
  state: string;
  url: string;
  merged: boolean;
  createdAt: string;
}

export class GitHubClient {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
    log.info("GitHub client initialized");
  }

  async listRepos(perPage = 30): Promise<Array<{ name: string; fullName: string; url: string; stars: number }>> {
    const { data } = await this.octokit.repos.listForAuthenticatedUser({
      sort: "updated",
      per_page: perPage,
    });

    return data.map((r) => ({
      name: r.name,
      fullName: r.full_name,
      url: r.html_url,
      stars: r.stargazers_count,
    }));
  }

  async listIssues(owner: string, repo: string, state: "open" | "closed" | "all" = "open"): Promise<GitHubIssue[]> {
    const { data } = await this.octokit.issues.listForRepo({
      owner,
      repo,
      state,
      per_page: 30,
    });

    return data.map((i) => ({
      number: i.number,
      title: i.title,
      body: i.body ?? "",
      state: i.state,
      url: i.html_url,
      createdAt: i.created_at,
    }));
  }

  async createIssue(
    owner: string,
    repo: string,
    title: string,
    body: string
  ): Promise<GitHubIssue> {
    const { data } = await this.octokit.issues.create({
      owner,
      repo,
      title,
      body,
    });

    log.info({ owner, repo, issue: data.number }, "Issue created");

    return {
      number: data.number,
      title: data.title,
      body: data.body ?? "",
      state: data.state,
      url: data.html_url,
      createdAt: data.created_at,
    };
  }

  async listPRs(owner: string, repo: string, state: "open" | "closed" | "all" = "open"): Promise<GitHubPR[]> {
    const { data } = await this.octokit.pulls.list({
      owner,
      repo,
      state,
      per_page: 30,
    });

    return data.map((pr) => ({
      number: pr.number,
      title: pr.title,
      body: pr.body ?? "",
      state: pr.state,
      url: pr.html_url,
      merged: pr.merged_at !== null,
      createdAt: pr.created_at,
    }));
  }

  async getFileContent(owner: string, repo: string, path: string): Promise<string> {
    const { data } = await this.octokit.repos.getContent({
      owner,
      repo,
      path,
    });

    if ("content" in data && data.encoding === "base64") {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }

    throw new Error("Not a file or unsupported encoding");
  }
}

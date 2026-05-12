/**
 * GitHub Proxy API - Server-side GitHub operations
 * 
 * These functions call the backend which uses a server-side GitHub PAT.
 * Users don't need to configure their own PAT to fork repos and create PRs.
 * 
 * User can optionally provide their own token via the X-GitHub-Token header
 * by passing `userToken` to any function - this will override the server default.
 */

import { apiClient } from './client'

interface GitHubProxyResponse<T = Record<string, unknown>> {
  success: boolean
  data?: T
  error?: string
}

interface GitHubUser {
  login: string
  id: number
  avatar_url?: string
  name?: string
  using_server_token: boolean
}

interface RepoAccessInfo {
  has_push_access: boolean
  default_branch: string
  full_name: string
  private: boolean
  using_server_token: boolean
}

interface ForkInfo {
  owner: string
  repo: string
  full_name: string
  html_url: string
  default_branch?: string
  already_exists?: boolean
  using_server_token: boolean
}

interface BranchInfo {
  ref: string
  sha: string
  using_server_token: boolean
}

interface DefaultBranchInfo {
  sha: string
  ref: string
  using_server_token: boolean
}

interface CommitInfo {
  sha: string
  commit_sha: string
  using_server_token: boolean
}

interface PRInfo {
  number: number
  html_url: string
  state: string
  title: string
  using_server_token: boolean
}

interface ServerStatus {
  server_token_configured: boolean
  message: string
}

interface GitHubContentResponse {
  exists: boolean
  type: 'file' | 'directory' | null
  content?: string
  encoding?: string
  size?: number
  contents?: Array<{ name: string; path: string; type: string }>
}

// Helper to add user token header if provided
function getHeaders(userToken?: string): Record<string, string> {
  if (userToken) {
    return { 'X-GitHub-Token': userToken }
  }
  return {}
}

export const githubProxyApi = {
  /**
   * Check if server-side GitHub PAT is configured
   */
  async getStatus(): Promise<ServerStatus> {
    const response = await apiClient.get<ServerStatus>('/github/status')
    return response.data
  },

  /**
   * Get file contents (raw text) from a repository
   * Uses server-side PAT to avoid rate limits
   */
  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    userToken?: string
  ): Promise<string | null> {
    try {
      const response = await apiClient.get<GitHubContentResponse>(
        `/github/contents/${owner}/${repo}/${path}`,
        { 
          headers: getHeaders(userToken),
          params: { raw: true }
        }
      )
      if (response.data.exists && response.data.content) {
        return response.data.content
      }
      return null
    } catch {
      return null
    }
  },

  /**
   * Get directory contents from a repository
   * Uses server-side PAT to avoid rate limits
   */
  async getDirectoryContents(
    owner: string,
    repo: string,
    path: string,
    userToken?: string
  ): Promise<Array<{ name: string; path: string; type: string }>> {
    try {
      const response = await apiClient.get<GitHubContentResponse>(
        `/github/contents/${owner}/${repo}/${path}`,
        { headers: getHeaders(userToken) }
      )
      if (response.data.exists && response.data.type === 'directory' && response.data.contents) {
        return response.data.contents
      }
      return []
    } catch {
      return []
    }
  },

  /**
   * Check if a path exists in a repository
   * Uses server-side PAT to avoid rate limits
   */
  async pathExists(
    owner: string,
    repo: string,
    path: string,
    userToken?: string
  ): Promise<boolean> {
    try {
      const response = await apiClient.get<GitHubContentResponse>(
        `/github/contents/${owner}/${repo}/${path}`,
        { headers: getHeaders(userToken) }
      )
      return response.data.exists
    } catch {
      return false
    }
  },

  /**
   * Get current authenticated GitHub user
   * Uses server token by default, or user token if provided
   */
  async getUser(userToken?: string): Promise<GitHubProxyResponse<GitHubUser>> {
    const response = await apiClient.get<GitHubProxyResponse<GitHubUser>>(
      '/github/user',
      { headers: getHeaders(userToken) }
    )
    return response.data
  },

  /**
   * Check if authenticated user has push access to a repository
   */
  async checkAccess(
    owner: string,
    repo: string,
    userToken?: string
  ): Promise<GitHubProxyResponse<RepoAccessInfo>> {
    const response = await apiClient.post<GitHubProxyResponse<RepoAccessInfo>>(
      '/github/check-access',
      { owner, repo },
      { headers: getHeaders(userToken) }
    )
    return response.data
  },

  /**
   * Fork a repository
   */
  async forkRepo(
    owner: string,
    repo: string,
    userToken?: string
  ): Promise<GitHubProxyResponse<ForkInfo>> {
    const response = await apiClient.post<GitHubProxyResponse<ForkInfo>>(
      '/github/fork',
      { owner, repo },
      { headers: getHeaders(userToken) }
    )
    return response.data
  },

  /**
   * Create a new branch
   */
  async createBranch(
    owner: string,
    repo: string,
    branchName: string,
    baseSha: string,
    userToken?: string
  ): Promise<GitHubProxyResponse<BranchInfo>> {
    const response = await apiClient.post<GitHubProxyResponse<BranchInfo>>(
      '/github/branch',
      {
        owner,
        repo,
        branch_name: branchName,
        base_sha: baseSha,
      },
      { headers: getHeaders(userToken) }
    )
    return response.data
  },

  /**
   * Get default branch SHA
   */
  async getDefaultBranchRef(
    owner: string,
    repo: string,
    userToken?: string
  ): Promise<GitHubProxyResponse<DefaultBranchInfo>> {
    const response = await apiClient.get<GitHubProxyResponse<DefaultBranchInfo>>(
      `/github/repo/${owner}/${repo}/default-branch`,
      { headers: getHeaders(userToken) }
    )
    return response.data
  },

  /**
   * Commit a file to a repository
   */
  async commitFile(
    params: {
      owner: string
      repo: string
      path: string
      content: string
      branch: string
      message: string
    },
    userToken?: string
  ): Promise<GitHubProxyResponse<CommitInfo>> {
    const response = await apiClient.post<GitHubProxyResponse<CommitInfo>>(
      '/github/commit-file',
      params,
      { headers: getHeaders(userToken) }
    )
    return response.data
  },

  /**
   * Create a pull request
   */
  async createPullRequest(
    params: {
      owner: string
      repo: string
      title: string
      body: string
      head: string
      base: string
    },
    userToken?: string
  ): Promise<GitHubProxyResponse<PRInfo>> {
    const response = await apiClient.post<GitHubProxyResponse<PRInfo>>(
      '/github/pull-request',
      params,
      { headers: getHeaders(userToken) }
    )
    return response.data
  },
}

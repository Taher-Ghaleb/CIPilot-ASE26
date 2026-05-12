import axios from 'axios'
import type {
  GitHubRepo,
  GitHubUser,
  GitHubContent,
  GitHubBranch,
  GitHubPullRequest,
  CreatePRParams,
  CreateBranchParams,
  CommitFileParams,
} from '../types/github'

const GITHUB_API_URL = 'https://api.github.com'

// Get the correct auth scheme based on token type (matching Chrome extension)
function getAuthHeader(token: string): string {
  const classicPrefixes = ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_']
  const authScheme = classicPrefixes.some(prefix => token.startsWith(prefix)) ? 'token' : 'Bearer'
  return `${authScheme} ${token}`
}

// Create a separate axios instance for GitHub API
function createGitHubClient(token: string) {
  return axios.create({
    baseURL: GITHUB_API_URL,
    headers: {
      Authorization: getAuthHeader(token),
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
}

// Direct fetch helper for GitHub API (matching Chrome extension EXACTLY)
// Chrome extension uses simpler headers without X-GitHub-Api-Version
async function ghFetch<T>(
  token: string,
  endpoint: string,
  options: { method?: string; body?: unknown } = {}
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  const url = endpoint.startsWith('http') ? endpoint : `${GITHUB_API_URL}${endpoint}`

  // Use correct auth scheme for classic vs fine-grained tokens
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: getAuthHeader(token),
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  const text = await response.text()
  let data: T | null = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }

  if (!response.ok) {
    const errorMsg = (data as any)?.message || response.statusText
    console.error('[GitHub API Error]', {
      status: response.status,
      endpoint,
      error: errorMsg,
      data,
    })
    return { ok: false, status: response.status, data, error: errorMsg }
  }

  return { ok: true, status: response.status, data }
}

export const githubApi = {
  /**
   * Get current authenticated user
   */
  async getUser(token: string): Promise<GitHubUser> {
    const client = createGitHubClient(token)
    const response = await client.get<GitHubUser>('/user')
    return response.data
  },

  /**
   * Get user's repositories
   */
  async getUserRepos(
    token: string,
    options: { page?: number; perPage?: number; sort?: 'updated' | 'created' | 'pushed' } = {}
  ): Promise<GitHubRepo[]> {
    const { page = 1, perPage = 30, sort = 'updated' } = options
    const client = createGitHubClient(token)
    const response = await client.get<GitHubRepo[]>('/user/repos', {
      params: { page, per_page: perPage, sort },
    })
    return response.data
  },

  /**
   * Get repository details
   */
  async getRepo(token: string, owner: string, repo: string): Promise<GitHubRepo> {
    const client = createGitHubClient(token)
    const response = await client.get<GitHubRepo>(`/repos/${owner}/${repo}`)
    return response.data
  },

  /**
   * Get file content from repository
   */
  async getFileContent(
    token: string,
    owner: string,
    repo: string,
    path: string,
    ref?: string
  ): Promise<GitHubContent> {
    const client = createGitHubClient(token)
    const response = await client.get<GitHubContent>(`/repos/${owner}/${repo}/contents/${path}`, {
      params: ref ? { ref } : {},
    })
    return response.data
  },

  /**
   * Get repository contents (list files/directories)
   */
  async getContents(
    token: string,
    owner: string,
    repo: string,
    path = '',
    ref?: string
  ): Promise<GitHubContent[]> {
    const client = createGitHubClient(token)
    const response = await client.get<GitHubContent | GitHubContent[]>(
      `/repos/${owner}/${repo}/contents/${path}`,
      { params: ref ? { ref } : {} }
    )
    // API returns single object for files, array for directories
    return Array.isArray(response.data) ? response.data : [response.data]
  },

  /**
   * Get repository branches
   */
  async getBranches(token: string, owner: string, repo: string): Promise<GitHubBranch[]> {
    const client = createGitHubClient(token)
    const response = await client.get<GitHubBranch[]>(`/repos/${owner}/${repo}/branches`)
    return response.data
  },

  /**
   * Get default branch ref (for creating new branches) - using ghFetch for consistency
   */
  async getDefaultBranchRef(
    token: string,
    owner: string,
    repo: string
  ): Promise<{ sha: string; ref: string }> {
    const repoData = await this.getRepo(token, owner, repo)

    console.log(`[getDefaultBranchRef] Getting ref for ${owner}/${repo} branch ${repoData.default_branch}`)

    const result = await ghFetch<{ object: { sha: string } }>(
      token,
      `/repos/${owner}/${repo}/git/ref/heads/${repoData.default_branch}`
    )

    if (!result.ok || !result.data) {
      console.error('[getDefaultBranchRef] Failed:', result.status, result.error)
      throw new Error(result.error || 'Failed to get default branch ref')
    }

    console.log(`[getDefaultBranchRef] SHA: ${result.data.object.sha}`)

    return {
      sha: result.data.object.sha,
      ref: repoData.default_branch,
    }
  },

  /**
   * Create a new branch (matching Chrome extension - simple, no extra verification)
   */
  async createBranch(token: string, params: CreateBranchParams): Promise<void> {
    const { owner, repo, branchName, baseSha } = params

    console.log(`[createBranch] Creating ${branchName} from SHA ${baseSha}`)

    const result = await ghFetch<{ ref: string; object: { sha: string } }>(
      token,
      `/repos/${owner}/${repo}/git/refs`,
      {
        method: 'POST',
        body: {
          ref: `refs/heads/${branchName}`,
          sha: baseSha,
        },
      }
    )

    if (!result.ok) {
      console.error('[createBranch] Failed:', result.status, result.error)
      if (result.status === 422) {
        throw Object.assign(new Error('Branch already exists'), { response: { status: 422 } })
      }
      throw new Error(result.error || 'Failed to create branch')
    }

    console.log('[createBranch] Branch created successfully')
  },

  /**
   * Check if a branch exists
   */
  async branchExists(token: string, owner: string, repo: string, branchName: string): Promise<boolean> {
    const client = createGitHubClient(token)
    try {
      await client.get(`/repos/${owner}/${repo}/git/ref/heads/${branchName}`)
      return true
    } catch {
      return false
    }
  },

  /**
   * Get branch ref
   */
  async getBranchRef(
    token: string,
    owner: string,
    repo: string,
    branchName: string
  ): Promise<{ sha: string } | null> {
    const client = createGitHubClient(token)
    try {
      const response = await client.get<{ object: { sha: string } }>(
        `/repos/${owner}/${repo}/git/ref/heads/${branchName}`
      )
      return { sha: response.data.object.sha }
    } catch {
      return null
    }
  },

  /**
   * Commit a file to repository using Contents API
   */
  async commitFile(token: string, params: CommitFileParams): Promise<{ sha: string }> {
    const { owner, repo, path, message, content, branch, sha } = params
    const client = createGitHubClient(token)
    const response = await client.put<{ content: { sha: string } }>(
      `/repos/${owner}/${repo}/contents/${path}`,
      {
        message,
        content, // Must be base64 encoded
        branch,
        sha, // Include if updating existing file
      }
    )
    return { sha: response.data.content.sha }
  },

  /**
   * Create a file using Git Data API (low-level approach)
   * This is more reliable than Contents API for newly created branches
   */
  async createFileViaGitData(
    token: string,
    params: {
      owner: string
      repo: string
      path: string
      content: string // UTF-8 string
      branch: string
      message: string
    }
  ): Promise<void> {
    const { owner, repo, path, content, branch, message } = params

    console.log(`[createFileViaGitData] ${owner}/${repo}/${path} on branch ${branch}`)

    // Step 1: Create a blob with the file content
    console.log('[createFileViaGitData] Step 1: Creating blob...')
    const blobResult = await ghFetch<{ sha: string }>(
      token,
      `/repos/${owner}/${repo}/git/blobs`,
      {
        method: 'POST',
        body: {
          content: this.encodeContent(content),
          encoding: 'base64',
        },
      }
    )

    if (!blobResult.ok || !blobResult.data) {
      console.error('[createFileViaGitData] Failed to create blob:', blobResult.error)
      throw new Error(blobResult.error || 'Failed to create blob')
    }
    const blobSha = blobResult.data.sha
    console.log(`[createFileViaGitData] Blob created: ${blobSha}`)

    // Step 2: Get the current commit SHA for the branch
    console.log('[createFileViaGitData] Step 2: Getting branch ref...')
    const refResult = await ghFetch<{ object: { sha: string } }>(
      token,
      `/repos/${owner}/${repo}/git/ref/heads/${branch}`
    )

    if (!refResult.ok || !refResult.data) {
      console.error('[createFileViaGitData] Failed to get branch ref:', refResult.error)
      throw new Error(refResult.error || 'Failed to get branch ref')
    }
    const currentCommitSha = refResult.data.object.sha
    console.log(`[createFileViaGitData] Current commit: ${currentCommitSha}`)

    // Step 3: Get the tree SHA of the current commit
    console.log('[createFileViaGitData] Step 3: Getting current tree...')
    const commitResult = await ghFetch<{ tree: { sha: string } }>(
      token,
      `/repos/${owner}/${repo}/git/commits/${currentCommitSha}`
    )

    if (!commitResult.ok || !commitResult.data) {
      console.error('[createFileViaGitData] Failed to get commit:', commitResult.error)
      throw new Error(commitResult.error || 'Failed to get commit')
    }
    const baseTreeSha = commitResult.data.tree.sha
    console.log(`[createFileViaGitData] Base tree: ${baseTreeSha}`)

    // Step 4: Create a new tree with the file
    console.log('[createFileViaGitData] Step 4: Creating new tree...')
    const treeResult = await ghFetch<{ sha: string }>(
      token,
      `/repos/${owner}/${repo}/git/trees`,
      {
        method: 'POST',
        body: {
          base_tree: baseTreeSha,
          tree: [
            {
              path: path,
              mode: '100644', // Regular file
              type: 'blob',
              sha: blobSha,
            },
          ],
        },
      }
    )

    if (!treeResult.ok || !treeResult.data) {
      console.error('[createFileViaGitData] Failed to create tree:', treeResult.error)
      throw new Error(treeResult.error || 'Failed to create tree')
    }
    const newTreeSha = treeResult.data.sha
    console.log(`[createFileViaGitData] New tree: ${newTreeSha}`)

    // Step 5: Create a new commit
    console.log('[createFileViaGitData] Step 5: Creating commit...')
    const newCommitResult = await ghFetch<{ sha: string }>(
      token,
      `/repos/${owner}/${repo}/git/commits`,
      {
        method: 'POST',
        body: {
          message: message,
          tree: newTreeSha,
          parents: [currentCommitSha],
        },
      }
    )

    if (!newCommitResult.ok || !newCommitResult.data) {
      console.error('[createFileViaGitData] Failed to create commit:', newCommitResult.error)
      throw new Error(newCommitResult.error || 'Failed to create commit')
    }
    const newCommitSha = newCommitResult.data.sha
    console.log(`[createFileViaGitData] New commit: ${newCommitSha}`)

    // Step 6: Update the branch ref to point to the new commit
    console.log('[createFileViaGitData] Step 6: Updating branch ref...')
    const updateRefResult = await ghFetch<{ ref: string }>(
      token,
      `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
      {
        method: 'PATCH',
        body: {
          sha: newCommitSha,
          force: false,
        },
      }
    )

    if (!updateRefResult.ok) {
      console.error('[createFileViaGitData] Failed to update ref:', updateRefResult.error)
      throw new Error(updateRefResult.error || 'Failed to update branch ref')
    }

    console.log('[createFileViaGitData] File created successfully!')
  },

  /**
   * Upsert a file using Contents API (matching Chrome extension exactly)
   */
  async upsertFile(
    token: string,
    params: {
      owner: string
      repo: string
      path: string
      content: string // UTF-8 string (not base64)
      branch: string
      message: string
    }
  ): Promise<void> {
    const { owner, repo, path, content, branch, message } = params

    console.log(`[upsertFile] ${owner}/${repo}/${path} on branch ${branch}`)

    // Check if file exists to get its SHA (required for updates)
    // This may return 404 if file doesn't exist - that's OK
    const checkUrl = `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`
    console.log(`[upsertFile] Checking if file exists: ${checkUrl}`)
    const existing = await ghFetch<{ sha?: string }>(token, checkUrl)
    const sha = existing.ok && existing.data?.sha ? existing.data.sha : undefined
    console.log(`[upsertFile] File exists: ${existing.ok}, SHA: ${sha || 'none'}`)

    // Build payload - matching Chrome extension exactly
    const payload: Record<string, string> = {
      message,
      content: this.encodeContent(content),
      branch,
    }
    if (sha) {
      payload.sha = sha
    }

    // PUT the file using Contents API
    const putUrl = `/repos/${owner}/${repo}/contents/${path}`
    console.log(`[upsertFile] Committing to: ${putUrl}`)
    console.log(`[upsertFile] Payload:`, { message, branch, hasContent: true, hasSha: !!sha })

    let lastError: string | undefined

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await ghFetch<{ content: { sha: string } }>(token, putUrl, {
        method: 'PUT',
        body: payload,
      })

      if (result.ok) {
        console.log('[upsertFile] File committed successfully!')
        return
      }

      console.error('[upsertFile] Failed to commit file:', result.error, result.data)
      lastError = result.error || 'Failed to commit workflow file'

      // Special handling for workflow permission errors
      if (result.status === 404) {
        const isWorkflowFile = path.includes('.github/workflows')
        if (isWorkflowFile) {
          // 404 on workflow files usually means missing workflow permissions
          const permissionError = (
            'Cannot create GitHub Actions workflow file. Your token lacks the required permissions. ' +
            'Please update your GitHub token with: ' +
            '(1) For Classic PAT: Add "workflow" scope. ' +
            '(2) For Fine-grained PAT: Grant "Workflows" read+write permission. ' +
            'Then update the token in Settings and try again.'
          )
          throw new Error(permissionError)
        }
        
        if (attempt < 3) {
          console.log(`[upsertFile] 404 on attempt ${attempt}, retrying after delay...`)
          await new Promise(resolve => setTimeout(resolve, 2000))
          continue
        }
      }

      break
    }

    throw new Error(lastError || 'Failed to commit workflow file')
  },

  /**
   * Create a pull request
   */
  async createPullRequest(token: string, params: CreatePRParams): Promise<GitHubPullRequest> {
    const { owner, repo, title, body, head, base } = params
    const client = createGitHubClient(token)
    const response = await client.post<GitHubPullRequest>(`/repos/${owner}/${repo}/pulls`, {
      title,
      body,
      head,
      base,
    })
    return response.data
  },

  /**
   * Fork a repository
   */
  async forkRepo(
    token: string,
    owner: string,
    repo: string
  ): Promise<GitHubRepo> {
    const client = createGitHubClient(token)
    const response = await client.post<GitHubRepo>(`/repos/${owner}/${repo}/forks`)
    return response.data
  },

  /**
   * Check if user has push access to repo
   */
  async checkPushAccess(token: string, owner: string, repo: string): Promise<boolean> {
    try {
      const repoData = await this.getRepo(token, owner, repo)
      return repoData.permissions?.push || false
    } catch {
      return false
    }
  },

  /**
   * Decode base64 file content
   */
  decodeContent(content: string): string {
    return atob(content.replace(/\n/g, ''))
  },

  /**
   * Encode content to base64
   */
  encodeContent(content: string): string {
    return btoa(unescape(encodeURIComponent(content)))
  },
}

// Extend GitHubRepo type with permissions
declare module '../types/github' {
  interface GitHubRepo {
    permissions?: {
      admin: boolean
      push: boolean
      pull: boolean
    }
  }
}

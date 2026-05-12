export interface GitHubRepo {
  id: number
  name: string
  full_name: string
  owner: {
    login: string
    avatar_url: string
  }
  html_url: string
  description: string | null
  default_branch: string
  private: boolean
  fork: boolean
  stargazers_count: number
  updated_at: string
}

export interface GitHubUser {
  login: string
  id: number
  avatar_url: string
  name: string | null
  email: string | null
}

export interface GitHubContent {
  name: string
  path: string
  sha: string
  size: number
  url: string
  html_url: string
  git_url: string
  download_url: string | null
  type: 'file' | 'dir'
  content?: string
  encoding?: string
}

export interface GitHubBranch {
  name: string
  commit: {
    sha: string
    url: string
  }
  protected: boolean
}

export interface GitHubPullRequest {
  id: number
  number: number
  state: 'open' | 'closed' | 'merged'
  title: string
  body: string | null
  html_url: string
  head: {
    ref: string
    sha: string
  }
  base: {
    ref: string
    sha: string
  }
  user: {
    login: string
    avatar_url: string
  }
  created_at: string
}

export interface CreatePRParams {
  owner: string
  repo: string
  title: string
  body: string
  head: string
  base: string
}

export interface CreateBranchParams {
  owner: string
  repo: string
  branchName: string
  baseSha: string
}

export interface CommitFileParams {
  owner: string
  repo: string
  path: string
  message: string
  content: string // base64 encoded
  branch: string
  sha?: string // required for updates
}

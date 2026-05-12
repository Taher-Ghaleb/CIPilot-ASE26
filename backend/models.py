from pydantic import BaseModel
from typing import List, Optional, Dict, Any

class Repository(BaseModel):
    owner: str
    name: str
    branch: str = "main"


class LLMSettings(BaseModel):
    provider: str = "ollama"  # ollama | openai | xai | groq
    model: str = "gemma3:12b"
    baseUrl: Optional[str] = None
    apiKey: Optional[str] = None


class ValidationResult(BaseModel):
    yamlOk: bool
    yamlError: Optional[str] = None
    actionlintOk: bool
    actionlintOutput: Optional[str] = None
    # Agentic Double Check - semantic verification by LLM
    doubleCheckOk: Optional[bool] = None
    doubleCheckReasons: Optional[List[str]] = None
    doubleCheckSkipped: Optional[bool] = None  # True if YAML/lint failed


class ConversionRequest(BaseModel):
    repository: Repository
    detectedServices: List[str]
    existingConfigs: Optional[Dict[str, Any]] = {}
    targetPlatform: Optional[str] = None  # github-actions | travis-ci
    llmSettings: Optional[LLMSettings] = None


class ValidateGithubActionsRequest(BaseModel):
    yaml: str
    originalConfig: Optional[str] = None  # For Double Check semantic verification
    llmSettings: Optional[LLMSettings] = None


class RetryConversionRequest(BaseModel):
    originalTravisConfig: str
    previousGitHubActionsAttempt: str
    targetPlatform: str
    feedback: str
    llmSettings: Optional[LLMSettings] = None
    currentAttempts: Optional[int] = 1
    
class ConversionResponse(BaseModel):
    status: str
    message: str
    convertedConfig: str
    originalServices: List[str]
    targetPlatform: str
    providerUsed: Optional[str] = None
    modelUsed: Optional[str] = None
    attempts: int = 1
    validation: Optional[ValidationResult] = None


class DetectionRequest(BaseModel):
    """Request to detect CI platform from YAML content"""
    yaml_content: str
    file_path: Optional[str] = None  # Optional file path for context
    repo_owner: Optional[str] = None
    repo_name: Optional[str] = None
    repo_branch: Optional[str] = None
    detected_services: Optional[List[str]] = None  # Pre-detected service names from frontend


class DetectionResponse(BaseModel):
    """Response with detected CI platform(s)"""
    detected_platforms: List[str]
    confidence: Optional[float] = None
    file_path: Optional[str] = None


# ============================================================================
# GitHub Proxy Models - for server-side GitHub operations (fork, PR creation)
# ============================================================================

class GitHubForkRequest(BaseModel):
    """Request to fork a repository using server-side PAT"""
    owner: str
    repo: str


class GitHubBranchRequest(BaseModel):
    """Request to create a branch"""
    owner: str
    repo: str
    branch_name: str
    base_sha: str


class GitHubCommitFileRequest(BaseModel):
    """Request to commit a file to a repository"""
    owner: str
    repo: str
    path: str
    content: str  # UTF-8 content (not base64)
    branch: str
    message: str


class GitHubCreatePRRequest(BaseModel):
    """Request to create a pull request"""
    owner: str  # Target repo owner (original repo for fork PRs)
    repo: str
    title: str
    body: str
    head: str  # Branch name or fork:branch
    base: str  # Base branch name


class GitHubCheckAccessRequest(BaseModel):
    """Request to check push access to a repository"""
    owner: str
    repo: str


class GitHubProxyResponse(BaseModel):
    """Generic response from GitHub proxy"""
    success: bool
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
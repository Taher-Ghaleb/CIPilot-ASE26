"""
Reviewer Access Utilities
Handles token generation, encryption, and validation for reviewer access
"""

import os
import json
import hashlib
import base64
from datetime import datetime, timedelta, timezone
from typing import Optional
from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv

# Load .env file if present
load_dotenv()

# Get secret from environment or generate a default for development
REVIEWER_SECRET = os.getenv("REVIEWER_ACCESS_SECRET", "")

def _get_fernet() -> Optional[Fernet]:
    """Get Fernet instance for encryption/decryption"""
    if not REVIEWER_SECRET:
        return None
    
    # Ensure the secret is 32 bytes (URL-safe base64 encoded)
    # If not in correct format, hash it to get consistent 32 bytes
    try:
        # Try to use directly if it's already a valid Fernet key
        return Fernet(REVIEWER_SECRET.encode())
    except Exception:
        # Hash the secret to get a valid key
        key = hashlib.sha256(REVIEWER_SECRET.encode()).digest()
        key_b64 = base64.urlsafe_b64encode(key)
        return Fernet(key_b64)


def generate_reviewer_token(
    reviewer_id: str,
    reviewer_name: str,
    days_valid: int = 30
) -> Optional[str]:
    """
    Generate an encrypted reviewer access token
    
    Args:
        reviewer_id: Unique identifier for the reviewer
        reviewer_name: Display name for the reviewer
        days_valid: Number of days the token is valid
        
    Returns:
        URL-safe encrypted token string, or None if encryption not configured
    """
    fernet = _get_fernet()
    if not fernet:
        return None
    
    expires_at = datetime.now(timezone.utc) + timedelta(days=days_valid)
    
    payload = {
        "reviewer_id": reviewer_id,
        "name": reviewer_name,
        "expires": expires_at.isoformat(),
        "created": datetime.now(timezone.utc).isoformat()
    }
    
    payload_json = json.dumps(payload)
    encrypted = fernet.encrypt(payload_json.encode())
    
    # Return URL-safe string
    return encrypted.decode()


def decrypt_reviewer_token(token: str) -> Optional[dict]:
    """
    Decrypt and validate a reviewer access token
    
    Args:
        token: Encrypted token string
        
    Returns:
        Decrypted payload dict with reviewer_id, name, expires
        Returns None if invalid or expired
    """
    fernet = _get_fernet()
    if not fernet:
        return None
    
    try:
        decrypted = fernet.decrypt(token.encode())
        payload = json.loads(decrypted.decode())
        
        # Check expiration
        expires = datetime.fromisoformat(payload["expires"])
        # Make sure both datetimes are timezone-aware for comparison
        now = datetime.now(timezone.utc)
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if now > expires:
            return None
        
        return payload
    except (InvalidToken, json.JSONDecodeError, KeyError, ValueError):
        return None


def hash_token(token: str) -> str:
    """Create a hash of the token for storage (don't store plaintext)"""
    return hashlib.sha256(token.encode()).hexdigest()


def get_reviewer_provider_config() -> Optional[dict]:
    """
    Get the pre-configured provider for reviewers from environment
    
    Returns:
        Dict with provider, api_key, model or None if not configured
    """
    provider = os.getenv("REVIEWER_DEFAULT_PROVIDER", "")
    api_key = os.getenv("REVIEWER_DEFAULT_API_KEY", "")
    model = os.getenv("REVIEWER_DEFAULT_MODEL", "")
    
    if not provider or not api_key:
        return None
    
    return {
        "provider": provider,
        "api_key": api_key,
        "model": model
    }


def is_reviewer_access_enabled() -> bool:
    """Check if reviewer access is properly configured"""
    return bool(REVIEWER_SECRET and get_reviewer_provider_config())


# CLI tool for generating tokens
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 3:
        print("Usage: python reviewer_utils.py <reviewer_id> <reviewer_name> [days_valid]")
        print("Example: python reviewer_utils.py reviewer_001 'FSE Reviewer 1' 30")
        sys.exit(1)
    
    reviewer_id = sys.argv[1]
    reviewer_name = sys.argv[2]
    days_valid = int(sys.argv[3]) if len(sys.argv) > 3 else 30
    
    if not REVIEWER_SECRET:
        print("ERROR: REVIEWER_ACCESS_SECRET environment variable not set")
        sys.exit(1)
    
    token = generate_reviewer_token(reviewer_id, reviewer_name, days_valid)
    if token:
        print(f"\n✅ Generated reviewer access token for: {reviewer_name}")
        print(f"   Reviewer ID: {reviewer_id}")
        print(f"   Valid for: {days_valid} days")
        print(f"\n🔗 Access URL:")
        print(f"   https://cipilot.onrender.com/review/{token}")
        print(f"\n   (For local testing: http://localhost:3000/review/{token})")
    else:
        print("ERROR: Failed to generate token")
        sys.exit(1)

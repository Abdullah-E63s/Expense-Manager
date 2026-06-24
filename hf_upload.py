"""
Upload the Expense Manager app to HuggingFace Spaces using the HF Hub Python API.
This bypasses git (which is rejected for binary files) and uses Xet-compatible upload.

Usage:
    python hf_upload.py --token YOUR_HF_TOKEN
    
    Or set HF_TOKEN env var and run: python hf_upload.py
"""
import os
import sys
import argparse
from pathlib import Path

# --- Configuration ---
REPO_ID = "ghost993/expensemanager"
REPO_TYPE = "space"
LOCAL_APP_DIR = Path(__file__).parent  # The expense manager app folder

# Files/dirs to EXCLUDE from upload (sensitive, dev-only, or build artifacts)
EXCLUDE_PATTERNS = {
    ".env",
    ".git",
    ".gitattributes",  # HF manages this internally
    ".venv",
    "venv",
    "__pycache__",
    "logs",
    "*.pyc",
    "*.log",
    "firebase-credentials.json",   # NEVER upload this - use FIREBASE_CREDENTIALS_BASE64 env
    ".vscode",
    "node_modules",
    "testing",
    "firebase_b64.txt",
    "hf_upload.py",               # Don't upload this script itself
}

def should_skip(path: Path) -> bool:
    """Return True if this path should be excluded from upload."""
    name = path.name
    # Skip hidden dirs/files except those we specifically want
    if name.startswith('.') and name not in {'.dockerignore', '.gitignore', '.gitattributes'}:
        return True
    # Check exact name exclusions
    if name in EXCLUDE_PATTERNS:
        return True
    # Check extension patterns
    for pat in EXCLUDE_PATTERNS:
        if pat.startswith('*') and name.endswith(pat[1:]):
            return True
    return False


def collect_files(root: Path):
    """Recursively collect (local_path, path_in_repo) tuples."""
    items = []
    for item in root.rglob("*"):
        if item.is_file():
            # Check if any part of the path should be excluded
            parts = item.relative_to(root).parts
            skip = False
            for part in parts:
                if part in EXCLUDE_PATTERNS or (part.startswith('.') and part not in {'.dockerignore', '.gitignore'}):
                    skip = True
                    break
            if skip:
                continue
            rel = item.relative_to(root).as_posix()
            items.append((item, rel))
    return items


def main():
    parser = argparse.ArgumentParser(description="Upload app to HuggingFace Spaces")
    parser.add_argument("--token", default=os.environ.get("HF_TOKEN", ""), help="HuggingFace API token")
    parser.add_argument("--dry-run", action="store_true", help="Just list files without uploading")
    args = parser.parse_args()

    from huggingface_hub import HfApi, get_token
    token = args.token or os.environ.get("HF_TOKEN") or get_token()
    
    if not token and not args.dry_run:
        print("ERROR: Provide --token, set HF_TOKEN env var, or run `hf auth login`")
        print("Get your token from: https://huggingface.co/settings/tokens")
        sys.exit(1)

    api = HfApi(token=token)

    print(f"\n📦 Collecting files from: {LOCAL_APP_DIR}")
    files = collect_files(LOCAL_APP_DIR)
    print(f"   Found {len(files)} files to upload\n")

    if args.dry_run:
        for local, repo_path in files:
            size_kb = local.stat().st_size / 1024
            print(f"  {'[LARGE]' if size_kb > 1000 else '       '} {repo_path} ({size_kb:.1f} KB)")
        print(f"\nDry run complete. {len(files)} files would be uploaded.")
        return

    print(f"🚀 Uploading to {REPO_ID} (type={REPO_TYPE})...")
    print("   This may take several minutes for large files (YOLOv9 weights ~390MB).\n")

    # Upload in batches using upload_folder for efficiency
    try:
        api.upload_folder(
            folder_path=str(LOCAL_APP_DIR),
            repo_id=REPO_ID,
            repo_type=REPO_TYPE,
            ignore_patterns=[
                ".env",
                ".env.*",
                "!.env.production.example",
                ".git/**",
                ".venv/**",
                "venv/**",
                "__pycache__/**",
                "*.pyc",
                "logs/**",
                "firebase-credentials.json",
                ".vscode/**",
                "testing/**",
                "firebase_b64.txt",
                "hf_upload.py",
                "*.bat",
                "*.ps1",
                "run.bat",
                "start.bat",
                "start.ps1",
            ],
            commit_message="deploy: upload via huggingface_hub API (Xet-compatible)",
        )
        print("\n✅ Upload complete!")
        print(f"   View your Space: https://huggingface.co/spaces/{REPO_ID}")
    except Exception as e:
        print(f"\n❌ Upload failed: {e}")
        raise


if __name__ == "__main__":
    main()

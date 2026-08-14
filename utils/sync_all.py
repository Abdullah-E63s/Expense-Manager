#!/usr/bin/env python3
"""
Multi-Cloud Synchronizer for Expense Manager
Pushes updates to GitHub (Vercel), Hugging Face, and EAS.
"""

import sys
import subprocess
import datetime

def run_cmd(cmd, cwd=None):
    print(f"Running: {cmd}")
    res = subprocess.run(cmd, shell=True, cwd=cwd, text=True, capture_output=True)
    if res.stdout:
        print(res.stdout.strip())
    if res.stderr:
        print(res.stderr.strip())
    return res.returncode

def sync_all(message=None, build_eas=False):
    if not message:
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        message = f"chore: auto-sync update ({timestamp})"

    print(f"\n🚀 Syncing all platforms: '{message}'\n")

    # 1. Git Commit
    run_cmd("git add .")
    run_cmd(f'git commit -m "{message}"')

    # 2. Push GitHub (Vercel)
    print("\n👉 Pushing to GitHub (Vercel)...")
    run_cmd("git push origin main")

    # 3. Push HuggingFace
    print("\n👉 Pushing to Hugging Face...")
    hf_code = run_cmd("git push hf main")
    if hf_code != 0:
        run_cmd("git pull hf main --rebase")
        run_cmd("git push hf main")

    # 4. EAS Build if requested
    if build_eas:
        print("\n👉 Triggering EAS Build...")
        run_cmd('npx eas-cli build --platform android --profile preview --non-interactive', cwd="./mobile app")

    print("\n✨ Sync completed!\n")

if __name__ == "__main__":
    msg = sys.argv[1] if len(sys.argv) > 1 else None
    build = "--build" in sys.argv or "-b" in sys.argv
    sync_all(message=msg, build_eas=build)

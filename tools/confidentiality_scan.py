"""Confidentiality scan before a push: python -I tools/confidentiality_scan.py [ROOT]
Fails (exit 1) on private absolute paths, user home folders, tokens and keys, e-mail addresses and transcript files.
Run it on every file git would push (tracked + untracked, not ignored)."""
import os
import re
import subprocess
import sys

PATTERNS = [
    ('user home path', re.compile(r'[A-Za-z]:[\\/]+Users[\\/]+(?!me\b|you\b|<)[A-Za-z0-9._-]+', re.I)),
    ('unix home path', re.compile(r'/(?:home|Users)/(?!me\b|you\b|<)[a-z0-9._-]+/', re.I)),
    ('private projects root', re.compile(r'\b[D-Z]:[\\/]+PROJ\b', re.I)),
    ('GitHub token', re.compile(r'\bgh[pousr]_[A-Za-z0-9]{20,}')),
    ('GitLab token', re.compile(r'\bglpat-[A-Za-z0-9_-]{16,}')),
    ('Anthropic key', re.compile(r'\bsk-ant-[A-Za-z0-9_-]{16,}')),
    ('OpenAI key', re.compile(r'\bsk-(?:proj-)?[A-Za-z0-9]{32,}')),
    ('AWS key', re.compile(r'\bAKIA[0-9A-Z]{16}\b')),
    ('private key', re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----')),
    ('e-mail address', re.compile(r'\b[A-Za-z0-9._%+-]+@(?!example\.|anthropic\.com)[A-Za-z0-9-]+\.[A-Za-z.]{2,}\b')),
]
SKIP = {os.path.join('tools', 'confidentiality_scan.py')}
# Vendored upstream tests use made-up homes for a one-letter user (/home/k/, /Users/k/, C:/Users/k). That user is
# allowed there and only there; every other pattern still applies to those files.
FIXTURE_USERS = {('vendor/', '/tests/'): {'k'}}
HOME_PATTERNS = {'user home path', 'unix home path'}


def fixture_users(rel):
    rel = rel.replace(os.sep, '/')
    return set().union(*[users for (top, sub), users in FIXTURE_USERS.items() if rel.startswith(top) and sub in rel])


def home_user(hit):
    return re.split(r'[\\/]+', hit.rstrip('/\\'))[-1].lower()


def files(root):
    out = subprocess.run(['git', '-C', root, 'ls-files', '-co', '--exclude-standard'], capture_output=True, text=True,
                         check=True).stdout
    return [f for f in out.splitlines() if f]


def main(root):
    bad = []
    for rel in files(root):
        if os.path.normpath(rel) in SKIP:
            continue
        if rel.endswith('.jsonl'):
            bad.append((rel, 0, 'transcript-like file (.jsonl)', ''))
            continue
        try:
            with open(os.path.join(root, rel), encoding='utf8', errors='replace') as f:
                lines = f.read().splitlines()
        except OSError:
            continue
        allowed = fixture_users(rel)
        for n, line in enumerate(lines, 1):
            for name, rx in PATTERNS:
                for m in rx.finditer(line):
                    if name in HOME_PATTERNS and home_user(m.group(0)) in allowed:
                        continue
                    bad.append((rel, n, name, m.group(0)[:12] + '…'))
                    break
    for rel, n, name, hit in bad:
        print(f'{rel}:{n}: {name} {hit}')
    print('confidentiality scan:', 'FAIL' if bad else 'PASS', f'({len(files(root))} files)')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else '.'))

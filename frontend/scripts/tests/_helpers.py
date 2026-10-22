"""Shared helpers for the data-script fixture tests (python3 stdlib + openpyxl only).

The scripts under frontend/scripts/ are command-line tools named with hyphens
(build-ema-data.py …), so they cannot be imported with a plain `import`. These
helpers load them by path, or run them as a subprocess the way the GitHub
Actions jobs do.
"""
import importlib.util
import os
import subprocess
import sys

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.dirname(TESTS_DIR)
FRONTEND_DIR = os.path.dirname(SCRIPTS_DIR)


def script_path(name):
    return os.path.join(SCRIPTS_DIR, name)


def load_script(name, module_name=None):
    """Import a hyphenated script file as a module (its `if __name__ == '__main__'` block does not run)."""
    path = script_path(name)
    spec = importlib.util.spec_from_file_location(module_name or name.replace('-', '_').replace('.py', ''), path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run_script(path, *args, env=None, cwd=None, check=True):
    """Run a script with the test's own interpreter; returns CompletedProcess (stdout/stderr as text)."""
    full_env = dict(os.environ)
    if env:
        full_env.update(env)
    return subprocess.run([sys.executable, path, *map(str, args)], capture_output=True, text=True,
                          env=full_env, cwd=cwd, check=check)

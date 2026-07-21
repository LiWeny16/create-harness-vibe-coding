# Python Backend Workflow

## Required Evidence

- Python executable, version, and dependency manager detected.
- Unit/integration test command and result.
- API smoke evidence for changed endpoints when applicable.
- Migration, fixture, or environment assumptions.

## Common Commands

```powershell
python --version
py --version
python3 --version
python -m unittest discover -s tests
py -m unittest discover -s tests
python3 -m unittest discover -s tests
python -m pytest
python -m pytest tests
uv run pytest
poetry run pytest
python -m uvicorn app.main:app --reload
```

Prefer commands already documented by the project. When no project-specific command is documented, detect an available Python executable in the current shell (`python`, then `py`, then `python3`) and run the matching `-m unittest discover -s tests` or pytest command. `unittest` is first-class for standard-library test suites; do not require pytest when the project already uses unittest.

## Fallback

If unittest, pytest, or the app runner is unavailable, run targeted Python modules, import checks, or framework-specific tests that already exist. Do not create or install a new backend stack without approval.

## Windows Notes

Virtual environment activation is usually `.\\.venv\\Scripts\\Activate.ps1`. If script execution is blocked, use the environment's Python executable directly, for example `.\\.venv\\Scripts\\python.exe -m unittest discover -s tests` or `.\\.venv\\Scripts\\python.exe -m pytest`.

#!/usr/bin/env python
"""실행 진입점 (개발용 `.venv\\Scripts\\python run.py` / PyInstaller 빌드 대상)."""

import multiprocessing

if __name__ == "__main__":
    multiprocessing.freeze_support()
    from tadaksync3.app import main
    main()

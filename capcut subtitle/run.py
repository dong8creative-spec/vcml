"""타닥싱크(TadakSync) 실행 진입점 (PyInstaller 빌드 대상)."""

import multiprocessing

if __name__ == "__main__":
    multiprocessing.freeze_support()
    from capcut_subtitle.gui import main
    main()

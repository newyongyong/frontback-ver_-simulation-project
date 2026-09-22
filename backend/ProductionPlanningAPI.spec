# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['desktop_api.py'],
    pathex=[],
    binaries=[],
    datas=[('app', 'app'), ('data', 'data')],
    # Uvicorn이 "app.main:app"을 문자열로 동적 로딩하므로 PyInstaller가
    # 자동 추적하지 못하는 FastAPI 앱과 그 의존성을 명시적으로 포함한다.
    hiddenimports=['app.main'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='ProductionPlanningAPI',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

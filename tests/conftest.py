import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
COMFY_ROOT = (PROJECT_ROOT / ".." / "ComfyUI").resolve()

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

if COMFY_ROOT.exists() and str(COMFY_ROOT) not in sys.path:
    sys.path.insert(0, str(COMFY_ROOT))

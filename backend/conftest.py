import os
import sys

# Make sure `app` (backend/app) is importable when pytest is run from
# anywhere, without needing the project installed as a package.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

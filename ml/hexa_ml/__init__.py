"""H.E.X.A. v4 Python ML sidecar.

Trains XGBoost models on resolved picks from the main Node API's Postgres
and exposes inference via FastAPI. Communicates with the Node API only
through HTTP — the Oracle remains untouched.
"""

__version__ = "0.1.0"

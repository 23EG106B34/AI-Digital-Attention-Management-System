# FocusGuard AI integrated project

Run `py -m venv .venv`, activate it, then run `pip install -r requirements.txt`, `py manage.py migrate`, and `py manage.py runserver`.

Copy `.env.example` to `.env`, set a strong `SECRET_KEY`, and set `AGENT_USERNAME` / `AGENT_PASSWORD` to a registered account before starting `py desktop_agent.py`.

Load `chrome_extension` from Chrome's Extensions page with Developer mode enabled. Store `jwtAccessToken` and optionally `apiBaseUrl` in its extension storage after logging in; its completed sessions then sync to `/api/browsing/log/` under that token. The extension keeps locally collected sessions when offline.

The backend uses SQLite (`db.sqlite3`) by default. Data belongs to the authenticated Django user; tracker and extension requests use JWT bearer authentication.

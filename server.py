from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import json
import os
import time

HOST = "0.0.0.0"
PORT = 2021

ROOT = Path(__file__).resolve().parent


class Handler(SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, data, status=200):
        body = json.dumps(
            data,
            ensure_ascii=False,
            indent=2
        ).encode("utf-8")

        self.send_response(status)

        self.send_header(
            "Content-Type",
            "application/json; charset=utf-8"
        )

        self.send_header(
            "Content-Length",
            str(len(body))
        )

        self.send_header(
            "Cache-Control",
            "no-store"
        )

        self.end_headers()

        self.wfile.write(body)

    def get_projects(self):
        projects = []

        for item in ROOT.iterdir():

            # Hanya folder
            if not item.is_dir():
                continue

            # Abaikan hidden folder
            if item.name.startswith("."):
                continue

            # Harus memiliki index.html
            index_file = item / "index.html"

            if not index_file.is_file():
                continue

            try:
                modified = index_file.stat().st_mtime

                projects.append({
                    "name": item.name,
                    "title": format_name(item.name),
                    "path": f"/{item.name}/",
                    "url": f"/{item.name}/",
                    "index": f"/{item.name}/index.html",
                    "updatedAt": time.strftime(
                        "%Y-%m-%dT%H:%M:%S",
                        time.localtime(modified)
                    )
                })

            except OSError:
                continue

        # Urutkan berdasarkan nama
        projects.sort(
            key=lambda project:
            project["name"].lower()
        )

        # Tambahkan nomor
        for index, project in enumerate(projects, 1):
            project["number"] = index

        return projects

    def do_GET(self):

        parsed = urlparse(self.path)

        # =========================
        # API PROJECTS
        # =========================

        if parsed.path == "/api/projects":

            projects = self.get_projects()

            self.send_json({
                "success": True,
                "count": len(projects),
                "projects": projects
            })

            return

        # =========================
        # API HEALTH
        # =========================

        if parsed.path == "/api/health":

            self.send_json({
                "success": True,
                "server": "Tama Project Hub",
                "status": "online",
                "time": time.strftime(
                    "%Y-%m-%dT%H:%M:%S"
                )
            })

            return

        # =========================
        # DEFAULT STATIC SERVER
        # =========================

        return super().do_GET()

    def log_message(self, format, *args):
        print(
            f"[{time.strftime('%H:%M:%S')}] "
            f"{self.address_string()} - "
            f"{format % args}"
        )


def format_name(name):
    return (
        name
        .replace("-", " ")
        .replace("_", " ")
        .replace(".", " ")
        .strip()
        .title()
    )


def main():

    server = ThreadingHTTPServer(
        (HOST, PORT),
        Handler
    )

    print()
    print("=" * 45)
    print("       TAMA PROJECT HUB")
    print("=" * 45)
    print()
    print(f"Server : http://localhost:{PORT}")
    print(f"API    : http://localhost:{PORT}/api/projects")
    print(f"Health : http://localhost:{PORT}/api/health")
    print()
    print("Tekan CTRL+C untuk menghentikan server.")
    print()

    try:
        server.serve_forever()

    except KeyboardInterrupt:
        print("\nServer dihentikan.")

    finally:
        server.server_close()


if __name__ == "__main__":
    main()

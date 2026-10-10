"""Emula un teléfono con IP Webcam: sirve un video en bucle como MJPEG.

Sirve http://127.0.0.1:PUERTO/video para probar un nodo edge sin el teléfono.
Uso (con el venv del nodo de visión):
  apps/vision/.venv/bin/python infra/edges/fake-phone-camera.py VIDEO.mp4 --port 8081
"""
from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import time

import cv2


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("video")
    parser.add_argument("--port", type=int, default=8081)
    parser.add_argument("--fps", type=float, default=10.0)
    parser.add_argument("--width", type=int, default=960, help="Ancho de salida (reduce carga como un teléfono a 720p)")
    args = parser.parse_args()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - stdlib API
            if self.path != "/video":
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.end_headers()
            capture = cv2.VideoCapture(args.video)
            try:
                while True:
                    ok, frame = capture.read()
                    if not ok:  # Loop forever, like a live camera.
                        capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        continue
                    height = int(frame.shape[0] * args.width / frame.shape[1])
                    frame = cv2.resize(frame, (args.width, height))
                    encoded, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                    if encoded:
                        self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                                         + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg.tobytes() + b"\r\n")
                    time.sleep(1 / args.fps)
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                capture.release()

        def log_message(self, *args):
            pass

    print(f"Cámara simulada en http://127.0.0.1:{args.port}/video")
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()

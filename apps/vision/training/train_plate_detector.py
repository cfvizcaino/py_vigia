from __future__ import annotations

import argparse

from ultralytics import YOLO


def main() -> None:
    parser = argparse.ArgumentParser(description="Entrena un detector de placas para VIGIA.")
    parser.add_argument("--data", required=True, help="Ruta al data.yaml exportado en formato YOLO.")
    parser.add_argument("--model", default="yolo26n.pt", help="Peso base de Ultralytics.")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=960, help="Resolución alta para placas pequeñas.")
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()

    model = YOLO(args.model)
    model.train(
        data=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        project="runs/vigia-plates",
        name="yolo26n-plates",
    )


if __name__ == "__main__":
    main()

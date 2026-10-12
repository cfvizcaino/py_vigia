"""Entrena el clasificador de color de vehículos de VIGIA (YOLO26n-cls).

  .venv/bin/python training/train_color_classifier.py --data datasets/colors/vigia-colors-v1
"""
from __future__ import annotations

import argparse

from ultralytics import YOLO


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", required=True, help="Carpeta con train/val/test/<color> de build_color_dataset.py")
    parser.add_argument("--model", default="yolo26n-cls.pt", help="Peso base de Ultralytics.")
    parser.add_argument("--epochs", type=int, default=30)
    # Validation (~500 images) swings a few points per epoch; stopping early kept
    # mid-schedule weights. The full schedule lets the learning rate decay.
    parser.add_argument("--patience", type=int, default=0, help="0 = sin parada temprana")
    parser.add_argument("--imgsz", type=int, default=128, help="El color no necesita detalle; 128 es rápido en teléfonos.")
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--name", default="yolo26n-colors")
    args = parser.parse_args()

    model = YOLO(args.model)
    model.train(
        data=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        workers=args.workers,
        device=args.device,
        project="runs/vigia-colors",
        name=args.name,
        patience=args.patience,
        # The label *is* the hue: no hue shift, no RandAugment colour ops (posterize,
        # solarize, equalize...), little saturation change. Brightness and contrast still
        # vary, which is what changes across cameras, hours and weather.
        auto_augment=None,
        hsv_h=0.0,
        hsv_s=0.15,
        hsv_v=0.4,
        scale=0.4,
        fliplr=0.5,
        erasing=0.2,
    )


if __name__ == "__main__":
    main()

#!/bin/bash
# Headless DeepStream 8.0 throughput on the local GPU.
# Decode + TrafficCamNet (ResNet18, TensorRT FP16) + NvDCF. No display, no secondary classifiers.
set -u
cd /opt/nvidia/deepstream/deepstream/samples/configs/deepstream-app
OUT=${OUT:-/out}
mkdir -p "$OUT"
for n in 1 4 8 16; do
  cat > "bench_${n}.txt" << EOF
[application]
enable-perf-measurement=1
perf-measurement-interval-sec=5

[tiled-display]
enable=0
rows=1
columns=1
width=1280
height=720
gpu-id=0

[source0]
enable=1
type=3
uri=file://../../streams/sample_1080p_h264.mp4
num-sources=${n}
file-loop=1
gpu-id=0
cudadec-memtype=0

[sink0]
enable=1
type=1
sync=0
source-id=0
gpu-id=0

[osd]
enable=0
gpu-id=0

[streammux]
gpu-id=0
live-source=0
batch-size=${n}
batched-push-timeout=40000
width=1920
height=1080

[primary-gie]
enable=1
gpu-id=0
batch-size=${n}
interval=0
gie-unique-id=1
nvbuf-memory-type=0
config-file=bench_infer_${n}.txt

[tracker]
enable=1
tracker-width=960
tracker-height=544
ll-lib-file=/opt/nvidia/deepstream/deepstream/lib/libnvds_nvmultiobjecttracker.so
ll-config-file=config_tracker_NvDCF_perf.yml
gpu-id=0

[tests]
file-loop=1
EOF
  cat > "bench_infer_${n}.txt" << EOF
[property]
gpu-id=0
net-scale-factor=0.00392156862745098
onnx-file=../../models/Primary_Detector/resnet18_trafficcamnet_pruned.onnx
model-engine-file=../../models/Primary_Detector/bench_b${n}_fp16.engine
labelfile-path=../../models/Primary_Detector/labels.txt
batch-size=${n}
process-mode=1
model-color-format=0
network-mode=2
num-detected-classes=4
interval=0
gie-unique-id=1
cluster-mode=2

[class-attrs-all]
topk=20
nms-iou-threshold=0.5
pre-cluster-threshold=0.2
EOF
  echo "===== START n=${n} ====="
  timeout 300 deepstream-app -c "bench_${n}.txt" > "${OUT}/deepstream-n${n}.log" 2>&1 || true
  echo "===== END n=${n} exit=$? ====="
done
echo DONE

import os
import io
import base64
import threading
import logging
from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

model = None
model_loading = False
model_error = None

# YOLOWorld open-vocabulary model — downloads from GitHub CDN (no auth required)
# We set gun-specific class prompts so it detects firearms via text-based zero-shot detection
YOLOWORLD_MODEL = "yolov8s-worldv2.pt"
GUN_CLASSES = ["gun", "pistol", "rifle", "handgun", "firearm", "shotgun", "revolver"]
CONF_THRESHOLD = 0.25


def init_model():
    global model, model_loading, model_error
    model_loading = True
    try:
        from ultralytics import YOLOWorld
        logger.info(f"Downloading/loading YOLOWorld model: {YOLOWORLD_MODEL}")
        m = YOLOWorld(YOLOWORLD_MODEL)
        m.set_classes(GUN_CLASSES)
        model = m
        logger.info(f"YOLOWorld ready — detecting classes: {GUN_CLASSES}")
    except Exception as e:
        model_error = str(e)
        logger.error(f"Model init failed: {e}", exc_info=True)
    finally:
        model_loading = False


def run_inference(pil_image):
    """Run YOLOWorld inference and return list of detection dicts."""
    results = model.predict(pil_image, conf=CONF_THRESHOLD, verbose=False)
    detections = []
    for r in results:
        for box in r.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            conf = float(box.conf[0])
            cls_id = int(box.cls[0])
            label = GUN_CLASSES[cls_id] if cls_id < len(GUN_CLASSES) else "weapon"
            detections.append({
                "x1": float(x1),
                "y1": float(y1),
                "x2": float(x2),
                "y2": float(y2),
                "confidence": conf,
                "label": label,
            })
    return detections


@app.route("/ai/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "model_ready": model is not None,
        "model_loading": model_loading,
        "model_error": model_error,
        "model_name": YOLOWORLD_MODEL if model is not None else None,
        "classes": GUN_CLASSES if model is not None else [],
    })


@app.route("/ai/detect", methods=["POST"])
def detect():
    if model is None:
        return jsonify({
            "detections": [],
            "model_ready": False,
            "model_loading": model_loading,
            "model_error": model_error or "Model not yet loaded",
        }), 200

    data = request.json or {}
    img_str = data.get("image", "")
    if not img_str:
        return jsonify({"error": "No image provided"}), 400

    if "," in img_str:
        img_str = img_str.split(",", 1)[1]

    try:
        raw = base64.b64decode(img_str)
        pil = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as e:
        return jsonify({"error": f"Image decode error: {e}"}), 400

    try:
        detections = run_inference(pil)
        return jsonify({"detections": detections, "model_ready": True})
    except Exception as e:
        logger.error(f"Inference error: {e}", exc_info=True)
        return jsonify({"error": str(e), "detections": []}), 500


if __name__ == "__main__":
    t = threading.Thread(target=init_model, daemon=True)
    t.start()
    port = int(os.environ.get("PORT", 8000))
    logger.info(f"Starting AI server on port {port}")
    app.run(host="0.0.0.0", port=port, debug=False)

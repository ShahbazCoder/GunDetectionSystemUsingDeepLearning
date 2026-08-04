---
name: ultralytics on Replit
description: How to get ultralytics/YOLOWorld working in the Replit Python environment for vision inference
---

## Rules

Install `mesa` as a system dependency before ultralytics or it fails with `libGL.so.1: cannot open shared object file`.

Use `python3 -m pip install ultralytics` from bash — the `installLanguagePackages` sandbox call may report failure even when it succeeds, and pip3 is not on PATH.

**Why:** ultralytics imports OpenCV which dynamically links libGL. Replit's NixOS base does not include this by default.

**How to apply:** When adding any ultralytics-based workflow, call `installSystemDependencies({ packages: ["mesa"] })` first, then install ultralytics via bash `python3 -m pip install ultralytics`.

## Gun-specific model access

HF gun detection models (`keremberke/yolov8m-gun-detection`, `nicehash/yolov8n-gun-detection`) return 401 for direct HTTP downloads — they require HF auth even though listed as "public".

**Solution:** Use `YOLOWorld("yolov8s-worldv2.pt")` — downloaded from GitHub CDN (no auth), then call `model.set_classes(["gun", "pistol", "rifle", "handgun", "firearm", "shotgun", "revolver"])` for zero-shot gun detection.

GitHub ultralytics CDN base: `https://github.com/ultralytics/assets/releases/download/v8.4.0/`

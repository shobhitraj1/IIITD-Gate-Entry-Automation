# IIITD-Gate-Entry-Automation

This repository presents a computer vision system developed to automate student gate entry at IIIT Delhi after 10 PM, designed to handle low-light conditions and real-world surveillance settings. The project integrates face detection, recognition, and temporal tracking from CCTV footage to log student entries seamlessly into an online database.
The project was developed for the [Computer Vision](https://techtree.iiitd.edu.in/viewDescription/filename?=CSE344) course at IIIT Delhi in Winter 2025.

**<h4>🛠️ Features:</h4>**
- **Low-Light Face Detection:** DAI detector for robust face bounding box localization under challenging illumination.
- **Face Recognition Backbone:** MTCNN for alignment + AdaFace (quality-adaptive margin) for identity prediction.
- **Temporal Consistency via Tracking:** ByteTrack to link detections across frames, with majority-vote merging to reduce ID fragmentation & for tracking multiple individuals in video streams.
- **Pipeline Optimizations:**
  -   Frame skipping + interpolation for faster inference.
  -   TorchVision’s optimized NMS for efficiency.
  -   Quantized detector (FP16) for reduced GPU memory usage.
- **Frontend Dashboard:** React + TypeScript web interface with:
  -   Dashboard Panel: Shows entry/exit logs (name, roll no., photo, timestamp).
  -   Live Surveillance Panel: Displays real-time CCTV feeds.
- **FastAPI Backend:** REST API and WebSocket support for live frame streaming and event logging.
- **Accuracy:** Achieved 87.5% recognition accuracy under low-light conditions with near real-time inference.

**<h4>📋 Installation & Usage:</h4>**
- Clone the repository and install the following Python libraries:
```bash
pip install fastapi uvicorn opencv-python torch torchvision numpy Pillow sqlite3 scipy python-multipart python-dotenv requests matplotlib scikit-learn
```
- Download the pretrained weights listed below and place them in `weights` folder:
  - adaface_ir101_ms1mv3.ckpt
  - adaface_ir101_webface12m.ckpt
  - DarkFaceFS.pth
  - DarkFaceZSDA.pth
- Run the backend:
```bash
python app.py
```
- Start the frontend:
```bash
cd frontend
npm install
npm start
```
- Process videos:
  - Place your video files in the root directory & edit the `vid_name` variable in `main.py`
  - Run:
    ```bash
    python main.py
    ```
  - Output videos will be saved with `_complete.mp4`, `_lessdet.mp4`, or `_merge.mp4` suffixes.
  




import cv2
import dai
import numpy as np
from PIL import Image
from collections import defaultdict
import adaface
from bytetrack.byte_tracker import BYTETracker
import time
import os
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
import sqlite3
from datetime import datetime
import pytz

os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

app = FastAPI()

# Add CORS middleware with expanded origins for mobile access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for mobile access
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
skip_frames = 1  # Take 1 in every 2 frames
detection_interval = 6  # Only run detection every N processed frames
votes_thresh = 5

# Database connection
db_path = "face_recognition.db"
conn = sqlite3.connect(db_path)
# Create a cursor object
cursor = conn.cursor()
# Create a table for storing face recognition data
cursor.execute('''
    CREATE TABLE IF NOT EXISTS face_recognition (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
''')
# Commit the changes and close the connection
conn.commit()

class byte_track_args:
    def __init__(self, track_thresh=0.45, track_buffer=50, match_thresh=0.8):
        self.track_thresh = track_thresh
        self.track_buffer = track_buffer
        self.match_thresh = match_thresh
        self.mot20 = False

byteArgs = byte_track_args()
fps = 30
tracker = BYTETracker(args=byteArgs, frame_rate=fps)
tracked_objects = []
preds = []
first_frame = []
last_frame = []
seens = []
dones = []
recognition_cache = {}  # Cache for face recognition
frame_counter = 0
processed_frame_idx = 0  # Index of processed frame after skipping
last_detections = []
last_detection_frame = None

def final_exit():
    exits = []
    for i in range(len(preds)):
        if not dones[i]:
            if len(preds[i]) > 0:
                majority_vote = max(preds[i], key=preds[i].get)
                votes = preds[i][majority_vote]
                if votes >= votes_thresh:
                    print(f"{majority_vote} Exited the campus")
                    exits.append(majority_vote)
                    
    recent_exits = cursor.execute('''
        SELECT name FROM face_recognition
        WHERE timestamp >= datetime('now', '-1 minute')
    ''').fetchall()
    recent_exits = set([exit[0] for exit in recent_exits])
    new_exits = set(exits)
    for exit in new_exits:
        if exit not in recent_exits:
            cursor.execute('''
                INSERT INTO face_recognition (name) VALUES (?)
            ''', (exit,))
            conn.commit()
            print(f"New exit recorded: {exit}")

    return exits

def check_exit_condition(processed_frame):
    exits = []
    for i in range(len(preds)):
        if not dones[i] and i < len(last_frame) and last_frame[i] < len(tracked_objects):
            print("checking exit condition")
            print(byteArgs.track_buffer * skip_frames)
            print(tracked_objects[last_frame[i]][0])
            print(frame_counter)
            if frame_counter - tracked_objects[last_frame[i]][0] > byteArgs.track_buffer * skip_frames:
                dones[i] = True
                
            if i < len(first_frame) and first_frame[i] < len(tracked_objects):
                speed = tracked_objects[last_frame[i]][3] - tracked_objects[first_frame[i]][3]
                time_diff = tracked_objects[last_frame[i]][0] - tracked_objects[first_frame[i]][0]
                if time_diff > 0:
                    frames_ahead = frame_counter - tracked_objects[last_frame[i]][0]
                    new_loc = tracked_objects[last_frame[i]][3] + speed * (frames_ahead / time_diff)
                    if new_loc + tracked_objects[last_frame[i]][5] > processed_frame.shape[1]:
                        dones[i] = True
                    
            if dones[i] and len(preds[i]) > 0:
                print("checking exit condition for person", i)
                print(preds[i])
                majority_vote = max(preds[i], key=preds[i].get)
                votes = preds[i][majority_vote]
                if votes >= votes_thresh:
                    print(f"{majority_vote} Exited the campus")
                    exits.append(majority_vote)

    ret_exits = []
    recent_exits = cursor.execute('''
        SELECT name FROM face_recognition
        WHERE timestamp >= datetime('now', '-1 minute')
    ''').fetchall()
    recent_exits = set([exit[0] for exit in recent_exits])
    new_exits = set(exits)
    print("recent exits", recent_exits)
    for exit in new_exits:
        if exit not in recent_exits:
            ret_exits.append(exit)
            cursor.execute('''
                INSERT INTO face_recognition (name) VALUES (?)
            ''', (exit,))
            conn.commit()
            print(f"New exit recorded: {exit}")

    return ret_exits

def process_frame(frame):
    global tracker, tracked_objects, preds, first_frame, last_frame, seens, dones
    global recognition_cache, frame_counter, processed_frame_idx, last_detections, last_detection_frame
    exits = []
    frame_counter += 1
    # Skip frames according to skip_frames parameter
    if frame_counter % skip_frames != 0:
        return None, None

    processed_frame_idx += 1
    processed_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    run_detection = (processed_frame_idx % detection_interval == 0 or not last_detections)

    if run_detection:
        detections = dai.face_from_frame(processed_frame)
        if len(detections) > 0:
            last_detections = detections.copy()
            last_detection_frame = processed_frame_idx
    else:
        detections = []
        if last_detections and (processed_frame_idx - last_detection_frame) <= detection_interval*2:
            motion_factor = min(1.0, (processed_frame_idx - last_detection_frame) / detection_interval)
            
            for det in last_detections:
                x1, y1, x2, y2, conf = det
                width = x2 - x1
                height = y2 - y1
                expansion = motion_factor * 0.05
                
                new_det = [
                    max(0, x1 - width * expansion),
                    max(0, y1 - height * expansion),
                    min(processed_frame.shape[1], x2 + width * expansion),
                    min(processed_frame.shape[0], y2 + height * expansion),
                    conf * 0.98
                ]
                detections.append(new_det)

    if len(detections) == 0:
        online_tracks = []
    else:
        detection_array = np.array(detections)
        h, w = processed_frame.shape[:2]
        online_tracks = tracker.update(detection_array, (h, w), (h, w))

    people_bbox = {}

    for track in online_tracks:
        x1, y1, x2, y2 = track.tlbr
        track_id = track.track_id
        score = track.score
        x1, y1, x2, y2 = int(max(0, x1)), int(max(0, y1)), int(min(w, x2)), int(min(h, y2))
        
        if x2 <= x1 or y2 <= y1:
            continue

        cache_key = f"{track_id}_{processed_frame_idx // detection_interval}"
        if run_detection or cache_key not in recognition_cache:
            cropped_frame = processed_frame[y1:y2, x1:x2, :]
            
            if cropped_frame.shape[0] == 0 or cropped_frame.shape[1] == 0:
                prediction = "Unknown"
            else:
                if cropped_frame.shape[0] > 100 or cropped_frame.shape[1] > 100:
                    scale = 100 / max(cropped_frame.shape[0], cropped_frame.shape[1])
                    new_size = (int(cropped_frame.shape[1] * scale), int(cropped_frame.shape[0] * scale))
                    cropped_frame = cv2.resize(cropped_frame, new_size)
                
                prediction = adaface.predict_class(Image.fromarray(cropped_frame))
                prediction = prediction if prediction is not None else "Unknown"
            
            recognition_cache[cache_key] = prediction
        else:
            prediction = recognition_cache[cache_key]

        while track_id > len(preds):
            preds.append(defaultdict(int))
            first_frame.append(0)
            last_frame.append(0)
            seens.append(False)
            dones.append(False)

        if prediction != "Unknown":
            preds[track_id-1][prediction] += 1

        people_bbox[track_id] = [prediction, score, x1, y1, x2, y2]

        if not seens[track_id-1]:
            seens[track_id-1] = True
            first_frame[track_id-1] = len(tracked_objects)
            last_frame[track_id-1] = len(tracked_objects)

        first_frame[track_id-1] = last_frame[track_id-1]
        last_frame[track_id-1] = len(tracked_objects)

        tracked_objects.append([
            frame_counter,
            track_id, prediction,
            x1, y1, x2-x1, y2-y1,
            score
        ])

    if run_detection:
        exits = check_exit_condition(processed_frame)

    return exits, people_bbox

@app.on_event("startup")
async def initialize():
    await reset()

@app.post("/reset")
async def reset():
    global tracker, tracked_objects, preds, first_frame, last_frame, seens, dones
    global recognition_cache, frame_counter, processed_frame_idx, last_detections, last_detection_frame

    tracker = BYTETracker(args=byteArgs, frame_rate=fps)
    tracked_objects = []
    preds = []
    first_frame = []
    last_frame = []
    seens = []
    dones = []
    recognition_cache = {}  # Cache for face recognition

    frame_counter = 0
    processed_frame_idx = 0  # Index of processed frame after skipping
    last_detections = []
    last_detection_frame = None

    return {"status": "tracker reset"}

def decode_image(img_bytes):
    nparr = np.frombuffer(img_bytes, np.uint8)
    return cv2.imdecode(nparr, cv2.IMREAD_COLOR)

@app.get("/get_exits")
async def get_exits():
    all_exits = final_exit()
    await reset()
    return {"exits": all_exits}

@app.get("/get_all_exits")
async def get_all_exits():
    cursor.execute('''
        SELECT name, timestamp FROM face_recognition
    ''')
    all_exits = cursor.fetchall()
    
    target_timezone = pytz.timezone("Asia/Kolkata")
    
    final_exits = []
    for name, timestamp in all_exits:
        ts = datetime.fromisoformat(timestamp)
        ts = pytz.utc.localize(ts).astimezone(target_timezone)
        final_exits.append((name, ts.isoformat()))
    
    return {"exits": final_exits}

@app.websocket("/ws/frames")
async def websocket_inference(ws: WebSocket):
    print(frame_counter)
    await ws.accept()
    print("Client connected for real-time inference.")
    await reset()

    while True:
            # Receive binary image data (e.g., JPEG from frontend)
        img_bytes = await ws.receive_bytes()
        # print(f"Recieved {img_bytes} bytes")
        frame = decode_image(img_bytes)
        
        if frame is None:
            print("Frame is None")
            continue
        
        print(f"Recieved {frame.shape}")

        # Run your tracking & face recognition logic
        exit_ids, pred_bbox = process_frame(frame)
        print(f"Exited: {exit_ids}")
        print(f"Predictions: {pred_bbox}")

        # Send results back as JSON
        await ws.send_json({
            "exit_ids": exit_ids,
            "predictions": pred_bbox
        })
        print("Sent results back as JSON")

        # except Exception as e:
        #     print("Error during WebSocket frame processing:", e)
        #     break

    final_exit()
    await ws.close()
    print("Client disconnected.")
        

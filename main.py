import cv2
import dai
import numpy as np
from PIL import Image
from collections import defaultdict
import adaface
from bytetrack.byte_tracker import BYTETracker
from datetime import datetime
import os

skip_frames = 1
votes_thresh = 5

class byte_track_args:
    def __init__(self, track_thresh=0.45, track_buffer=25, match_thresh=0.8):
        self.track_thresh = track_thresh
        self.track_buffer = track_buffer
        self.match_thresh = match_thresh
        self.mot20 = False

vid_name = "VID_20250327_005627591.mp4"

cap = cv2.VideoCapture(vid_name)
orig_fps = cap.get(cv2.CAP_PROP_FPS)
fps = orig_fps / skip_frames
args = byte_track_args()
tracker = BYTETracker(args=args, frame_rate=orig_fps)

tracked_objects = []
preds = []
first_frame = []
last_frame = []
seens = []
dones = []

out_vid_name = f"{os.path.basename(vid_name).split('.')[0]}_complete.mp4"
vid_writer = cv2.VideoWriter(out_vid_name, cv2.VideoWriter_fourcc(*'mp4v'), fps, (int(cap.get(3)), int(cap.get(4))))

frame_idx = 0
start = datetime.now()
while True:
    ret, frame = cap.read()
    if not ret:
        break
    frame_idx += 1
    if frame_idx % skip_frames != 0:
        continue
    frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    
    detections = dai.face_from_frame(frame)
    if len(detections) == 0:
        continue

    detection_array = np.array(detections)
    h, w = frame.shape[:2]
    online_tracks = tracker.update(detection_array, (h, w), (h, w))

    for track in online_tracks:
        x1, y1, x2, y2 = track.tlbr
        track_id = track.track_id
        score = track.score

        cropped_frame = frame[
            int(y1):int(y2),
            int(x1):int(x2),
            :
        ]

        if cropped_frame.shape[0] == 0 or cropped_frame.shape[1] == 0:
            print("Invalid cropped frame")
            continue
        prediction = adaface.predict_class(Image.fromarray(cropped_frame))
        prediction = prediction if prediction is not None else "Unknown"

        while track_id > len(preds):
            preds.append(defaultdict(int))
            first_frame.append(0)
            last_frame.append(0)
            seens.append(False)
            dones.append(False)

        if prediction != "Unknown":
            preds[track_id-1][prediction] += 1

        cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), (0,255,0), 2)
        cv2.putText(
            frame,
            f'ID:{int(track_id)} {prediction} {score:.2f}',
            (int(x1), int(y1)-10),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (0,255,0),
            2
        )

        if not seens[track_id-1]:
            seens[track_id-1] = True
            first_frame[track_id-1] = len(tracked_objects)
            last_frame[track_id-1] = len(tracked_objects)

        first_frame[track_id-1] = last_frame[track_id-1]
        last_frame[track_id-1] = len(tracked_objects)

        tracked_objects.append([
            frame_idx, track_id, prediction,
            x1, y1, x2-x1, y2-y1,
            score
        ])

        for i in range(len(preds)):
            if not dones[i]:
                if tracked_objects[last_frame[i]][0] - frame_idx > args.track_buffer:
                    dones[i] = True
                    print(f"ID {i+1} done")

                speed = tracked_objects[last_frame[i]][3] - tracked_objects[first_frame[i]][3]
                new_loc = tracked_objects[last_frame[i]][3] + speed * (frame_idx - tracked_objects[last_frame[i]][0])
                if new_loc + tracked_objects[last_frame[i]][5] > frame.shape[1]:
                    dones[i] = True
                    print(f"ID {i+1} done")

                if dones[i]:
                    if len(preds[i]) > 0:
                        majority_vote = max(preds[i], key=preds[i].get)
                        votes = preds[i][majority_vote]
                        if votes >= votes_thresh:
                            print(f"{majority_vote} Exited the campus")


    frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
    vid_writer.write(frame)

end = datetime.now()

cap.release()
vid_writer.release()

print("Video Mode Over")
for i in range(len(preds)):
    if not dones[i]:
        if len(preds[i]) > 0:
            majority_vote = max(preds[i], key=preds[i].get)
            votes = preds[i][majority_vote]
            if votes >= votes_thresh:
                print(f"{majority_vote} Exited the campus")

print(f"Time taken: {end - start}")
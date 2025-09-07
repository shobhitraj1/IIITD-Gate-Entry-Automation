import cv2
import dai
import numpy as np
from PIL import Image
from collections import defaultdict
import adaface
from bytetrack.byte_tracker import BYTETracker
import time
import os

# Configuration
skip_frames = 3  # Take 1 in every 2 frames
detection_interval = 6  # Only run detection every N processed frames
votes_thresh = 5

class byte_track_args:
    def __init__(self, track_thresh=0.45, track_buffer=50, match_thresh=0.8):
        self.track_thresh = track_thresh
        self.track_buffer = track_buffer
        self.match_thresh = match_thresh
        self.mot20 = False

vid_name = "VID_20250327_005627591.mp4"

def main():
    cap = cv2.VideoCapture(vid_name)
    orig_fps = cap.get(cv2.CAP_PROP_FPS)
    output_fps = orig_fps / skip_frames  # Adjust output FPS based on frame skipping
    args = byte_track_args()
    tracker = BYTETracker(args=args, frame_rate=orig_fps)

    tracked_objects = []
    preds = []
    first_frame = []
    last_frame = []
    seens = []
    dones = []
    recognition_cache = {}  # Cache for face recognition

    out_vid_name = f"{os.path.basename(vid_name).split('.')[0]}_lessdet.mp4"
    vid_writer = cv2.VideoWriter(out_vid_name, cv2.VideoWriter_fourcc(*'mp4v'), 
                                output_fps, (int(cap.get(3)), int(cap.get(4))))

    start_time = time.time()
    raw_frame_idx = 0  # Index of actual frame from video
    processed_frame_idx = 0  # Index of processed frame after skipping
    last_detections = []
    last_detection_frame = None

    print(f"Processing 1 frame for every {skip_frames} frames of video")
    print(f"Running detection every {detection_interval} processed frames")

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        raw_frame_idx += 1
        
        # Skip frames according to skip_frames parameter
        if raw_frame_idx % skip_frames != 0:
            continue
            
        processed_frame_idx += 1
        process_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        # Determine if we should run detection on this frame
        run_detection = (processed_frame_idx % detection_interval == 0 or not last_detections)

        if run_detection:
            # Run full detection
            print(f"Frame {raw_frame_idx} (Processed {processed_frame_idx}): Running detection")
            detection_start = time.time()
            detections = dai.face_from_frame(process_frame)
            detection_time = time.time() - detection_start
            print(f"Detection took {detection_time:.2f} seconds")
            
            if len(detections) > 0:
                # Store detections for future frames
                last_detections = detections.copy()
                last_detection_frame = processed_frame_idx
        else:
            # Predict detections based on previous detections
            detections = []
            if last_detections and (processed_frame_idx - last_detection_frame) <= detection_interval*2:
                # Simple linear prediction of bounding boxes
                motion_factor = min(1.0, (processed_frame_idx - last_detection_frame) / detection_interval)
                
                for det in last_detections:
                    # Extrapolate based on estimated motion
                    x1, y1, x2, y2, conf = det
                    # Slightly expand box to account for potential movement
                    width = x2 - x1
                    height = y2 - y1
                    expansion = motion_factor * 0.05  # 5% expansion per interval
                    
                    new_det = [
                        max(0, x1 - width * expansion),
                        max(0, y1 - height * expansion),
                        min(process_frame.shape[1], x2 + width * expansion),
                        min(process_frame.shape[0], y2 + height * expansion),
                        conf * 0.98  # Slightly reduce confidence for predicted boxes
                    ]
                    detections.append(new_det)

        # Skip tracking if no detections
        if len(detections) == 0:
            vid_writer.write(frame)
            continue

        # Update tracker
        detection_array = np.array(detections)
        h, w = process_frame.shape[:2]
        online_tracks = tracker.update(detection_array, (h, w), (h, w))

        # Process tracks
        for track in online_tracks:
            x1, y1, x2, y2 = track.tlbr
            track_id = track.track_id
            score = track.score

            # Convert to integers and ensure within bounds
            x1, y1, x2, y2 = int(max(0, x1)), int(max(0, y1)), int(min(w, x2)), int(min(h, y2))
            
            if x2 <= x1 or y2 <= y1:
                continue

            # Generate cache key
            cache_key = f"{track_id}_{processed_frame_idx // detection_interval}"
            
            # Only perform recognition on detection frames or for new tracks
            if run_detection or cache_key not in recognition_cache:
                cropped_frame = process_frame[y1:y2, x1:x2, :]
                
                if cropped_frame.shape[0] == 0 or cropped_frame.shape[1] == 0:
                    prediction = "Unknown"
                else:
                    # Resize large faces for faster recognition
                    if cropped_frame.shape[0] > 100 or cropped_frame.shape[1] > 100:
                        scale = 100 / max(cropped_frame.shape[0], cropped_frame.shape[1])
                        new_size = (int(cropped_frame.shape[1] * scale), int(cropped_frame.shape[0] * scale))
                        cropped_frame = cv2.resize(cropped_frame, new_size)
                    
                    # Run face recognition
                    recognition_start = time.time()
                    prediction = adaface.predict_class(Image.fromarray(cropped_frame))
                    recognition_time = time.time() - recognition_start
                    
                    if recognition_time > 0.1:
                        print(f"Recognition took {recognition_time:.2f} seconds")
                    
                    prediction = prediction if prediction is not None else "Unknown"
                
                # Store in cache
                recognition_cache[cache_key] = prediction
            else:
                # Use cached result
                prediction = recognition_cache[cache_key]

            # Extend arrays if needed
            while track_id > len(preds):
                preds.append(defaultdict(int))
                first_frame.append(0)
                last_frame.append(0)
                seens.append(False)
                dones.append(False)

            if prediction != "Unknown":
                preds[track_id-1][prediction] += 1

            # Draw bounding box and label
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
            cv2.putText(
                frame,
                f'ID:{int(track_id)} {prediction} {score:.2f}',
                (x1, y1-10),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (0, 255, 0),
                2
            )

            # Update tracking info
            if not seens[track_id-1]:
                seens[track_id-1] = True
                first_frame[track_id-1] = len(tracked_objects)
                last_frame[track_id-1] = len(tracked_objects)

            first_frame[track_id-1] = last_frame[track_id-1]
            last_frame[track_id-1] = len(tracked_objects)

            tracked_objects.append([
                raw_frame_idx,  # Store actual frame index
                track_id, prediction,
                x1, y1, x2-x1, y2-y1,
                score
            ])

        # Process done tracks - only check on detection frames to reduce overhead
        if run_detection:
            for i in range(len(preds)):
                if not dones[i] and i < len(last_frame) and last_frame[i] < len(tracked_objects):
                    if tracked_objects[last_frame[i]][0] - raw_frame_idx > args.track_buffer * skip_frames:
                        dones[i] = True
                        print(f"ID {i+1} done (timeout)")
                        
                    if i < len(first_frame) and first_frame[i] < len(tracked_objects):
                        speed = tracked_objects[last_frame[i]][3] - tracked_objects[first_frame[i]][3]
                        time_diff = tracked_objects[last_frame[i]][0] - tracked_objects[first_frame[i]][0]
                        if time_diff > 0:
                            frames_ahead = raw_frame_idx - tracked_objects[last_frame[i]][0]
                            new_loc = tracked_objects[last_frame[i]][3] + speed * (frames_ahead / time_diff)
                            if new_loc + tracked_objects[last_frame[i]][5] > process_frame.shape[1]:
                                dones[i] = True
                                print(f"ID {i+1} done (left frame)")
                            
                    if dones[i] and len(preds[i]) > 0:
                        majority_vote = max(preds[i], key=preds[i].get)
                        votes = preds[i][majority_vote]
                        if votes >= votes_thresh:
                            print(f"{majority_vote} Exited the campus")

        # Write frame to output
        vid_writer.write(frame)
        
        # Print progress periodically
        if processed_frame_idx % 10 == 0:
            elapsed = time.time() - start_time
            fps_actual = processed_frame_idx / elapsed if elapsed > 0 else 0
            real_time_factor = fps_actual / (orig_fps / skip_frames)
            print(f"Processed {processed_frame_idx} frames ({raw_frame_idx} raw frames). "
                  f"FPS: {fps_actual:.2f} ({real_time_factor:.2f}x real-time)")

    # Final processing for remaining tracks
    print("Video Mode Over")
    for i in range(len(preds)):
        if not dones[i]:
            if len(preds[i]) > 0:
                majority_vote = max(preds[i], key=preds[i].get)
                votes = preds[i][majority_vote]
                if votes >= votes_thresh:
                    print(f"{majority_vote} Exited the campus")

    # Cleanup
    cap.release()
    vid_writer.release()
    
    elapsed = time.time() - start_time
    total_fps = processed_frame_idx / elapsed if elapsed > 0 else 0
    print(f"Total processing time: {elapsed:.2f} seconds.")
    print(f"Overall processing speed: {total_fps:.2f} FPS")
    print(f"Video real-time factor: {total_fps / (orig_fps / skip_frames):.2f}x")

if __name__ == "__main__":
    main()
import torch
import torch.backends.cudnn as cudnn
from torch.autograd import Variable
from networks.DAINet import build_net_dark
import cv2
import numpy as np

skip_frames = 10

X_SIZE = 1440
IMAGE_DELTA = 0.01
DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

if torch.cuda.is_available():
    torch.set_default_tensor_type('torch.cuda.FloatTensor')
    cudnn.benckmark = True

dai_net = build_net_dark(phase='test', num_classes=2)
dai_net.eval()
dai_net.load_state_dict(torch.load("weights/DarkFaceFS.pth", map_location=DEVICE))
dai_net = dai_net.to(DEVICE)

def detect_face(img, tmp_shrink):
    image = cv2.resize(img, None, None, fx=tmp_shrink,
                       fy=tmp_shrink, interpolation=cv2.INTER_LINEAR)

    x = image[..., ::-1].transpose(2, 0, 1).astype(np.float32) / 255.0

    x = Variable(torch.from_numpy(x).unsqueeze(0))
    x = x.to(DEVICE)

    y = dai_net.test_forward(x)[0]
    detections = y.data.cpu().numpy()
    scale = np.array([img.shape[1], img.shape[0], img.shape[1], img.shape[0]])

    boxes=[]
    scores = []
    for i in range(detections.shape[1]):
      j = 0
      while ((j < detections.shape[2]) and detections[0, i, j, 0] > 0.0):
        pt = (detections[0, i, j, 1:] * scale)
        score = detections[0, i, j, 0]
        boxes.append([pt[0],pt[1],pt[2],pt[3]])
        scores.append(score)
        j += 1

    det_conf = np.array(scores)
    boxes = np.array(boxes)

    if boxes.shape[0] == 0:
        return np.array([[0,0,0,0,0.001]])
    
    det_xmin = boxes[:,0] # / tmp_shrink
    det_ymin = boxes[:,1] # / tmp_shrink
    det_xmax = boxes[:,2] # / tmp_shrink
    det_ymax = boxes[:,3] # / tmp_shrink
    det = np.column_stack((det_xmin, det_ymin, det_xmax, det_ymax, det_conf))

    return det

def face_from_frame(frame):
    org_y_size = frame.shape[0]
    org_x_size = frame.shape[1]
    scale = X_SIZE / org_x_size
    frame_cpy = cv2.resize(frame.copy(), (X_SIZE, int(frame.shape[0] * scale)), interpolation=cv2.INTER_LINEAR)
    with torch.no_grad():
        dets = detect_face(frame_cpy, 1)
    
    new_dets = []
    for det in dets:
        if det[4] < 0.55:
            continue

        det[0] = int(det[0] - IMAGE_DELTA * org_x_size)
        det[1] = int(det[1] - IMAGE_DELTA * org_y_size)
        det[2] = int(det[2] + IMAGE_DELTA * org_x_size)
        det[3] = int(det[3] + IMAGE_DELTA * org_y_size)

        xmin = int(det[0] / scale)
        ymin = int(det[1] / scale)
        xmax = int(det[2] / scale)
        ymax = int(det[3] / scale)

        new_dets.append([xmin, ymin, xmax, ymax, det[4]])

    return new_dets

if __name__ == "__main__":
    cap = cv2.VideoCapture("test.MOV")
    # with cv2.VideoCapture("test.MOV") as cap:
    frame_counter = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame_counter += 1
        if frame_counter % skip_frames != 0:
            continue

        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        org_y_size = frame.shape[0]
        org_x_size = frame.shape[1]

        frame_cpy = cv2.resize(frame.copy(), (X_SIZE, int(frame.shape[0] * X_SIZE / frame.shape[1])), interpolation=cv2.INTER_LINEAR)
        with torch.no_grad():
            dets = detect_face(frame_cpy, 1)

        for det in dets:
            if det[4] < 0.6:
                continue
            xmin = int(det[0] * org_x_size / X_SIZE)
            ymin = int(det[1] * org_y_size / X_SIZE)
            xmax = int(det[2] * org_x_size / X_SIZE)
            ymax = int(det[3] * org_y_size / X_SIZE)

            xmin *= org_x_size // X_SIZE
            xmax *= org_x_size // X_SIZE
            ymin *= org_y_size // int(org_y_size * X_SIZE / org_x_size)
            ymax *= org_y_size // int(org_y_size * X_SIZE / org_x_size)

            # cv2.rectangle(frame, (xmin, ymin), (xmax, ymax), (0, 255, 0), 2)
            print(f"Detected face at: {xmin}, {ymin}, {xmax}, {ymax}: {det[4]}")

    cap.release()
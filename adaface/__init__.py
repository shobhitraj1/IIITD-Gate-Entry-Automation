import adaface.adaface_net as net
import torch
import os
from face_alignment import align
import numpy as np
import torchvision
import cv2

__all__ = ["predict_class"]

adaface_models = {
    'ms1mv3':"weights/adaface_ir101_ms1mv3.ckpt",
    'webface12m': "weights/adaface_ir101_webface12m.ckpt"
}

cos_thresh = 0.35

DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

def load_pretrained_model(pretrained_dataset="ms1mv3"):
    # load model and pretrained statedict
    assert pretrained_dataset in adaface_models.keys()
    model = net.build_model('ir_101')
    statedict = torch.load(adaface_models[pretrained_dataset])['state_dict']
    model_statedict = {key[6:]:val for key, val in statedict.items() if key.startswith('model.')}
    model.load_state_dict(model_statedict)
    model.eval()
    return model

def to_input(pil_rgb_image):
    np_img = np.array(pil_rgb_image)
    brg_img = ((np_img[:,:,::-1] / 255.) - 0.5) / 0.5
    tensor = torch.tensor(brg_img.transpose(2,0,1)).unsqueeze(dim=0).float()
    return tensor

def predict_class(img):
    img_pil = np.array(img)
    img_pil = cv2.resize(img_pil, (112, 112))

    bboxes, faces = align.mtcnn_model.align_multi(img, limit=1)
    if len(faces) > 0:
        img_pil = np.array(faces[0])

    aligned_img = to_input(img_pil).to(DEVICE)
    with torch.no_grad():
        embedding, _ = model(aligned_img)
    embedding = embedding.cpu().numpy()

    embedding /= np.linalg.norm(embedding)
    cosine_similarities = np.squeeze(np.dot(embedding, all_embeddings.T), axis=0)
    predicted_class = np.argmax(cosine_similarities)
    cosine_score = cosine_similarities[predicted_class]

    if cosine_score < cos_thresh: return None
    return imgs.classes[predicted_class]

model = load_pretrained_model(pretrained_dataset="webface12m").to(DEVICE)

imgs = torchvision.datasets.ImageFolder("dataset/")
embeddings = [[] for _ in range(len(imgs.classes))]
for i in range(len(imgs)):
    img_pil = np.array(imgs[i][0])
    img_pil = cv2.resize(img_pil, (112, 112))

    bboxes, faces = align.mtcnn_model.align_multi(imgs[i][0], limit=1)
    if len(faces) > 0:
        img_pil = np.array(faces[0])

    aligned_img = to_input(img_pil).to(DEVICE)
    with torch.no_grad():
        embedding, _ = model(aligned_img)
    embedding = embedding.cpu().numpy()
    embeddings[imgs[i][1]].append(embedding)

all_embeddings = []

for i in range(len(embeddings)):
    mean_embedding = np.squeeze(np.stack(embeddings[i]), axis=1).mean(axis=0)
    mean_embedding /= np.linalg.norm(mean_embedding)
    all_embeddings.append(mean_embedding)

all_embeddings = np.stack(all_embeddings)

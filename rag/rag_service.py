"""
RAG service — ใช้ FAISS แทน ChromaDB
"""
import pickle, time
import numpy as np
import faiss
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

FAISS_INDEX = '/opt/net-chat/rag/faiss_index.bin'
FAISS_META  = '/opt/net-chat/rag/faiss_meta.pkl'
EMBED_MODEL = 'all-MiniLM-L6-v2'

app = FastAPI()

print("โหลด embedding model...", flush=True)
embedder = SentenceTransformer(EMBED_MODEL)

print("โหลด FAISS index...", flush=True)
index = faiss.read_index(FAISS_INDEX)
print(f"FAISS: {index.ntotal:,} vectors", flush=True)

print("โหลด metadata...", flush=True)
with open(FAISS_META, 'rb') as f:
    meta_list = pickle.load(f)
print(f"metadata: {len(meta_list):,} records พร้อมใช้งาน ✅", flush=True)


class QueryRequest(BaseModel):
    question: str
    n_results: int = 5


@app.post("/query")
def query_rag(req: QueryRequest):
    emb = embedder.encode([req.question], normalize_embeddings=True)
    emb = np.array(emb, dtype=np.float32)
    scores, idxs = index.search(emb, req.n_results)
    docs = []
    for idx in idxs[0]:
        if idx < 0 or idx >= len(meta_list): continue
        m = meta_list[idx]
        docs.append(f"Q: {m['q']}\nA: {m['a']}")
    return {"context": docs}


@app.get("/status")
def status():
    return {"docs": index.ntotal, "model": EMBED_MODEL, "engine": "faiss"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=5002)

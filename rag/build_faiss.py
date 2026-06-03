"""
สร้าง FAISS index จาก ChromaDB network_qa + embed_p2.npz
แบบ incremental — ไม่โหลดทุกอย่างพร้อมกัน ประหยัด RAM
"""
import json, time, pickle
import numpy as np
import faiss
import chromadb

CHROMA_DIR  = '/opt/net-chat/rag/chroma_db'
FAISS_INDEX = '/opt/net-chat/rag/faiss_index.bin'
FAISS_META  = '/opt/net-chat/rag/faiss_meta.pkl'
NPZ_P2      = '/opt/net-chat/rag/embed_p2.npz'
DIM         = 384

meta_list = []
index     = faiss.IndexFlatIP(DIM)

# --- 1. Export ChromaDB network_qa → FAISS ---
print("โหลด ChromaDB network_qa...", flush=True)
client = chromadb.PersistentClient(path=CHROMA_DIR)
col    = client.get_collection('network_qa')
total  = col.count()
print(f"total: {total:,} docs", flush=True)

BATCH = 2000
offset = 0
t0 = time.time()
while offset < total:
    res = col.get(limit=BATCH, offset=offset, include=['embeddings','documents','metadatas'])
    if not res['ids']: break
    embs = np.array(res['embeddings'], dtype=np.float32)
    faiss.normalize_L2(embs)
    index.add(embs)
    for i, id_ in enumerate(res['ids']):
        doc  = res['documents'][i] if res['documents'] else ''
        meta = (res['metadatas'][i] or {}) if res['metadatas'] else {}
        meta_list.append({'id': id_, 'lang': meta.get('lang','en'),
                          'q': meta.get('q_th', doc[:150]),
                          'a': meta.get('a', doc[:300])})
    offset += len(res['ids'])
    rate = offset / (time.time()-t0)
    print(f"  {offset:,}/{total:,} ({offset/total*100:.1f}%) {rate:.0f}/s", flush=True)

print(f"export ChromaDB เสร็จ: {index.ntotal:,} vectors", flush=True)

# --- 2. เพิ่ม embed_p2.npz (Thai Q+A) ---
print("\nโหลด embed_p2.npz...", flush=True)
data   = np.load(NPZ_P2, allow_pickle=True)
ids    = data['ids'].tolist()
embs   = data['embeddings']
q_list = data['q'].tolist()
a_list = data['a'].tolist()
print(f"embed_p2: {len(ids):,} records", flush=True)

BATCH2 = 5000
for i in range(0, len(ids), BATCH2):
    sl = slice(i, i+BATCH2)
    batch_emb = np.array(embs[sl], dtype=np.float32)
    faiss.normalize_L2(batch_emb)
    index.add(batch_emb)
    for j in range(len(ids[i:i+BATCH2])):
        meta_list.append({'id': ids[i+j], 'lang': 'th2',
                          'q': str(q_list[i+j])[:150],
                          'a': str(a_list[i+j])[:300]})
    print(f"  embed_p2: {min(i+BATCH2,len(ids)):,}/{len(ids):,}", flush=True)

print(f"รวมทั้งหมด: {index.ntotal:,} vectors", flush=True)

# --- บันทึก ---
print("บันทึก faiss_index.bin...", flush=True)
faiss.write_index(index, FAISS_INDEX)
print("บันทึก faiss_meta.pkl...", flush=True)
with open(FAISS_META, 'wb') as f:
    pickle.dump(meta_list, f, protocol=4)

print(f"\n✅ เสร็จ! {index.ntotal:,} vectors → {FAISS_INDEX}", flush=True)

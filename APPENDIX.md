# APPENDIX — อธิบาย Code ทุกไฟล์

> Code จริงอยู่ในโฟลเดอร์ `ml_pipeline/`, `chat_system/`, `rag/`

---

## ML Pipeline (`ml_pipeline/`)

---

### `export.py`
**ที่อยู่จริง:** `/opt/net-model/export.py`
**ทำอะไร:** ดึงข้อมูลจาก DB table `snmp` + `interface` มาคำนวณ features แล้วบันทึกเป็น CSV

**Input:** PostgreSQL edgedb (snmp, interface)
**Output:** `edge_data.csv` — features สำหรับ predict

**Features ที่สร้าง:**
```
cpu_5s      — CPU usage %
mem_used    — RAM ใช้งาน bytes
in_bps      — traffic ขาเข้า bps (คำนวณจาก ifHCInOctets delta)
out_bps     — traffic ขาออก bps
in_err_rate — error rate ขาเข้า (errors/packets)
in_util_pct — % utilization ขาเข้า (in_bps / ifSpeed * 100)
```

**Logic หลัก:**
- JOIN snmp กับ interface บน hostname + เวลาใกล้เคียง
- คำนวณ bps จาก delta ของ counter (ifHCInOctets[t] - ifHCInOctets[t-1]) / seconds
- ดึงเฉพาะข้อมูลใหม่ตั้งแต่ timestamp ล่าสุดใน ml_isolation_forest

---

### `predict.py`
**ที่อยู่จริง:** `/opt/net-model/predict.py`
**ทำอะไร:** โหลด IsolationForest model แล้ว predict anomaly + จำแนก scenario_name

**Input:** `edge_data.csv` (จาก export.py), `models/*.pkl`
**Output:** `result.csv` — ผลการ predict

**Logic หลัก:**
```python
# 1. โหลด model ตาม hostname
model  = load(f"models/{hostname}_iso_model.pkl")
scaler = load(f"models/{hostname}_iso_scaler.pkl")

# 2. Scale features
X_scaled = scaler.transform(features)

# 3. Predict
anomaly = model.predict(X_scaled)  # -1=anomaly, 1=normal
score   = model.score_samples(X_scaled)

# 4. Noise filter — ค่าต่ำเกินจริงๆ normal
if cpu < 10% AND mem < 10MB AND bps < 1M AND err = 0:
    anomaly = normal

# 5. Assign scenario_name
scenario = scenario_classifier.predict(features)
```

**scenario_classifier (SL):** RandomForest เทรนบน labeled data 80/20 split
**Noise filter:** ป้องกัน false positive จาก idle traffic

---

### `predict_arima.py`
**ที่อยู่จริง:** `/opt/net-model/predict_arima.py`
**ทำอะไร:** ARIMA forecast — เปรียบ actual vs predicted ถ้าเกิน threshold = anomaly

**Input:** `edge_data.csv`, `arima_thresholds.json`
**Output:** `result_arima.csv`

**Features ที่ตรวจ:** cpu_5s, mem_used, in_bps, out_bps, in_err_rate, gap

**Logic หลัก:**
```python
# สำหรับแต่ละ feature แต่ละ hostname:
# 1. ดึง historical data 168 จุด (7 วัน ถ้ามี 5 นาที/จุด)
# 2. Fit ARIMA(p,d,q) 
# 3. Forecast 1 step
# 4. residual = actual - predicted
# 5. anomaly = residual > threshold

# Gap detection — ตรวจ SW ดับ
# ถ้าไม่มีข้อมูลเกิน 15 นาที → gap = True → scenario_name = "gap_detected"
```

**Threshold:** คำนวณจาก baseline April 2026 (ช่วง anomaly rate ต่ำสุด)

---

### `insert_result.py`
**ที่อยู่จริง:** `/opt/net-model/insert_result.py`
**ทำอะไร:** อ่าน `result.csv` แล้ว INSERT/UPDATE เข้า `ml_isolation_forest`

**UPSERT logic:** ON CONFLICT (time, hostname) DO UPDATE — ไม่ duplicate

---

### `insert_arima.py`
**ที่อยู่จริง:** `/opt/net-model/insert_arima.py`
**ทำอะไร:** อ่าน `result_arima.csv` แล้ว INSERT/UPDATE เข้า `ml_arima`

---

### `train_save.py`
**ที่อยู่จริง:** `/opt/net-model/train_save.py`
**ทำอะไร:** Retrain IsolationForest ใหม่ บันทึก model.pkl + scaler.pkl

**Logic:**
```python
# 1. ดึง baseline data — April (10 วันที่ anomaly rate ต่ำสุด)
# 2. สร้าง features เหมือน export.py
# 3. Fit IsolationForest(contamination=0.05, n_estimators=100)
# 4. บันทึก model แยกต่อ hostname
#    → models/PR-test-sw_netsec_local_iso_model.pkl
#    → models/RouterProject_mynetwork_com_iso_model.pkl
```

**Baseline:** ใช้ April 2026 เพราะ March มี OS upgrade ทำให้ค่า CPU/RAM สูงผิดปกติ

---

### `train_arima_threshold.py`
**ที่อยู่จริง:** `/opt/net-model/train_arima_threshold.py`
**ทำอะไร:** คำนวณ threshold ใหม่สำหรับ ARIMA anomaly detection

**Logic:**
```python
# 1. ดึง baseline data เดียวกับ train_save.py (April)
# 2. Fit ARIMA บน historical data
# 3. threshold = mean(residuals) + 3*std(residuals)
# 4. บันทึก → models/arima_thresholds.json
```

---

### `train_scenario_classifier.py`
**ที่อยู่จริง:** `/opt/net-model/train_scenario_classifier.py`
**ทำอะไร:** เทรน ML classifier จำแนก scenario_name จาก features

**Model:** RandomForestClassifier
**Input:** rows จาก ml_isolation_forest ที่มี scenario_name ไม่ว่าง + ไม่ใช่ unknown_anomaly
**Split:** 80% train / 20% test
**Output:** `models/scenario_classifier.pkl`

**Features ที่ใช้ classify:**
```
cpu_5s, mem_used, in_bps, out_bps, in_err_rate, in_util_pct
```

---

### `train_arima.py`
**ที่อยู่จริง:** `/opt/net-model/train_arima.py`
**ทำอะไร:** เทรน ARIMA model เก็บ parameters (p,d,q) ต่อ feature ต่อ device

---

## Chat System (`chat_system/`)

---

### `server.js`
**ที่อยู่จริง:** `/opt/dashboard-grafana/server.js`
**ขนาด:** ~50KB
**ทำอะไร:** Chat API หลัก — รับคำถาม routing ไปยัง service ที่เหมาะสม ตอบกลับ

**Endpoints:**
```
POST /api/chat         — chat ปกติ (รอจนเสร็จ)
POST /api/chat/stream  — chat แบบ streaming SSE
GET  /api/config       — ดึง quick prompts
GET  /health           — health check
```

**Routing Flow:**
```
คำถาม
  │
  ├─ Rate limit check (10 req/min per IP)
  ├─ Session lookup (Map in-memory, TTL 30min)
  │
  ├─ [Graph routing]
  │   graphKeywords: topology/โทโพโลยี/มีอะไรบ้าง
  │   → callGraph() → graph_service:5003
  │
  │   detectedProto + hasExistsQ: มีระบบ/support/available
  │   → callGraph() → ตอบว่า protocol มีหรือไม่
  │
  ├─ [Knowledge routing]
  │   คืออะไร/หมายถึง/explain/what is
  │   (ไม่ใช่คำถามใน DB: ระบบ/ล่าสุด/สถานะ)
  │   → callRAG() → qwen2.5:1.5b ตอบ
  │
  ├─ [SQL Template] — 12 patterns
  │   match pattern → SQL สำเร็จรูป → query DB
  │   → qwen2.5:1.5b วิเคราะห์ผล
  │
  └─ [qwen SQL gen]
      qwen2.5:1.5b สร้าง SQL → query DB
      → UNSAFE? → fallback RAG
      → มีผล → qwen2.5:1.5b วิเคราะห์
```

**Session:**
```javascript
SESSION_TTL_MS    = 30 * 60 * 1000  // 30 นาที
MAX_HISTORY_PAIRS = 8               // จำ 8 คู่ Q&A
```

**Safety:**
- isSafeSQL() — ตรวจ DROP/DELETE/INSERT/UPDATE ก่อนรัน
- UNSAFE_REQUEST — qwen ตอบกลับมาถ้าคำถามอันตราย → fallback RAG

---

### `config.js`
**ที่อยู่จริง:** `/opt/dashboard-grafana/config.js`
**ทำอะไร:** เก็บ config ทั้งหมด — prompts, schema reference

**เนื้อหา:**
```javascript
SQL_SYSTEM_PROMPT    — สอน qwen ว่า DB schema เป็นยังไง ตัวอย่าง SQL
ANALYST_SYSTEM_PROMPT — สอน qwen วิเคราะห์ผล DB อย่างไร
QUICK_PROMPTS        — รายการ quick prompts บน UI
```

**SQL_SYSTEM_PROMPT บอก qwen:**
- table ที่มี: snmp, interface, syslog, ml_isolation_forest, ml_arima
- column ที่สำคัญ
- ตัวอย่าง Q&A 10+ คู่
- ห้าม DROP/DELETE/UPDATE
- ถ้าไม่รู้จัก ตอบ UNSAFE_REQUEST

---

### `graph_service.py`
**ที่อยู่จริง:** `/opt/dashboard-grafana/graph_service.py`
**ทำอะไร:** สร้าง Knowledge Graph ของ network topology จาก DB แล้ว expose API

**Rebuild:** ทุก 5 นาที (background thread)

**Data ที่ดึงจาก DB:**
```python
protocols = {
    'snmp':              table snmp
    'interface':         table interface
    'syslog':            table syslog
    'anomaly_isolation': table ml_isolation_forest
    'anomaly_arima':     table ml_arima
}
```

**Structure ที่สร้าง:**
```json
{
  "devices": {
    "PR-test-sw.netsec.local": {
      "active":  ["snmp", "interface", "anomaly_isolation"],
      "no_data": ["syslog"],
      "no_table": ["ospf", "bgp", ...]
    }
  },
  "last_updated": "2026-06-03T06:00:00"
}
```

**API Endpoints:**
```
GET /graph/summary/all          — ทุก device ทุก protocol
GET /graph/{device}             — device เดียว
GET /graph/{device}/{protocol}  — เฉพาะ protocol
GET /status                     — health check
```

---

### `scenario_playbook.json`
**ที่อยู่จริง:** `/opt/dashboard-grafana/scenario_playbook.json`
**ทำอะไร:** เก็บ 10 scenarios + คำอธิบาย + คำแนะนำการแก้ไข

**Format:**
```json
{
  "high_memory": {
    "name": "High Memory Usage",
    "description": "RAM ใช้งานสูงผิดปกติ",
    "recommend": ["ตรวจสอบ process ที่กิน RAM", "พิจารณา upgrade RAM"]
  },
  ...
}
```

**10 Scenarios:** high_memory, traffic_flood, port_error, high_cpu, traffic_spike, traffic_high, link_congestion, error_flood, elevated_cpu, gap_detected

---

### `prompts_100.json`
**ที่อยู่จริง:** `/opt/dashboard-grafana/prompts_100.json`
**ทำอะไร:** ชุดทดสอบ 100 คำถาม network admin

**Format:**
```json
[
  {"id": 1, "category": "CPU", "label": "CPU ล่าสุด", "query": "CPU ล่าสุดของทุกเครื่อง"},
  ...
]
```

**Categories:** CPU, Memory, Interface, Traffic, Syslog, Anomaly, Security, ARIMA, Uptime, Knowledge

---

## RAG (`rag/`)

---

### `rag_service.py`
**ที่อยู่จริง:** `/opt/net-chat/rag/rag_service.py`
**ทำอะไร:** RAG query service — รับคำถาม ค้นหาใน FAISS index ส่ง context กลับ

**Startup:** โหลด faiss_index.bin + faiss_meta.pkl เข้า memory

**Flow:**
```python
POST /query
  question → embed (all-MiniLM-L6-v2)
           → FAISS index.search(embedding, top_5)
           → return [{Q: ..., A: ...}, ...]
```

**API:**
```
POST /query  {"question": str, "n_results": int}
             → {"context": ["Q: ...\nA: ...", ...]}
GET  /status → {"docs": 550774, "engine": "faiss"}
```

**ข้อมูลใน index:** 550,774 vectors
- English Q&A จาก Stack Exchange (network topics)
- Thai Q&A (แปลจาก Google Translate)
- scenario_playbook descriptions

---

### `build_faiss.py`
**ที่อยู่จริง:** `/opt/net-chat/rag/build_faiss.py`
**ทำอะไร:** สร้าง FAISS index จาก 2 แหล่ง แล้วบันทึกไฟล์

**Source 1 — ChromaDB network_qa (English):**
```python
client = chromadb.PersistentClient(path="chroma_db")
col    = client.get_collection('network_qa')
# ดึง embeddings + documents ทั้งหมด
```

**Source 2 — embed_p2.npz (Thai):**
```python
data = np.load('embed_p2.npz')
# embeddings = data['embeddings']
# questions  = data['questions']
# answers    = data['answers']
```

**Output:**
```
faiss_index.bin — FAISS IndexFlatIP (Inner Product = cosine similarity)
faiss_meta.pkl  — list of {q, a} metadata
```

---

## โครงสร้างโฟลเดอร์สรุป

```
Project-2/
├── PROJECT_STATE.md       — ภาพรวมระบบ
├── REFERENCE.md           — ข้อมูลอ้างอิง (DB schema, ports, env)
├── APPENDIX.md            — อธิบาย code (ไฟล์นี้)
│
├── ml_pipeline/           — ML anomaly detection
│   ├── export.py          — ดึงข้อมูลจาก DB
│   ├── predict.py         — IsolationForest predict
│   ├── predict_arima.py   — ARIMA forecast
│   ├── insert_result.py   — บันทึกผล IsolationForest → DB
│   ├── insert_arima.py    — บันทึกผล ARIMA → DB
│   ├── train_save.py      — retrain IsolationForest
│   ├── train_arima.py     — train ARIMA
│   ├── train_arima_threshold.py  — คำนวณ threshold
│   ├── train_scenario_classifier.py — train scenario classifier
│   └── arima_thresholds.json      — threshold ปัจจุบัน
│
├── chat_system/           — Chat API + services
│   ├── server.js          — Chat API หลัก (routing, SQL, session)
│   ├── config.js          — prompts, schema reference
│   ├── graph_service.py   — Knowledge Graph builder
│   ├── scenario_playbook.json — 10 scenarios + คำแนะนำ
│   └── prompts_100.json   — ชุดทดสอบ 100 คำถาม
│
└── rag/                   — RAG knowledge base
    ├── rag_service.py     — FAISS query service
    └── build_faiss.py     — สร้าง index จาก ChromaDB + npz
```

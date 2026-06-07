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
  │   → callRAG() → qwen2.5:3b ตอบ
  │
  ├─ [SQL Template] — 12 patterns
  │   match pattern → SQL สำเร็จรูป → query DB
  │   → qwen2.5:3b วิเคราะห์ผล
  │
  └─ [qwen SQL gen]
      qwen2.5:3b สร้าง SQL → query DB
      → UNSAFE? → fallback RAG
      → มีผล → qwen2.5:3b วิเคราะห์
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

**ข้อมูลใน index:** 708,562 vectors
- English Q&A จาก Stack Exchange (network topics)
- Thai Q&A (แปลจาก Google Translate)

---

### `build_faiss.py`
**ที่อยู่จริง:** `/opt/net-chat/rag/build_faiss.py`
**ทำอะไร:** สร้าง FAISS index จาก embed_0 + embed_p1 + embed_p2 แล้วบันทึก

**Source 1 — embed_0.npz (EN Q + EN A):**
- มาจาก combined.jsonl (Stack Exchange English) → embed
- เก็บเป็น .npz

**Source 2 — embed_p1.npz (TH Q + EN A):**
- มาจาก combined_th.jsonl → embed
- เก็บเป็น .npz

**Source 3 — embed_p2.npz (TH Q + TH A):**
- มาจาก combined_th_full.jsonl → embed
- เก็บเป็น .npz

**Output:**
```
faiss_index.bin — FAISS IndexFlatIP (Inner Product = cosine similarity)
faiss_meta.pkl  — list of {q, a} metadata
total: 708,562 vectors
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

---

## ผลทดสอบ 100 คำถาม

**ผลรวม:** ✓93  ✗7  เฉลี่ย 100s  (7 ข้อ fail = timeout ทั้งหมด ไม่ใช่ตอบผิด)

| ข้อ | Category | คำถาม | ผล |
|-----|----------|-------|----|
| 1 | CPU | แสดง CPU ล่าสุดของทุก hostname | ✓ |
| 2 | CPU | hostname ไหนมี CPU สูงสุดตอนนี้ | ✓ |
| 3 | CPU | แสดง CPU เฉลี่ย 24 ชั่วโมงที่ผ่านมาของทุก hostname | ✓ |
| 4 | CPU | แสดง CPU ล่าสุดของ PR-test-sw.netsec.local | ✓ |
| 5 | CPU | แสดง CPU ล่าสุดของ RouterProject.mynetwork.com | ✓ |
| 6 | CPU | แสดงช่วงเวลาที่ CPU สูงกว่า 80% ทั้งหมด | ✓ |
| 7 | CPU | แสดงประวัติ CPU ของทุก hostname ย้อนหลัง 7 วัน เรียงตามเวลา | ✓ |
| 8 | CPU | แสดง top 5 ช่วงเวลาที่ CPU สูงที่สุดในทุก hostname | ✓ |
| 9 | CPU | เปรียบเทียบ CPU ล่าสุดระหว่าง switch กับ router | ✓ |
| 10 | CPU | แสดง CPU ต่ำสุดของทุก hostname ใน 24 ชั่วโมงที่ผ่านมา | ✓ |
| 11 | Memory | แสดง memory ที่ใช้และว่างล่าสุดของทุก hostname | ✓ |
| 12 | Memory | hostname ไหนใช้ memory เกิน 80% ตอนนี้ | ✓ |
| 13 | Memory | แสดง memory ล่าสุดของ PR-test-sw.netsec.local | ✓ |
| 14 | Memory | แสดง memory ล่าสุดของ RouterProject.mynetwork.com | ✓ |
| 15 | Memory | แสดง memory usage เฉลี่ยของทุก device | ✓ |
| 16 | Memory | แสดงช่วงเวลาที่ memory ใช้สูงสุดของทุก hostname ใน 7 วันที่ผ่านมา | ✓ |
| 17 | Memory | แสดงช่วงเวลาที่ memory free ต่ำกว่า 5MB ทั้งหมด | ✓ |
| 18 | Memory | เปรียบเทียบ memory ล่าสุดระหว่าง switch กับ router | ✓ |
| 19 | Memory | แสดงประวัติ memory ใช้และว่างของทุก hostname ใน 24 ชั่วโมงที่ผ่านมา | ✓ |
| 20 | Memory | แสดง % memory ที่ใช้ของทุก hostname ล่าสุด | ✓ |
| 21 | Interface | แสดงสถานะ interface ล่าสุดของทุก hostname | ✓ |
| 22 | Interface | แสดง interface ที่ operStatus เป็น Down ทั้งหมดตอนนี้ | ✓ |
| 23 | Interface | แสดงเฉพาะ interface ที่ operStatus เป็น Up ทั้งหมด | ✓ |
| 24 | Interface | แสดงสถานะ Vlan interface ทั้งหมดบน switch | ✗ timeout |
| 25 | Interface | แสดง interface speed ของทุก port บน switch และ router | ✓ |
| 26 | Interface | แสดง port ที่ AdminStatus เป็น Down ทั้งหมด | ✓ |
| 27 | Interface | แสดงสถานะ interface ล่าสุดทั้งหมดของ RouterProject.mynetwork.com | ✓ |
| 28 | Interface | แสดงสถานะ interface ล่าสุดทั้งหมดของ PR-test-sw.netsec.local | ✓ |
| 29 | Interface | แสดง MAC address ของทุก interface ที่มีค่า | ✓ |
| 30 | Interface | นับจำนวน interface ที่ Up และ Down แยกตาม hostname | ✓ |
| 31 | Traffic | แสดง traffic ขาเข้าและขาออกสะสมล่าสุดของทุก interface | ✓ |
| 32 | Traffic | interface ไหนมี traffic สะสมสูงสุดตอนนี้ เรียง top 10 | ✓ |
| 33 | Traffic | แสดง traffic ล่าสุดของ interface ACCESS-UPLINK บน switch | ✓ |
| 34 | Traffic | แสดง interface ที่มี traffic in และ out เป็น 0 ทั้งคู่ (unused port) | ✓ |
| 35 | Traffic | แสดง traffic_flood anomaly ทั้งหมด พร้อม in_bps และ out_bps | ✓ |
| 36 | Traffic | เปรียบเทียบ traffic ขาเข้า vs ขาออกล่าสุดของทุก interface บน switch | ✓ |
| 37 | Traffic | แสดง traffic ล่าสุดของ interface Gi0/0 บน RouterProject.mynetwork.com | ✓ |
| 38 | Traffic | แสดง traffic ล่าสุดของ interface Gi0/1 บน RouterProject.mynetwork.com | ✓ |
| 39 | Traffic | แสดงช่วงเวลาที่ traffic ผิดปกติ (in_bps หรือ out_bps สูงผิดปกติ) ล่าสุด 10 รายการ | ✗ timeout |
| 40 | Traffic | สรุปจำนวน traffic_flood anomaly แต่ละวันใน 7 วันที่ผ่านมา | ✓ |
| 41 | Syslog | แสดง syslog ที่ severity เป็น error หรือ critical ล่าสุด 20 รายการ | ✓ |
| 42 | Syslog | สรุปจำนวน syslog แต่ละ severity ทั้งหมด | ✓ |
| 43 | Syslog | แสดง syslog warning ล่าสุด 20 รายการ | ✓ |
| 44 | Syslog | device (source IP) ไหนส่ง syslog มากที่สุด นับแยกตาม source | ✓ |
| 45 | Syslog | แสดง syslog ล่าสุด 50 รายการทุก severity | ✓ |
| 46 | Syslog | แสดง syslog critical ที่เกิดขึ้นใน 7 วันที่ผ่านมาทั้งหมด | ✓ |
| 47 | Syslog | แสดง syslog ทั้งหมดที่มี message ล่าสุด 30 รายการ | ✓ |
| 48 | Syslog | แสดง syslog ที่ message เกี่ยวกับ fragment หรือ overflow ล่าสุด | ✓ |
| 49 | Syslog | นับจำนวน syslog แยกตามชั่วโมงใน 24 ชั่วโมงที่ผ่านมา | ✓ |
| 50 | Syslog | แสดงจำนวน syslog แต่ละ severity แยกตาม source IP | ✓ |
| 51 | Anomaly | แสดง anomaly ล่าสุด 10 รายการ พร้อม scenario และค่า CPU, Memory, Traffic | ✓ |
| 52 | Anomaly | สรุป anomaly แต่ละ scenario ว่ามีกี่ครั้ง เรียงจากมากไปน้อย | ✓ |
| 53 | Anomaly | แสดง high_memory anomaly ล่าสุด 10 รายการ | ✓ |
| 54 | Anomaly | แสดง traffic_flood anomaly ล่าสุด 10 รายการ พร้อม in_bps และ out_bps | ✓ |
| 55 | Anomaly | แสดง port_error anomaly ทั้งหมด พร้อม in_err_rate | ✓ |
| 56 | Anomaly | แสดง high_cpu anomaly ทั้งหมด พร้อม cpu_5s | ✗ timeout |
| 57 | Anomaly | แสดง unknown_anomaly ล่าสุด 10 รายการ พร้อมค่า CPU Memory Traffic | ✓ |
| 58 | Anomaly | เปรียบเทียบจำนวน normal vs anomaly ทั้งหมดใน ml_isolation_forest | ✓ |
| 59 | Anomaly | แสดง anomaly score ต่ำสุด 10 อันดับ (ผิดปกติมากที่สุด) | ✓ |
| 60 | Anomaly | แสดง anomaly ที่เกิดขึ้นใน 24 ชั่วโมงที่ผ่านมาทั้งหมด | ✓ |
| 61 | Security | มีการ login ผิดปกติหรือ brute force ไหม | ✗ timeout |
| 62 | Security | ตรวจสอบ SSH error ล่าสุดทั้งหมด | ✓ |
| 63 | Security | IP ไหนพยายาม login ล้มเหลวบ่อยที่สุด แสดงจำนวนและช่วงเวลา | ✗ timeout |
| 64 | Security | แสดงประวัติ login สำเร็จทั้งหมดพร้อม source IP และ user | ✓ |
| 65 | Security | แสดง SSH authentication failed ทั้งหมดล่าสุด 20 รายการ | ✓ |
| 66 | Security | IP ไหน login สำเร็จหลังจาก failed หลายครั้ง (อาจเจาะระบบสำเร็จ) | ✓ |
| 67 | Security | สรุปเหตุการณ์ security ทั้งหมด จำนวน failed และ success แยกตาม source IP | ✓ |
| 68 | Security | แสดง syslog ที่เกี่ยวกับ SSH NO_MATCH หรือ UNEXPECTED_MSG ทั้งหมด | ✓ |
| 69 | Security | แสดง syslog ที่เกี่ยวกับ authentication ทั้งหมดล่าสุด 30 รายการ | ✓ |
| 70 | Security | แสดง timeline เหตุการณ์ security ทั้งหมดเรียงตามเวลา | ✓ |
| 71 | ARIMA | แสดง ARIMA anomaly ล่าสุดทั้งหมด พร้อม feature, actual, predicted, residual | ✓ |
| 72 | ARIMA | แสดง ARIMA anomaly ของ CPU ล่าสุด 10 รายการ | ✓ |
| 73 | ARIMA | แสดง ARIMA anomaly ของ memory ล่าสุด 10 รายการ | ✓ |
| 74 | ARIMA | แสดง ARIMA anomaly ของ traffic ขาเข้า (in_bps) ล่าสุด 10 รายการ | ✓ |
| 75 | ARIMA | แสดง ARIMA anomaly ของ traffic ขาออก (out_bps) ล่าสุด 10 รายการ | ✗ timeout |
| 76 | ARIMA | feature ไหนมี ARIMA anomaly บ่อยที่สุด สรุปจำนวนแยกตาม feature | ✓ |
| 77 | ARIMA | แสดง ARIMA residual สูงสุด 10 อันดับ (เกิน threshold มากที่สุด) | ✓ |
| 78 | ARIMA | เปรียบเทียบค่า actual vs predicted ของ CPU จาก ARIMA ล่าสุด 10 รายการ | ✓ |
| 79 | ARIMA | เปรียบเทียบค่า actual vs predicted ของ memory จาก ARIMA ล่าสุด 10 รายการ | ✓ |
| 80 | ARIMA | นับจำนวน ARIMA anomaly แยกตามวันใน 7 วันที่ผ่านมา | ✓ |
| 81 | Summary | สรุปสถานะระบบทั้งหมดตอนนี้ ได้แก่ CPU, Memory, Interface ที่ Down, Anomaly ล่าสุด | ✓ |
| 82 | Summary | รายงานสรุปประจำวัน: CPU, Memory, Interface, Anomaly และ Syslog Error ล่าสุด | ✓ |
| 83 | Summary | device ไหนมีปัญหามากที่สุด นับจาก anomaly และ syslog error | ✓ |
| 84 | Summary | สรุปเหตุการณ์ผิดปกติทั้งหมดใน 24 ชั่วโมงที่ผ่านมา (anomaly, syslog, error) | ✓ |
| 85 | Summary | แสดงภาพรวม health ของระบบ network: interface ที่ Down, anomaly, syslog error | ✓ |
| 86 | Summary | interface ไหนต้องการความสนใจมากที่สุด (มี error, discard, หรือ Down) | ✓ |
| 87 | Summary | แสดง interface ที่มี error หรือ discard สูงสุด 10 อันดับแรก | ✓ |
| 88 | Summary | สรุป anomaly และ syslog error ที่เกิดในช่วง 24 ชั่วโมงล่าสุด | ✓ |
| 89 | Summary | แสดงปัญหาที่เกิดซ้ำมากที่สุดในระบบ (anomaly scenario และ syslog source) | ✓ |
| 90 | Summary | รายงานสรุปสัปดาห์: จำนวน anomaly แต่ละ scenario, syslog error, interface ที่มีปัญหา | ✓ |
| 91 | Uptime | แสดง uptime ของทุก hostname เรียงจากมากไปน้อย | ✓ |
| 92 | Uptime | แสดง uptime ล่าสุดของ PR-test-sw.netsec.local เป็นกี่วัน | ✓ |
| 93 | Uptime | แสดง uptime ล่าสุดของ RouterProject.mynetwork.com เป็นกี่วัน | ✓ |
| 94 | Uptime | device ไหนมีค่า uptime น้อยที่สุด (reboot ล่าสุด) | ✓ |
| 95 | Uptime | แสดงประวัติ uptime ของทุก hostname ย้อนหลัง 7 วัน | ✓ |
| 96 | Uptime | device ไหนมีค่า uptime ต่ำผิดปกติ (อาจ reboot บ่อย) | ✓ |
| 97 | Uptime | device ที่มี uptime เกิน 30 วันมีเครื่องไหนบ้าง | ✓ |
| 98 | Uptime | เปรียบเทียบ uptime ระหว่าง switch และ router ล่าสุด | ✗ timeout |
| 99 | Uptime | device ที่ online นานที่สุดคืออะไร แสดง uptime เป็นวันและชั่วโมง | ✓ |
| 100 | Uptime | แสดง uptime เฉลี่ยของทุก device ในรูปแบบวันและชั่วโมง | ✓ |

# Network Anomaly Detection & AI Chatbot Dashboard

ระบบตรวจจับความผิดปกติของเครือข่ายด้วย Machine Learning (Isolation Forest + ARIMA/SES) พร้อม Dashboard Grafana และ AI Chatbot ที่ตอบคำถามด้วยภาษาไทยโดยดึงข้อมูลจาก PostgreSQL แบบ Real-time

---

## Architecture Overview

```
SNMP Polling → PostgreSQL (edgedb)
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
   export.py    export_       export_
   (device)     interface.py  (interface)
        │           │
        ▼           ▼
   predict.py   predict_
   (IsolForest) arima.py
        │           │
        ▼           ▼
 insert_result  insert_
      .py        arima.py
        │           │
        └─────┬─────┘
              ▼
         PostgreSQL
    ml_isolation_forest
         ml_arima
              │
       ┌──────┴──────┐
       ▼             ▼
   Grafana       Node.js API
   Dashboard     (port 5001)
   (port 8888)   AI Chatbot
                 (Groq + Ollama)
```

---

## Components

| Component | Path | Role |
|-----------|------|------|
| ML Pipeline | `/opt/net-model/` | Isolation Forest + ARIMA/SES anomaly detection |
| Dashboard + Chatbot | `/opt/dashboard-grafana/` | Node.js Express API + AI Chatbot |
| MLflow Tracking | `/root/mlflow-project/` | Model tracking & artifacts |
| Database | PostgreSQL `edgedb` @ localhost | Central data store |
| Dashboard UI | Grafana @ `http://localhost:8888` | Visualization |

---

## Prerequisites

- **OS:** Ubuntu 22.04 / 24.04
- **Python:** 3.12
- **Node.js:** 18+
- **PostgreSQL:** 14+
- **Grafana:** latest
- **Ollama:** latest (for local LLM)
- RAM ≥ 8 GB (Ollama qwen2.5:3b ต้องการ ~2GB)

---

## 1. Database Setup

```bash
# สร้าง database และ user
sudo -u postgres psql
```

```sql
CREATE USER netsec WITH PASSWORD 'Netsec123';
CREATE DATABASE edgedb OWNER netsec;
GRANT ALL PRIVILEGES ON DATABASE edgedb TO netsec;
\q
```

```bash
# สร้าง tables จาก schema
PGPASSWORD=Netsec123 psql -h localhost -U netsec edgedb -f schema.sql
```

### Tables ที่ต้องมี

| Table | ข้อมูล |
|-------|--------|
| `snmp` | SNMP polling data (cpu, memory, uptime) |
| `interface` | Interface stats (traffic, errors, ifHighSpeed) |
| `syslog` | Syslog messages |
| `monitored_devices` | รายชื่อ devices |
| `ml_isolation_forest` | Isolation Forest anomaly results |
| `ml_arima` | ARIMA/SES forecast + gap detection results |

---

## 2. ML Pipeline Setup (`/opt/net-model/`)

```bash
cd /opt/net-model

# สร้าง virtual environment
python3 -m venv venv
source venv/bin/activate

# ติดตั้ง dependencies
pip install \
  pandas numpy psycopg2-binary \
  scikit-learn statsmodels mlflow \
  joblib scipy
```

### วิธีรัน Pipeline (ครั้งแรก)

```bash
source /opt/net-model/venv/bin/activate

# Step 1: Export ข้อมูลจาก DB → CSV
python3 /opt/net-model/export.py

# Step 2: Train Isolation Forest + predict anomalies
python3 /opt/net-model/predict.py

# Step 3: Upload results → DB
python3 /opt/net-model/insert_result.py

# Step 4: ARIMA/SES forecast
python3 /opt/net-model/predict_arima.py

# Step 5: Upload ARIMA results → DB
python3 /opt/net-model/insert_arima.py
```

### ตั้ง Cron (Auto pipeline ทุก 15 นาที)

```bash
crontab -e
```

เพิ่มบรรทัดนี้:

```
*/15 * * * * /opt/net-model/venv/bin/python3 /opt/net-model/export.py >> /opt/net-model/export.log 2>&1 && /opt/net-model/venv/bin/python3 /opt/net-model/predict.py && /opt/net-model/venv/bin/python3 /opt/net-model/insert_result.py && /opt/net-model/venv/bin/python3 /opt/net-model/predict_arima.py && /opt/net-model/venv/bin/python3 /opt/net-model/insert_arima.py
```

### Train Scenario Classifier (ถ้า model ยังไม่มี)

```bash
source /opt/net-model/venv/bin/activate
python3 /opt/net-model/train_arima_threshold.py  # calibrate ARIMA thresholds
python3 /opt/net-model/train_scenario_classifier.py  # train scenario classifier
```

---

## 3. Dashboard & Chatbot Setup (`/opt/dashboard-grafana/`)

```bash
cd /opt/dashboard-grafana
npm install
```

### สร้างไฟล์ `.env`

```bash
cat > /opt/dashboard-grafana/.env << 'EOF'
# PostgreSQL
DB_HOST=localhost
DB_NAME=edgedb
DB_USER=netsec
DB_PASSWORD=Netsec123

# Ollama (local LLM)
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:3b
OLLAMA_TIMEOUT=120000

# Groq API (optional — เร็วกว่า Ollama มาก)
# สมัครฟรีได้ที่ https://console.groq.com
GROQ_KEYS=your_groq_key_1,your_groq_key_2
GROQ_MODEL=llama-3.3-70b-versatile
EOF
```

> **หมายเหตุ:** ถ้าไม่มี `GROQ_KEYS` ระบบจะใช้ Ollama อย่างเดียว (ช้ากว่า ~30-60s/query)

### ติดตั้ง Ollama และ pull model

```bash
# ติดตั้ง Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull models
ollama pull qwen2.5:3b   # ~1.9 GB (primary)
ollama pull qwen2.5:1.5b  # ~983 MB (lighter alternative)
```

### รัน Dashboard API

```bash
# ด้วย PM2 (แนะนำ)
npm install -g pm2
pm2 start /opt/dashboard-grafana/server.js --name dashboard-api
pm2 save
pm2 startup

# หรือรันตรงๆ
node /opt/dashboard-grafana/server.js
```

API จะเปิดที่ `http://localhost:5001`

---

## 4. Grafana Setup

```bash
# ติดตั้ง Grafana
sudo apt-get install -y grafana

# เปิด service
sudo systemctl enable grafana-server
sudo systemctl start grafana-server
```

เข้า Grafana ที่ `http://localhost:8888` (default login: admin/admin)

### เพิ่ม PostgreSQL Data Source

1. Settings → Data Sources → Add data source
2. เลือก **PostgreSQL**
3. กรอก:
   - Host: `localhost:5432`
   - Database: `edgedb`
   - User: `netsec`
   - Password: `Netsec123`
   - SSL Mode: `disable`

### Import Dashboard

1. Dashboards → Import
2. Upload ไฟล์ `grafana_dashboard.json` (ถ้ามี)

---

## 5. AI Chatbot Architecture

ระบบ Chatbot ใช้ **Promise.any() race** ระหว่าง Groq และ Ollama — ใครตอบก่อนได้ใช้ก่อน

```
User Question (Thai/English)
        │
        ▼
  Step 1: INTENT (Groq)
  Thai question → English data-retrieval intent
        │
        ▼
  Step 2: SQL (Ollama/Groq race)
  English intent → SELECT SQL
        │
        ▼
  PostgreSQL Query
        │
        ▼
  Step 3: ANALYSIS (Groq)
  Raw DB rows → Thai language analysis
        │
        ▼
  Response to User
```

**Speed:** ~1-2s (Groq) / ~60-85s (Ollama CPU-only บน i7-7567U)

---

## 6. Scenario Playbook

ไฟล์ `scenario_playbook.json` ใน `/opt/dashboard-grafana/` มี 10 scenarios:

| Scenario | ตรวจจับโดย | คำแนะนำ |
|----------|-----------|---------|
| `high_cpu` | CPU ≥ 80% | ✅ Chatbot ตอบวิธีแก้ |
| `elevated_cpu` | CPU 10–79% | ✅ |
| `high_memory` | Memory สูง | ✅ |
| `link_congestion` | Utilization ≥ 70% | ✅ |
| `traffic_high` | Utilization 10–69% | ✅ |
| `traffic_flood` | Traffic สูง | ✅ |
| `traffic_spike` | Traffic spike | ✅ |
| `port_error` | Interface errors | ✅ |
| `error_flood` | Error rate สูง | ✅ |
| `device_down` | Gap > 3x normal interval | ✅ |

---

## 7. Verify Installation

```bash
# ตรวจสอบ DB
PGPASSWORD=Netsec123 psql -h localhost -U netsec edgedb -c "\dt"

# ตรวจสอบ anomaly data
PGPASSWORD=Netsec123 psql -h localhost -U netsec edgedb -c \
  "SELECT scenario_name, COUNT(*) FROM ml_isolation_forest GROUP BY scenario_name ORDER BY 2 DESC;"

# ตรวจสอบ Dashboard API
curl -s http://localhost:5001/api/config | python3 -m json.tool

# ทดสอบ Chatbot
curl -s -X POST http://localhost:5001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "CPU ทุกเครื่องตอนนี้เป็นอย่างไร", "sessionId": "test"}' | python3 -m json.tool

# ตรวจสอบ Grafana
curl -s http://localhost:8888/api/health
```

---

## 8. File Structure

```
/opt/net-model/
├── export.py              # Export SNMP + interface data → CSV
├── export_interface.py    # Export per-interface data → CSV
├── predict.py             # Isolation Forest anomaly detection
├── predict_arima.py       # ARIMA/SES forecast + gap detection
├── insert_result.py       # Upsert IF results → DB
├── insert_arima.py        # Upsert ARIMA results → DB
├── train_model.py         # Train Isolation Forest
├── train_arima.py         # Train ARIMA models
├── train_arima_threshold.py  # Calibrate ARIMA thresholds
├── train_scenario_classifier.py  # Train scenario classifier
├── models/
│   ├── *_iso_model.pkl    # Isolation Forest models
│   ├── *_iso_scaler.pkl   # Scalers
│   ├── scenario_classifier.pkl
│   └── arima_thresholds.json
└── venv/                  # Python virtual environment

/opt/dashboard-grafana/
├── server.js              # Express API + AI Chatbot logic
├── config.js              # Prompts + Quick Prompts config
├── scenario_playbook.json # 10 scenario guides for AI
├── public/                # Frontend files
├── .env                   # API keys + DB config (สร้างเอง)
└── package.json

/root/mlflow-project/
├── export.py              # Alternative export script
├── train_iso.py           # MLflow-tracked training
└── mlruns/                # MLflow artifacts
```

---

## Known Issues / Notes

- **SNMP counter wrap:** counter reset ทำให้เกิด anomaly spike ชั่วคราว — ระบบมี filter แล้ว
- **Groq rate limit:** ถ้ายิง request ถี่เกินไปจะ fallback ไป Ollama อัตโนมัติ
- **Cron interval:** pipeline ใช้เวลา ~10 นาที → ตั้ง interval ≥ 15 นาที
- **Index ที่ต้องมี:** `CREATE INDEX idx_interface_hostname_time ON interface (hostname, time);` และ `CREATE INDEX idx_snmp_hostname_time ON snmp (hostname, time);` ถ้าไม่มีจะ query ช้ามาก

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Data Collection | SNMP (Python psycopg2) |
| Anomaly Detection | scikit-learn (IsolationForest), statsmodels (ARIMA/SES) |
| Database | PostgreSQL 14+ |
| Model Tracking | MLflow |
| API Server | Node.js + Express |
| AI/LLM | Ollama (qwen2.5:3b) + Groq (llama-3.3-70b-versatile) |
| Dashboard | Grafana |
| Process Manager | PM2 |
